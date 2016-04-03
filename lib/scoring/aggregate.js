'use strict';

const log = require('npmlog');
const couchdbIterator = require('couchdb-iterator');
const promiseRetry = require('promise-retry');

const logPrefix = 'scoring/aggregate';

/**
 * Creates the aggregation object structure (shape) based on an evaluation.
 *
 * @param {object} aggregation The empty aggregation object
 * @param {object} evaluation  The evaluation to be used as reference
 */
function shapeAggregation(aggregation, evaluation) {
    Object.keys(evaluation).forEach((category) => {
        const subAggregation = aggregation[category] = {};
        const subEvaluation = evaluation[category];

        if (typeof subEvaluation !== 'number') {
            return shapeAggregation(subAggregation, subEvaluation);
        }

        aggregation[category] = { min: Infinity, max: -Infinity, mean: 0 };
    });
}

/**
 * Parses an evaluation, aggregating it into the aggregation object.
 *
 * @param {object} aggregation The aggregation
 * @param {number} count       The total number of evaluations already aggregated
 * @param {object} evaluation  The evaluation to be parsed
 */
function aggregateEvaluation(aggregation, count, evaluation) {
    Object.keys(evaluation).forEach((category) => {
        const subAggregation = aggregation[category];
        const subEvaluation = evaluation[category];

        if (typeof subEvaluation !== 'number') {
            return aggregateEvaluation(subAggregation, count, subEvaluation);
        }

        subAggregation.min = Math.min(subAggregation.min, subEvaluation);
        subAggregation.max = Math.max(subAggregation.max, subEvaluation);
        subAggregation.mean = (subAggregation.mean * count + subEvaluation) / (count + 1);
    });
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
            .tap((res) => { aggregation._rev = res.rev; })
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
    const aggregation = { count: 0 };

    log.info(logPrefix, 'Starting aggregation');

    // Iterate over all modules evaluation
    return couchdbIterator(npmsNano, 'npms-analyzer/modules-evaluation', (row) => {
        row.index && row.index % 25000 === 0 && log.info(logPrefix, `Aggregated a total of ${row.index} evaluations`, { aggregation });

        !row.index && shapeAggregation(aggregation, row.value);  // Shape aggregation on the first evaluation
        aggregateEvaluation(aggregation, row.index, row.value);  // Aggregate this evaluation into the aggregation object
        aggregation.count += 1;                                  // Increment count
    }, { concurrency: 100, limit: 10000 })
    // Save the aggregation
    .then(() => save(aggregation, npmsNano))
    // We are done!
    .then((aggregation) => {
        log.info(logPrefix, `Aggregation successful, processed a total of ${aggregation.count} evaluations`, { aggregation });
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
