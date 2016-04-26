'use strict';

const log = require('npmlog');
const couchdbIterator = require('couchdb-iterator');
const promiseRetry = require('promise-retry');
const flattenObject = require('obj-flatten');
const unflattenObject = require('obj-unflatten');
const mapValues = require('lodash/mapValues');
const min = require('lodash/min');
const max = require('lodash/max');
const mean = require('lodash/mean');
const objGet = require('lodash/get');

const logPrefix = 'scoring/aggregate';
const trimPercentage = 0.01;  // Trim evaluations % to normalize skewness of values when aggregating

/**
 * Calculates the aggregation based on the accumulated evaluations.
 *
 * @param {array} evaluations The accumulated evaluations
 *
 * @return {object} The aggregation object
 */
function calculateAggregation(evaluations) {
    const shape = flattenObject(evaluations[0] || {});

    const accumulator = mapValues(shape, (value, key) => {
        return evaluations
        .map((evaluation) => objGet(evaluation, key))
        .sort((a, b) => a - b);
    });

    const aggregation = mapValues(accumulator, (accumulated) => {
        const trimmedLength = Math.round(evaluations.length * trimPercentage);

        return {
            min: accumulated[0],
            max: accumulated[accumulated.length - 1],
            mean: mean(accumulated),
            truncatedMean: mean(accumulated.slice(trimmedLength, -trimmedLength)),
            median: accumulated[Math.round(accumulated.length / 2)],
        };
    });

    console.log(JSON.stringify(aggregation, null, 2));
    return unflattenObject(aggregation);
}

// ---------------------------------------------------------

/**
 * Gets the last aggregation.
 *
 * @param {Nano} npmsNano The npms nano client instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function get(npmsNano) {
    return npmsNano.getAsync('scoring!aggregation')
    .catch({ error: 'not_found' }, () => {
        throw Object.assign(new Error('Aggregation not found, it appears that the first scoring cycle has not yet run'),
            { code: 'AGGREGATION_NOT_FOUND' });
    });
}

/**
 * Removes a last aggregation.
 *
 * @param {Nano} npmsNano The client nano instance for npms
 *
 * @return {Promise} The promise that fulfills when done
 */
function remove(npmsNano) {
    return promiseRetry((retry) => {
        return get(npmsNano)
        .then((doc) => {
            return npmsNano.destroyAsync(doc._id, doc._rev)
            .catch({ error: 'conflict' }, (err) => {
                err = new Error('Conflict while removing aggregation');
                log.warn(logPrefix, err.message, { err });
                retry(err);
            });
        });
    })
    .catch({ code: 'AGGREGATION_NOT_FOUND' }, () => {})
    .then(() => log.silly(logPrefix, 'Aggregation removed'));
}

/**
 * Saves aggregation.
 *
 * @param {object} aggregation The aggregation (can be the full doc to avoid having to fetch it)
 * @param {Nano}   npmsNano    The client nano instance for npms
 *
 * @return {Promise} The promise that fulfills when done
 */
function save(aggregation, npmsNano) {
    return promiseRetry((retry) => {
        // Fetch the doc if necessary to obtain its rev
        return Promise.try(() => {
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
                log.warn(logPrefix, err.message, { err });

                delete aggregation._rev;
                retry(err);
            });
        });
    })
    .return(aggregation)
    .tap(() => log.silly(logPrefix, 'Saved aggregation', { aggregation }));
}

/**
 * Iterates over all modules evaluations, producing an aggregation (aka reduce) of all scalar values in it,
 * including the min, max and mean values for each metric.
 *
 * @param {Nano} npmsNano The npms nano client instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function aggregate(npmsNano) {
    const evaluations = [];

    log.info(logPrefix, 'Starting aggregation');

    // Iterate over all modules evaluation
    return couchdbIterator(npmsNano, 'npms-analyzer/modules-evaluation', (row) => {
        row.index && row.index % 25000 === 0 && log.info(logPrefix, `Accumulated a total of ${row.index} evaluations`);
        evaluations.push(row.value);
    }, { concurrency: 100, limit: 10000 })
    // Calculate the aggregation
    .then(() => {
        log.info(logPrefix, 'Accumulation done, calculating aggregation..');
        return calculateAggregation(evaluations);
    })
    // Save the aggregation
    .then((aggregation) => {
        log.info(logPrefix, 'Aggregation calculated, saving it..', { aggregation });
        return save(aggregation, npmsNano);
    })
    // We are done!
    .then((aggregation) => {
        log.info(logPrefix, `Aggregation successful, processed a total of ${evaluations.length} evaluations`, { aggregation });
        return aggregation;
    }, (err) => {
        log.error(logPrefix, 'Aggregation failed', { err });
        throw err;
    });
}

module.exports = aggregate;
module.exports.get = get;
module.exports.save = save;
module.exports.remove = remove;
