'use strict';

const log = require('npmlog');
const solveCubic = require('./util/solveCubic');
const couchdbIterator = require('couchdb-iterator');
const getAggregate = require('./aggregate');
const weightedMedian = require('./util/weightedMedian');
const clamp = require('lodash/clamp');
const avgY = 0.75; // [0, 1]

const logPrefix = 'scoring/score';

/**
 * Calculates the score of a value taking into the consideration its aggregation (min, max, mean).
 *
 * The mathematical formula can be "previewed" here: https://github.com/npms-io/npms-analyzer/blob/master/docs/diagrams/bezier.png
 * Thanks @atduarte for this awesome equation.
 *
 * @param {number} value       The value
 * @param {object} aggregation The aggregation for the value
 *
 * @return {number} The score
 */
function calculateScore(value, aggregation) {
    const normValue = clamp((value - aggregation.min) / aggregation.max, 0, 1);
    const normAvg = clamp((aggregation.mean - aggregation.min) / aggregation.max, 0, 1);
    const roots = solveCubic(1, (-3 * normAvg), 3 * normAvg, -normValue);

    let t = null;

    roots.some((value) => {
        if (value >= 0 && value <= 1) {
            t = value;
            return false;
        }

        return true;
    });

    if (t === null) {
        if (normValue < 0.000001) {
            return 0;
        }

        if (normValue > 0.999999) {
            return 1;
        }

        log.error(logPrefix, 'Solving the Cubic formula failed. Probably aggregation is incorrect.', {
            roots,
            normValue,
            normAvg,
            value,
            aggregation,
        });

        return 0;
    }

    return Math.pow(t, 3) - (3 * avgY * Math.pow(t, 2)) + (3 * t * avgY);
}

/**
 * Computes the quality score.
 *
 * @param {object} quality     The quality analysis
 * @param {object} aggregation The quality aggregation
 *
 * @return {number} The score
 */
function scoreQuality(quality, aggregation) {
    const scores = {
        carefulness: calculateScore(quality.carefulness, aggregation.carefulness),
        tests: calculateScore(quality.tests, aggregation.tests),
        dependenciesHealth: calculateScore(quality.dependenciesHealth, aggregation.dependenciesHealth),
        branding: calculateScore(quality.branding, aggregation.branding),
    };

    return weightedMedian([
        [scores.carefulness, 7],
        [scores.tests, 7],
        [scores.dependenciesHealth, 4],
        [scores.branding, 2],
    ]);
}

/**
 * Computes the popularity score.
 *
 * @param {object} popularity  The popularity analysis
 * @param {object} aggregation The popularity aggregation
 *
 * @return {number} The score
 */
function scorePopularity(popularity, aggregation) {
    const scores = {
        communityInterest: calculateScore(popularity.communityInterest, aggregation.communityInterest),
        downloadsCount: calculateScore(popularity.downloadsCount, aggregation.downloadsCount),
        downloadsAcceleration: calculateScore(popularity.downloadsAcceleration, aggregation.downloadsAcceleration),
        dependentsCount: calculateScore(popularity.dependentsCount, aggregation.dependentsCount),
    };

    return weightedMedian([
        [scores.communityInterest, 6],
        [scores.downloadsCount, 5],
        [scores.downloadsAcceleration, 4],
        [scores.dependentsCount, 5],
    ]);
}

/**
 * Computes the maintenance score.
 *
 * @param {object} maintenance The maintenance analysis
 * @param {object} aggregation The maintenance aggregation
 *
 * @return {number} The score
 */
function scoreMaintenance(maintenance, aggregation) {
    const scores = {
        recentCommits: calculateScore(maintenance.recentCommits, aggregation.recentCommits),
        commitsFrequency: calculateScore(maintenance.commitsFrequency, aggregation.commitsFrequency),
        openIssues: calculateScore(maintenance.openIssues, aggregation.openIssues),
        issuesDistribution: calculateScore(maintenance.issuesDistribution, aggregation.issuesDistribution),
    };

    return weightedMedian([
        [scores.recentCommits, 2],
        [scores.commitsFrequency, 3],
        [scores.openIssues, 2],
        [scores.issuesDistribution, 3],
    ]);
}

/**
 * Calculates and builds the score data to be indexed in elasticsearch.
 *
 * @param {object}  analysis    The module analysis
 * @param {object}  aggregation The most up to date aggregation
 *
 * @return {Promise} The promise that fulfills when done
 */
function buildScore(analysis, aggregation) {
    const collected = analysis.collected;
    const evaluation = analysis.evaluation;
    const name = collected.metadata.name;

    const scoreDetail = {
        quality: scoreQuality(evaluation.quality, aggregation.quality),
        popularity: scorePopularity(evaluation.popularity, aggregation.popularity),
        maintenance: scoreMaintenance(evaluation.maintenance, aggregation.maintenance),
    };

    return {
        name,
        version: collected.metadata.version,
        description: collected.metadata.description,
        keywords: collected.metadata.keywords,
        publisher: collected.metadata.publisher,
        maintainers: collected.metadata.maintainers,
        score: {
            final: scoreDetail.quality * 0.3 +
                   scoreDetail.popularity * 0.35 +
                   scoreDetail.maintenance * 0.35,
            detail: scoreDetail,
        },
    };
}

// -------------------------------------------------------------------

/**
 * Gets a module score data.
 *
 * @param {string} name      The module name
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function get(name, esClient) {
    // Need to use Promise.resolve() because elasticsearch doesn't use the global promise
    return Promise.resolve(esClient.get({
        index: 'npms-read',
        type: 'module',
        id: name,
    }))
    .get('_source')
    .catch({ status: 404 }, () => {
        throw Object.assign(new Error(`Score for ${name} does not exist`), { code: 'SCORE_NOT_FOUND' });
    });
}

/**
 * Removes a module score data.
 *
 * @param {string} name      The module name
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function remove(name, esClient) {
    // Need to use Promise.resolve() because elasticsearch doesn't use the global promise
    return Promise.resolve(esClient.delete({
        index: 'npms-write',
        type: 'module',
        id: name,
    }))
    .catch({ status: 404 }, () => {})
    .then(() => log.silly(logPrefix, `Removed score of ${name}`));
}

/**
 * Saves a module score data.
 *
 * @param {object} score     The score data
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function save(score, esClient) {
    // Need to use Promise.resolve() because elasticsearch doesn't use the global promise
    return Promise.resolve(esClient.index({
        index: 'npms-write',
        type: 'module',
        id: score.name,
        body: score,
    }))
    .then(() => log.silly(logPrefix, `Stored score for ${score.name}`, { score }))
    .return(score);
}

/**
 * Scores all modules.
 *
 * @param {object}  aggregation The most up to date aggregation
 * @param {Nano}    npmsNano The npm nano instance
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} A promise that fulfills when done
 */
function all(aggregation, npmsNano, esClient) {
    log.info(logPrefix, 'Scoring modules..', { aggregation });

    return couchdbIterator(npmsNano, (row) => {
        row.index && row.index % 10000 === 0 && log.info(logPrefix, `Scored a total of ${row.index} modules`);

        if (!row.doc) {
            return;
        }

        const name = row.id.split('!')[1];

        return save(buildScore(row.doc, aggregation), esClient)
        .then((score) => {
            log.silly(logPrefix, `Scoring of ${name} completed`, { score });
            return score;
        }, (err) => {
            log.error(logPrefix, `Scoring of of ${name} failed`, { err });
            throw err;
        });
    }, {
        startkey: 'module!',
        endkey: 'module!\ufff0',
        concurrency: 50,
        limit: 2500,
        includeDocs: true,
    })
    .tap((count) => log.info(logPrefix, `Scoring modules completed, scored a total of ${count} modules`));
}

/**
 * Scores a module, indexing its result in elasticsearch to be searchable.
 *
 * @param {objects} analysis The module analysis
 * @param {Nano}    npmsNano The npms nano client instance
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function score(analysis, npmsNano, esClient) {
    const name = analysis.collected.metadata.name;

    log.silly(logPrefix, `Scoring ${name}..`);

    return getAggregate()
    .then((aggregation) => save(buildScore(analysis, aggregation), esClient))
    .then((score) => {
        log.verbose(logPrefix, `Scoring of ${name} completed`, { score });
        return score;
    }, (err) => {
        log.error(logPrefix, `Scoring of of ${name} failed`, { err });
        throw err;
    });
}

module.exports = score;
module.exports.get = get;
module.exports.save = save;
module.exports.remove = remove;
module.exports.all = all;
