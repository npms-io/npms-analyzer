'use strict';

const log = require('npmlog');
const aggregate = require('./aggregate');

const logPrefix = 'scoring/score';

/**
 * Calculates the score of a value taking into the consideration its aggregation (min, max, mean).
 *
 * The mathematical formula can be "previewed" here: https://npms-io.slack.com/files/andreduarte/F0QU3SYJW/twe.png
 * Thanks @atduarte for this awesome equation.
 *
 * @param {Number} value       The value
 * @param {Object} aggregation The aggregation for the value
 *
 * @return {Number} The score
 */
function calculateScore(value, aggregation) {
    const normAvg = (aggregation.mean - aggregation.min) / aggregation.max;
    const normValue = (value - aggregation.min) / aggregation.max;

    return 1 / (1 + Math.exp(-12 * normValue + 12 * normAvg));
}

/**
 * Computes the quality score.
 *
 * @param {object} quality     The quality analysis
 * @param {object} aggregation The quality aggregation
 *
 * @return {Number} The score
 */
function scoreQuality(quality, aggregation) {
    const scores = {
        carefulness: calculateScore(quality.carefulness, aggregation.carefulness),
        tests: calculateScore(quality.tests, aggregation.tests),
        dependenciesHealth: calculateScore(quality.dependenciesHealth, aggregation.dependenciesHealth),
        branding: calculateScore(quality.branding, aggregation.branding),
    };

    return scores.carefulness * 0.35 +
           scores.tests * 0.35 +
           scores.dependenciesHealth * 0.2 +
           scores.branding * 0.1;
}

/**
 * Computes the popularity score.
 *
 * @param {object} popularity  The popularity analysis
 * @param {object} aggregation The popularity aggregation
 *
 * @return {Number} The score
 */
function scorePopularity(popularity, aggregation) {
    const scores = {
        communityInterest: calculateScore(popularity.communityInterest, aggregation.communityInterest),
        downloadsCount: calculateScore(popularity.downloadsCount, aggregation.downloadsCount),
        downloadsAcceleration: calculateScore(popularity.downloadsAcceleration, aggregation.downloadsAcceleration),
        dependentsCount: calculateScore(popularity.dependentsCount, aggregation.dependentsCount),
    };

    return scores.communityInterest * 0.3 +
           scores.downloadsCount * 0.25 +
           scores.downloadsAcceleration * 0.2 +
           scores.dependentsCount * 0.25;
}

/**
 * Computes the maintenance score.
 *
 * @param {object} maintenance The maintenance analysis
 * @param {object} aggregation The maintenance aggregation
 *
 * @return {Number} The score
 */
function scoreMaintenance(maintenance, aggregation) {
    const scores = {
        recentCommits: calculateScore(maintenance.recentCommits, aggregation.recentCommits),
        commitsFrequency: calculateScore(maintenance.commitsFrequency, aggregation.commitsFrequency),
        openIssues: calculateScore(maintenance.openIssues, aggregation.openIssues),
        issuesDistribution: calculateScore(maintenance.issuesDistribution, aggregation.issuesDistribution),
    };

    return scores.recentCommits * 0.2 +
           scores.commitsFrequency * 0.3 +
           scores.openIssues * 0.2 +
           scores.issuesDistribution * 0.3;
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
    // Need to use Promise.resolve() due to a bug, see: https://github.com/elastic/elasticsearch-js/pull/362#issuecomment-195950901
    return Promise.resolve(esClient.get({
        index: 'npms-read',
        type: 'module',
        id: name,
    }))
    .get('_source')
    .catch({ status: 404 }, () => {
        throw Object.assign(new Error('Score for ${name} does not exist'), { code: 'SCORE_NOT_FOUND' });
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
    // Need to use Promise.resolve() due to a bug, see: https://github.com/elastic/elasticsearch-js/pull/362#issuecomment-195950901
    return Promise.resolve(esClient.delete({
        index: 'npms-write',
        type: 'module',
        id: name,
    }))
    .catch({ status: 404 }, () => {})
    .then(() => log.verbose(logPrefix, `Removed score of ${name}`));
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
    // Need to use Promise.resolve() due to a bug, see: https://github.com/elastic/elasticsearch-js/pull/362#issuecomment-195950901
    return Promise.resolve(esClient.index({
        index: 'npms-write',
        type: 'module',
        id: score.name,
        body: score,
    }))
    .then(() => log.verbose(logPrefix, `Stored score for ${score.name}`, { score }))
    .return(score);
}

/**
 * Calculates the score of a module, indexing its result in elasticsearch to be searchable.
 *
 * This is equivalent to score() but is faster if you already have the current aggregation.
 *
 * @param {object}  analysis    The module analysis
 * @param {object}  aggregation The most up to date aggregation
 * @param {Elastic} esClient    The elasticsearch instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function calculate(analysis, aggregation, esClient) {
    const name = analysis.collected.metadata.name;

    log.silly(logPrefix, `Scoring ${name}..`);

    return save(buildScore(analysis, aggregation), esClient)
    .then((score) => {
        log.verbose(logPrefix, `Scoring of ${name} completed`, { score });
        return score;
    }, (err) => {
        log.error(logPrefix, `Scoring of of ${name} failed`, { err });
        throw err;
    });
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

    return aggregate.get(npmsNano)
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
module.exports.calculate = calculate;
