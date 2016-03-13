'use strict';

const log = require('npmlog');

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

// -------------------------------------------------------------------

/**
 * Fetches data necessary to score a module which is the module analysis and the last aggregation.
 *
 * @param {string} name     The module name (may also be the analysis result of the module)
 * @param {Nano}   npmsNano The npms nano client instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function fetch(name, npmsNano) {
    return Promise.all([
        npmsNano.get(`module!${name}`),
        npmsNano.get('scoring!aggregation'),
    ]);
}

/**
 * Scores a module, indexing its result in elasticsearch to be searchable.
 *
 * @param {object}        analysis    The module name (may also be the analysis result of the module)
 * @param {object}        aggregation The most up to date aggregation (if none is passed, it will be fetched)
 * @param {Elasticsearch} esClient    The elasticsearch client instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function score(analysis, aggregation, esClient) {
    const collected = analysis.collected;
    const evaluation = analysis.evaluation;
    const name = collected.metadata.name;

    const scoreDetail = {
        quality: scoreQuality(evaluation.quality, aggregation.quality),
        popularity: scorePopularity(evaluation.popularity, aggregation.popularity),
        maintenance: scoreMaintenance(evaluation.maintenance, aggregation.maintenance),
    };

    const data = {
        name,
        version: collected.metadata.version,
        description: collected.metadata.description,
        keywords: collected.metadata.keywords,
        publisher: collected.metadata.publisher && collected.metadata.publisher.username,
        maintainers: collected.metadata.maintainers && collected.metadata.maintainers.map((maintainer) => maintainer.username),
        score: {
            final: scoreDetail.quality * 0.3 +
                   scoreDetail.popularity * 0.35 +
                   scoreDetail.maintenance * 0.35,
            detail: scoreDetail,
        },
    };

    return Promise.resolve(esClient.index({
        index: 'npms_write',
        type: 'module',
        id: name,
        body: data,
    }))
    .tap(() => log.verbose(logPrefix, `Stored score data for ${name}`, { data }));
}

module.exports = score;
module.exports.fetch = fetch;
