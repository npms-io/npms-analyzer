'use strict';

const solveCubic = require('./util/solveCubic');
const couchdbIterator = require('couchdb-iterator');
const aggregate = require('./aggregate');
const weightedMean = require('weighted-mean');
const clamp = require('lodash/clamp');

const avgY = 1; // [0, 1]
const log = logger.child({ module: 'scoring/score' });

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
    if (value <= 0) {
        return 0;
    }

    const normValue = clamp((value - aggregation.min) / aggregation.max, 0, 1);
    const normAvg = clamp((aggregation.truncatedMean - aggregation.min) / aggregation.max, 0, 1);
    const roots = solveCubic(-3 * normAvg, 3 * normAvg, -1 * normValue);

    let t = null;

    roots.some((value) => {
        if (value > 0 && value < 1) {
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

        log.error({ roots, normValue, normAvg, value, aggregation },
            'Solving the Cubic formula failed, probably aggregation is incorrect.');

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

    return weightedMean([
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

    return weightedMean([
        [scores.communityInterest, 2],
        [scores.downloadsCount, 2],
        [scores.downloadsAcceleration, 1],
        [scores.dependentsCount, 2],
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
        releasesFrequency: calculateScore(maintenance.releasesFrequency, aggregation.releasesFrequency),
        commitsFrequency: calculateScore(maintenance.commitsFrequency, aggregation.commitsFrequency),
        openIssues: calculateScore(maintenance.openIssues, aggregation.openIssues),
        issuesDistribution: calculateScore(maintenance.issuesDistribution, aggregation.issuesDistribution),
    };

    return weightedMean([
        [scores.releasesFrequency, 2],
        [scores.commitsFrequency, 1],
        [scores.openIssues, 1],
        [scores.issuesDistribution, 2],
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
        module: {
            name,
            version: collected.metadata.version,
            description: collected.metadata.description,
            keywords: collected.metadata.keywords,
            date: collected.metadata.date,
            links: collected.metadata.links,
            publisher: collected.metadata.publisher,
            maintainers: collected.metadata.maintainers,
        },
        evaluation,
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
    .then(() => log.trace(`Removed score of ${name}`));
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
        id: score.module.name,
        body: score,
    }))
    .then(() => log.trace({ score }, `Stored score for ${score.module.name}`))
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
    log.info({ aggregation }, 'Scoring modules..');

    return couchdbIterator(npmsNano, (row) => {
        row.index && row.index % 10000 === 0 && log.info(`Scored a total of ${row.index} modules`);

        if (!row.doc) {
            return;
        }

        const name = row.id.split('!')[1];

        return save(buildScore(row.doc, aggregation), esClient)
        .then((score) => {
            log.trace({ score }, `Scoring of ${name} completed`);
            return score;
        }, (err) => {
            log.error({ err }, `Scoring of of ${name} failed`);
            throw err;
        });
    }, {
        startkey: 'module!',
        endkey: 'module!\ufff0',
        concurrency: 50,
        limit: 2500,
        includeDocs: true,
    })
    .tap((count) => log.info(`Scoring modules completed, scored a total of ${count} modules`));
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

    log.trace(`Scoring ${name}..`);

    return aggregate.get(npmsNano)
    .then((aggregation) => save(buildScore(analysis, aggregation), esClient))
    .then((score) => {
        log.debug({ score }, `Scoring of ${name} completed`);
        return score;
    }, (err) => {
        log.error({ err }, `Scoring of ${name} failed`);
        throw err;
    });
}

module.exports = score;
module.exports.get = get;
module.exports.save = save;
module.exports.remove = remove;
module.exports.all = all;
