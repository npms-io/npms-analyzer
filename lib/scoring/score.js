'use strict';

const couchdbIterator = require('couchdb-iterator');
const weightedMean = require('weighted-mean');
const semver = require('semver');
const deepCompact = require('deep-compact');
const clamp = require('lodash/clamp');
const pick = require('lodash/pick');
const aggregate = require('./aggregate');
const { solveCubic } = require('./util/paperNumerical');

const log = logger.child({ module: 'scoring/score' });

/**
 * Computes the quality score.
 *
 * @param {Object} quality     - The quality evaluation.
 * @param {Object} aggregation - The quality aggregation.
 *
 * @returns {Number} The score.
 */
function scoreQuality(quality, aggregation) {
    const scores = {
        carefulness: calculateScore(quality.carefulness, aggregation.carefulness, 0.8),
        tests: calculateScore(quality.tests, aggregation.tests, 0.7),
        health: calculateScore(quality.health, aggregation.health, 1),
        branding: calculateScore(quality.branding, aggregation.branding, 1),
    };

    return weightedMean([
        [scores.carefulness, 7],
        [scores.tests, 7],
        [scores.health, 4],
        [scores.branding, 2],
    ]);
}

/**
 * Computes the popularity score.
 *
 * @param {Object} popularity  - The popularity evaluation.
 * @param {Object} aggregation - The popularity aggregation.
 *
 * @returns {Number} The score.
 */
function scorePopularity(popularity, aggregation) {
    const scores = {
        communityInterest: calculateScore(popularity.communityInterest, aggregation.communityInterest, 1),
        downloadsCount: calculateScore(popularity.downloadsCount, aggregation.downloadsCount, 1),
        downloadsAcceleration: calculateScore(popularity.downloadsAcceleration, aggregation.downloadsAcceleration, 1),
        // dependentsCount: calculateScore(popularity.dependentsCount, aggregation.dependentsCount, 1),
    };

    return weightedMean([
        [scores.communityInterest, 2],
        [scores.downloadsCount, 2],
        [scores.downloadsAcceleration, 1],
        // [scores.dependentsCount, 2],
    ]);
}

/**
 * Computes the maintenance score.
 *
 * @param {Object} maintenance - The maintenance evaluation.
 * @param {Object} aggregation - The maintenance aggregation.
 *
 * @returns {Number} The score.
 */
function scoreMaintenance(maintenance, aggregation) {
    const scores = {
        releasesFrequency: calculateScore(maintenance.releasesFrequency, aggregation.releasesFrequency, 1),
        commitsFrequency: calculateScore(maintenance.commitsFrequency, aggregation.commitsFrequency, 1),
        openIssues: calculateScore(maintenance.openIssues, aggregation.openIssues, 1),
        issuesDistribution: calculateScore(maintenance.issuesDistribution, aggregation.issuesDistribution, 1),
    };

    return weightedMean([
        [scores.releasesFrequency, 2],
        [scores.commitsFrequency, 1],
        [scores.openIssues, 1],
        [scores.issuesDistribution, 2],
    ]);
}

/**
 * Calculates the score of a value taking into the consideration its aggregation (min, max, mean).
 *
 * The mathematical formula can be "previewed" here: Https://github.com/npms-io/npms-analyzer/blob/master/docs/diagrams/bezier.png.
 * It's a bezier curve, with the following points: (0,0), (normValue, avgY), (normValue, avgY) and (1, 1).
 * Thanks @atduarte for this awesome equation.
 *
 * @param {Number} value       - The value.
 * @param {Object} aggregation - The aggregation for the value.
 * @param {Number} avgY        - The avgY value to use for the intermediate point.
 *
 * @returns {Number} The score.
 */
function calculateScore(value, aggregation, avgY) {
    // Normalize value and mean
    const normValue = clamp((value - aggregation.min) / aggregation.max, 0, 1);
    const normMean = clamp((aggregation.truncatedMean - aggregation.min) / aggregation.max, 0, 1);

    // Calculate the cubic roots
    const roots = [];

    solveCubic(1, -3 * normMean, 3 * normMean, -1 * normValue, roots, 0, 1);

    const t = roots[0];

    if (t == null) {
        throw Object.assign(new Error('Solving the cubic formula failed, probably aggregation is incorrect'),
            { code: 'SCORE_CUBIC_MISMATCH', roots, normValue, normMean, value, aggregation });
    }

    // Calculate the point in the bezier curve
    return (t ** 3) - (3 * avgY * (t ** 2)) + (3 * t * avgY);
}

/**
 * Calculates and builds the score data to be indexed in Elasticsearch.
 *
 * @param {Object} analysis    - The package analysis.
 * @param {Object} aggregation - The most up to date aggregation.
 *
 * @returns {Object} The score data.
 */
function buildScore(analysis, aggregation) {
    const collected = analysis.collected;
    const evaluation = analysis.evaluation;

    const scoreDetail = {
        quality: scoreQuality(evaluation.quality, aggregation.quality),
        popularity: scorePopularity(evaluation.popularity, aggregation.popularity),
        maintenance: scoreMaintenance(evaluation.maintenance, aggregation.maintenance),
    };

    return deepCompact({
        package: pick(collected.metadata, [
            'name', 'scope', 'version', 'description', 'keywords', 'date', 'links',
            'author', 'publisher', 'maintainers',
        ]),
        flags: analysis.error && collected.metadata.version === '0.0.0' ? null : {
            deprecated: collected.metadata.deprecated,
            insecure: collected.source && collected.source.vulnerabilities ? collected.source.vulnerabilities.length : null,
            unstable: semver.lt(collected.metadata.version, '1.0.0', true) ? true : null,
        },
        evaluation,
        score: {
            final: (scoreDetail.quality * 0.3) +
                   (scoreDetail.popularity * 0.35) +
                   (scoreDetail.maintenance * 0.35),
            detail: scoreDetail,
        },
    });
}

/**
 * Get the score indices that are currently available as an array.
 *
 * This function is necessary to avoid calling POST, DELETE or other document operations that attempt to
 * auto-create the index automatically. These operations will fail because we explicitly disabled index auto-creation.
 * A lot of errors are outputted to Elasticsearch error log and we want to avoid that.
 *
 * @param {Elastic} esClient - The Elasticsearch instance.
 *
 * @returns {Promise} A promise that fulfills when done.
 */
function getLivingIndices(esClient) {
    const indices = ['npms-current', 'npms-new'];

    return Promise.map(indices, (index) => esClient.indices.exists({ index }))
    .then((exists) => indices.filter((index, x) => exists[x]))
    .tap((livingIndices) => log.trace({ livingIndices }, 'Got living score indices'));
}

/**
 * Stores a package score in `npms-current` and `npms-new` indices.
 *
 * If none of the indices exist, the operation fails.
 *
 * @param {Object}  score         - The score data.
 * @param {Object}  livingIndices - The array from getLivingIndices().
 * @param {Elastic} esClient      - The Elasticsearch instance.
 *
 * @returns {Promise} A promise that fulfills when done.
 */
function storeScore(score, livingIndices, esClient) {
    // Fail if none exist
    if (!livingIndices.length) {
        return Promise.reject(Object.assign(new Error('There are no scoring indices'), { code: 'SCORE_INDEX_NOT_FOUND' }));
    }

    const name = score.package.name;

    return Promise.map(livingIndices, (index) => (
        esClient.index({ index, type: 'score', id: name, body: score })
        .catch({ status: 404 }, () => {
            throw Object.assign(new Error(`Index ${index} was deleted meanwhile`), { code: 'SCORE_INDEX_NOT_FOUND' });
        })
    ))
    .return(score)
    .tap(() => log.trace({ score, livingIndices }, `Stored score of ${name}`));
}

// -------------------------------------------------------------------

/**
 * Gets a package score data.
 *
 * @param {String} name      - The package name.
 * @param {Elastic} esClient - The Elasticsearch instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function get(name, esClient) {
    // Need to use Promise.resolve() because Elasticsearch doesn't use the global promise
    return Promise.resolve(esClient.get({ index: 'npms-current', type: 'score', id: name }))
    .get('_source')
    .catch({ status: 404 }, () => {
        throw Object.assign(new Error(`Score for ${name} does not exist`), { code: 'SCORE_NOT_FOUND' });
    });
}

/**
 * Removes a package score data.
 *
 * Removes score data from both `npms-current` and `npms-new` indices.
 *
 * @param {String} name      - The package name.
 * @param {Elastic} esClient - The Elasticsearch instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function remove(name, esClient) {
    // Check current indices
    return getLivingIndices(esClient)
    // Remove package from each of them
    .tap((livingIndices) => (
        Promise.map(livingIndices, (index) => (
            // Need to use Promise.resolve() because Elasticsearch doesn't use the global promise
            Promise.resolve(esClient.delete({ index, type: 'score', id: name }))
            .catch({ status: 404 }, () => {}) // Just in case..
        ))
    )
    .then(() => log.trace({ livingIndices }, `Removed score of ${name}`)));
}

/**
 * Saves a package score data.
 *
 * Stores score data in `npms-current` and `npms-new` indices.
 * If none of the indices exist, the operation fails.
 *
 * @param {Object} score     - The score data.
 * @param {Elastic} esClient - The Elasticsearch instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function save(score, esClient) {
    // Check the existence of `npms-current` and `npms-new` indices
    return getLivingIndices(esClient)
    // Store the score in the indices
    .then((livingIndices) => storeScore(score, livingIndices, esClient));
}

/**
 * Scores all packages.
 *
 * Scores are stored only in the `npms-new` index.
 * If none of the indices exist, the operation fails.
 *
 * @param {Object}  aggregation - The most up to date aggregation.
 * @param {Nano}    npmsNano - The npm nano instance.
 * @param {Elastic} esClient - The Elasticsearch instance.
 *
 * @returns {Promise} A promise that fulfills when done.
 */
function all(aggregation, npmsNano, esClient) {
    // Check if the `npms-new` index exists
    return getLivingIndices(esClient)
    .then((livingIndices) => {
        if (livingIndices.indexOf('npms-new') === -1) {
            throw Object.assign(new Error('There is no `npms-new` scoring index'), { code: 'SCORE_INDEX_NOT_FOUND' });
        }

        return ['npms-new'];
    })
    // Iterate over all packages and score them!
    .then((livingIndices) => {
        log.info({ aggregation }, 'Scoring packages..');

        return couchdbIterator(npmsNano, (row) => {
            row.index && row.index % 10000 === 0 && log.info(`Scored a total of ${row.index} packages`);

            if (!row.doc) {
                return;
            }

            const analysis = row.doc;
            const name = analysis.collected.metadata.name;

            // Store the score in the indices
            return Promise.try(() => storeScore(buildScore(analysis, aggregation), livingIndices, esClient))
            .then((score) => {
                log.debug({ score, livingIndices }, `Score of ${name} completed`);
            }, (err) => {
                log.error({ err }, `Score of ${name} failed`);

                // Surpress cubic errors
                if (err.code !== 'SCORE_CUBIC_MISMATCH') {
                    throw err;
                }
            });
        }, {
            startkey: 'package!',
            endkey: 'package!\ufff0',
            concurrency: 50,
            limit: 2500,
            includeDocs: true,
        })
        .tap((count) => log.info(`Scoring packages completed, scored a total of ${count} packages`));
    });
}

/**
 * Scores a package, indexing its result in Elasticsearch to be searchable.
 *
 * @param {objects} analysis - The package analysis.
 * @param {Nano}    npmsNano - The npms nano client instance.
 * @param {Elastic} esClient - The Elasticsearch instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function score(analysis, npmsNano, esClient) {
    const name = analysis.collected.metadata.name;

    return aggregate.get(npmsNano)
    .then((aggregation) => save(buildScore(analysis, aggregation), esClient))
    .then((score) => {
        log.debug({ score }, `Score of ${name} completed`);

        return score;
    }, (err) => {
        log.error({ err }, `Score of ${name} failed`);
        throw err;
    });
}

module.exports = score;
module.exports.get = get;
module.exports.save = save;
module.exports.remove = remove;
module.exports.all = all;
