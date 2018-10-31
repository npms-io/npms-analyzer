'use strict';

const couchdbIterator = require('couchdb-iterator');
const promiseRetry = require('promise-retry');
const flattenObject = require('obj-flatten');
const unflattenObject = require('obj-unflatten');
const mapValues = require('lodash/mapValues');
const mean = require('lodash/mean');
const objGet = require('lodash/get');

const trimPercentage = 0.01; // Trim evaluations % to normalize skewness of values when aggregating
const log = logger.child({ module: 'scoring/aggregate' });

/**
 * Calculates the aggregation based on the accumulated evaluations.
 *
 * @param {Array} evaluations - The accumulated evaluations.
 *
 * @returns {Object} The aggregation object.
 */
function calculateAggregation(evaluations) {
    const shape = flattenObject(evaluations[0] || {});

    const grouped = mapValues(shape, (value, key) => (
        evaluations
        .map((evaluation) => objGet(evaluation, key))
        // All the packages with negative values will have a score of 0 (e.g.: downloads acceleration)
        // So, we must remove all negative values from the aggregation in order to have a better score curve
        .filter((evaluation) => evaluation >= 0)
        .sort((a, b) => a - b)
    ));

    const aggregation = mapValues(grouped, (evaluations) => {
        const trimmedLength = Math.round(evaluations.length * trimPercentage);

        return {
            min: evaluations[0],
            max: evaluations[evaluations.length - 1],
            mean: mean(evaluations),
            truncatedMean: mean(evaluations.slice(trimmedLength, -trimmedLength)),
            median: evaluations[Math.round(evaluations.length / 2)],
        };
    });

    return unflattenObject(aggregation);
}

// ---------------------------------------------------------

/**
 * Gets the last aggregation.
 *
 * @param {Nano} npmsNano - The npms nano client instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function get(npmsNano) {
    log.trace('Getting aggregation');

    return npmsNano.getAsync('scoring!aggregation')
    .catch({ error: 'not_found' }, () => {
        throw Object.assign(new Error('Aggregation not found, it appears that the first scoring cycle has not yet run'),
            { code: 'AGGREGATION_NOT_FOUND' });
    });
}

/**
 * Removes a last aggregation.
 *
 * @param {Nano} npmsNano - The client nano instance for npms.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function remove(npmsNano) {
    return promiseRetry((retry) => (
        get(npmsNano)
        .then((doc) => (
            npmsNano.destroyAsync(doc._id, doc._rev)
            .catch({ error: 'conflict' }, (err) => {
                err = new Error('Conflict while removing aggregation');
                log.warn({ err }, err.message);
                retry(err);
            })
        ))
    ))
    .catch({ code: 'AGGREGATION_NOT_FOUND' }, () => {})
    .then(() => log.trace('Aggregation removed'));
}

/**
 * Saves aggregation.
 *
 * @param {Object} aggregation - The aggregation (can be the full doc to avoid having to fetch it).
 * @param {Nano}   npmsNano    - The client nano instance for npms.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function save(aggregation, npmsNano) {
    return promiseRetry((retry) => (
        // Fetch the doc if necessary to obtain its rev
        Promise.try(() => {
            if (aggregation._rev) {
                return;
            }

            return get(npmsNano)
            .then((doc) => { aggregation._rev = doc._rev; })
            .catch({ code: 'AGGREGATION_NOT_FOUND' }, () => {});
        })
        // Save it
        .then(() => {
            aggregation._id = 'scoring!aggregation';

            return npmsNano.insertAsync(aggregation)
            .tap((response) => { aggregation._rev = response.rev; })
            .catch({ error: 'conflict' }, (err) => {
                err = new Error('Conflict while storing aggregation');
                log.warn({ err }, err.message);

                delete aggregation._rev;
                retry(err);
            });
        })
    ))
    .return(aggregation)
    .tap(() => log.trace({ aggregation }, 'Saved aggregation'));
}

/**
 * Iterates over all packages evaluations, producing an aggregation (aka reduce) of all scalar values in it,
 * including the min, max and mean values for each metric.
 *
 * @param {Nano} npmsNano - The npms nano client instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function aggregate(npmsNano) {
    const evaluations = [];

    log.info('Starting aggregation');

    // Iterate over all packages evaluation
    return couchdbIterator(npmsNano, 'npms-analyzer/packages-evaluation', (row) => {
        row.index && row.index % 25000 === 0 && log.info(`Accumulated a total of ${row.index} evaluations`);
        evaluations.push(row.value);
    }, { concurrency: 100, limit: 10000 })
    // Calculate the aggregation & save it
    .then((evaluationsCount) => {
        if (!evaluationsCount) {
            log.debug('There are no evaluations yet');

            return null;
        }

        log.info(`Accumulated a total of ${evaluationsCount} evaluations, calculating aggregation..`);

        const aggregation = calculateAggregation(evaluations);

        log.info({ aggregation }, 'Aggregation calculated, saving it..');

        return save(aggregation, npmsNano);
    })
    // We are done!
    .then((aggregation) => {
        log.info({ aggregation }, `Aggregation successful, processed a total of ${evaluations.length} evaluations`);

        return aggregation;
    }, (err) => {
        log.error({ err }, 'Aggregation failed');
        throw err;
    });
}

module.exports = aggregate;
module.exports.get = get;
module.exports.save = save;
module.exports.remove = remove;
