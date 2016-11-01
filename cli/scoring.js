'use strict';

const humanizeDuration = require('humanize-duration');
const prepare = require('../lib/scoring/prepare');
const aggregate = require('../lib/scoring/aggregate');
const score = require('../lib/scoring/score');
const finalize = require('../lib/scoring/finalize');
const bootstrap = require('./util/bootstrap');
const stats = require('./util/stats');

const log = logger.child({ module: 'cli/scoring' });

/**
 * Waits the time needed before running the first cycle.
 *
 * @param {Number}  delay    The delay between each cycle
 * @param {Elastic} esClient The Elasticsearch instance
 *
 * @return {Promise} The promise to be waited
 */
function waitRemaining(delay, esClient) {
    // Need to use Promise.resolve() because Elasticsearch doesn't use the global promise
    return Promise.resolve(esClient.indices.getAlias({ name: 'npms-current' }))
    .then((response) => {
        const index = Object.keys(response)[0];
        const timestamp = Number(index.replace(/^npms\-/, ''));
        const wait = timestamp ? Math.max(0, timestamp + delay - Date.now()) : 0;
        const waitStr = humanizeDuration(Math.round(wait / 1000) * 1000, { largest: 2 });

        wait && log.info({ now: (new Date()).toISOString() }, `Waiting ${waitStr} before running the first cycle..`);

        return Promise.delay(wait);
    })
    .catch((err) => err.status === 404, () => {});
}

/**
 * Runs a scoring cycle.
 * When it finishes, another cycle will be automatically run after a certain delay.
 *
 * @param {Number}  delay    The delay between each cycle
 * @param {Nano}    npmsNano The npm nano instance
 * @param {Elastic} esClient The Elasticsearch instance
 */
function cycle(delay, npmsNano, esClient) {
    const startedAt = Date.now();

    log.info('Starting scoring cycle');

    // Prepare
    prepare(esClient)
    // Aggregate + score all packages
    .tap(() => {
        return aggregate(npmsNano)
        .then((aggregation) => aggregation && score.all(aggregation, npmsNano, esClient));  // If aggregation is null, there were no evaluations
    })
    // Finalize
    .then((esInfo) => finalize(esInfo, esClient))
    // We are done!
    .then(() => {
        const durationStr = humanizeDuration(Math.round((Date.now() - startedAt) / 1000) * 1000, { largest: 2 });

        log.info(`Scoring cycle successful, took ${durationStr}`);
        return delay;
    }, (err) => {
        log.fatal({ err }, 'Scoring cycle failed');
        return 10 * 60 * 1000;
    })
    // Start all over again after a short delay
    .then((wait) => {
        const waitStr = humanizeDuration(Math.round(wait / 1000) * 1000, { largest: 2 });

        log.info({ now: (new Date()).toISOString() }, `Waiting ${waitStr} before running the next cycle..`);

        Promise.delay(wait)
        .then(() => cycle(delay, npmsNano, esClient));
    })
    .done();
}

// ----------------------------------------------------------------------------

exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 scoring [options]\n\n\
Continuously iterate over the analyzed packages, scoring them.')
    .demand(0, 0)

    .option('cycle-delay', {
        type: 'number',
        default: 3 * 60 * 60 * 1000,  // 3 hours
        alias: 'd',
        describe: 'The time to wait between each scoring cycle (in ms)',
    });
};

exports.handler = (argv) => {
    process.title = 'npms-analyzer-scoring';
    logger.level = argv.logLevel || 'warn';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpms', 'elasticsearch'], { wait: true })
    .spread((npmsNano, esClient) => {
        // Stats
        stats.process();

        // Wait for the previous cycle delay if necessary
        return waitRemaining(argv.cycleDelay, esClient)
        // Start the continuous process of scoring!
        .then(() => cycle(argv.cycleDelay, npmsNano, esClient));
    })
    .done();
};
