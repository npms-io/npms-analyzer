'use strict';

const log = require('npmlog');
const couchdbIterator = require('couchdb-iterator');

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
 * @param {object} aggregation The aggregation object
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
 * Iterates over all modules evaluations, producing an aggregation (aka reduce) of all scalar values in it,
 * including the min, max and mean values for each metric.
 *
 * @param {Nano} npmsNano  The npms nano client instance
 *
 * @return {object} The aggregation
 */
function aggregate(npmsNano) {
    const aggregation = {};

    // Iterate over all modules evaluation
    return couchdbIterator(npmsNano, 'npms-analyzer/modules-evaluation', (row, index) => {
        index && index % 25000 === 0 && log.verbose(logPrefix, `Aggregated a total of ${index} evaluations`, aggregation);

        !index && shapeAggregation(aggregation, row.value);
        aggregateEvaluation(aggregation, index, row.value);
    }, { concurrency: 100, limit: 10000 })
    // Save the aggregation
    .tap(() => {
        const key = 'scoring!aggregation';

        return npmsNano.getAsync(key)
        .catch({ error: 'not_found' }, () => { return { _id: key }; })
        .then((doc) => {
            aggregation._id = doc._id;
            aggregation._rev = doc._rev;

            return npmsNano.insertAsync(aggregation)
            .catch({ error: 'conflict' }, () => {
                log.warn('', 'Unable to store aggregation, are two instances of scoring running?');
            });
        });
    })
    .then((count) => {
        log.info(logPrefix, `Aggregation successful, processed a total of ${count} evaluations`, aggregation);
    }, (err) => {
        log.error(logPrefix, 'Aggregation failed', { err });
        throw err;
    })
    .return(aggregation);
}

module.exports = aggregate;
