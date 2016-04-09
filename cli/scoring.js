'use strict';

const config = require('config');
const log = require('npmlog');
const nano = require('nano');
const elasticsearch = require('elasticsearch');
const humanizeDuration = require('humanize-duration');
const prepare = require('../lib/scoring/prepare');
const aggregate = require('../lib/scoring/aggregate');
const score = require('../lib/scoring/score');
const finalize = require('../lib/scoring/finalize');
const stats = require('./stats');

const logPrefix = '';

/**
 * Waits the time needed before running the first cycle.
 *
 * @param {Number}  delay    The delay between each cycle
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} The promise to be waited
 */
function wait(delay, esClient) {
    // Need to use Promise.resolve() due to a bug, see: https://github.com/elastic/elasticsearch-js/pull/362#issuecomment-195950901
    return Promise.resolve(esClient.indices.getAlias({ name: 'npms-read' }))
    .then((response) => {
        const index = Object.keys(response)[0];
        const timestamp = Number(index.replace(/^npms\-/, ''));
        const wait = timestamp ? Math.max(0, timestamp + delay - Date.now()) : 0;
        const waitStr = humanizeDuration(Math.round(wait / 1000) * 1000, { largest: 2 });

        wait && log.info(logPrefix, `Waiting ${waitStr} before running the first cycle..`, { now: (new Date()).toISOString() });

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
 * @param {Elastic} esClient The elasticsearch instance
 */
function cycle(delay, npmsNano, esClient) {
    const startedAt = Date.now();

    log.info(logPrefix, 'Starting scoring cycle');

    // Prepare
    prepare(esClient)
    // Aggregate + score all modules
    .tap(() => {
        return aggregate(npmsNano)
        .then((aggregation) => score.all(aggregation, npmsNano, esClient));
    })
    // Finalize
    .then((esInfo) => finalize(esInfo, esClient))
    // We are done!
    .then(() => {
        const durationStr = humanizeDuration(Math.round((Date.now() - startedAt) / 1000) * 1000, { largest: 2 });

        log.info(logPrefix, `Scoring cycle successful, took ${durationStr}`);
    }, (err) => {
        log.error(logPrefix, 'Scoring cycle failed', { err });
    })
    // Start all over again after a short delay
    .then(() => {
        const delayStr = humanizeDuration(Math.round(delay / 1000) * 1000, { largest: 2 });

        log.info(logPrefix, `Waiting ${delayStr} before running the next cycle..`, { now: (new Date()).toISOString() });

        Promise.delay(delay)
        .then(() => cycle(delay, npmsNano, esClient));
    })
    .done();
}

// ----------------------------------------------------------------------------

exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: ./$0 scoring [options]\n\n\
Continuously iterate over the analyzed modules, scoring them.')
    .demand(1, 1)

    .option('cycle-delay', {
        type: 'number',
        default: 1 * 60 * 60 * 1000,  // 1 hour
        alias: 'd',
        describe: 'The time to wait between each scoring cycle (in ms)',
    });
};

exports.handler = (argv) => {
    process.title = 'npms-analyzer-scoring';
    log.level = argv.logLevel || 'warn';

    // Allow heapdump via USR2 signal
    process.env.NODE_ENV !== 'test' && require('heapdump');  // eslint-disable-line global-require

    // Prepare DB stuff
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));
    const esClient = new elasticsearch.Client({ host: config.get('elasticsearchHost'), apiVersion: '2.2', log: null });

    // Stats
    stats.process();

    // Wait for the previous cycle delay if necessary
    wait(argv.cycleDelay, esClient)
    // Start the continuous process of scoring!
    .then(() => cycle(argv.cycleDelay, npmsNano, esClient));
};
