'use strict';

const assert = require('assert');
const config = require('config');
const analyze = require('../lib/analyze');
const score = require('../lib/scoring/score');
const bootstrap = require('./util/bootstrap');
const stats = require('./util/stats');

// Need JSON.parse & JSON stringify because of config reserved words
// See: https://github.com/lorenwest/node-config/issues/223
const blacklist = JSON.parse(JSON.stringify(config.get('blacklist')));
const gitRefOverrides = JSON.parse(JSON.stringify(config.get('gitRefOverrides')));
const githubTokens = config.get('githubTokens');
const log = logger.child({ module: 'cli/consume' });

/**
 * Handles a message.
 *
 * @param {object}  msg      The message
 * @param {Nano}    npmNano  The npm nano instance
 * @param {Nano}    npmsNano The npms nano instance
 * @param {Elastic} esClient The Elasticsearch instance
 *
 * @return {Promise} A promise that fulfills when consumed
 */
function onMessage(msg, npmNano, npmsNano, esClient) {
    const name = msg.data;

    // Check if this package is blacklisted
    const blacklisted = blacklist[name];

    if (blacklisted) {
        const err = Object.assign(new Error(`Package ${name} is blacklisted`), { code: 'BLACKLISTED', unrecoverable: true });

        return onFailedAnalysis(name, err, npmsNano, esClient)
        .catch(() => {});
    }

    log.info(`Processing package ${name}`);

    // Check if the package has been analyzed after it has been pushed to the queue
    return analyze.get(name, npmsNano)
    .catch({ code: 'ANALYSIS_NOT_FOUND' }, () => {})
    .then((analysis) => {
        if (analysis && Date.parse(analysis.startedAt) >= Date.parse(msg.pushedAt)) {
            log.info(`Skipping analysis of ${name} because it was already analyzed meanwhile`);
            return;
        }

        // If not, analyze it! :D
        return analyze(name, npmNano, npmsNano, {
            githubTokens,
            gitRefOverrides,
            waitRateLimit: true,
            rev: analysis && analysis._rev,
        })
        // Score it to get a "real-time" feeling, ignoring any errors
        .then((analysis) => score(analysis, npmsNano, esClient).catch(() => {}))
        .catch({ code: 'PACKAGE_NOT_FOUND' }, () => score.remove(name, esClient))
        // Ignore unrecoverable errors, so that these are not re-queued
        .catch({ unrecoverable: true }, (err) => {
            return onFailedAnalysis(name, err, npmsNano, esClient)
            .catch(() => {});
        });
    });
}

function onFailedAnalysis(name, err, npmsNano, esClient) {
    // Save the failed analysis, by generating an empty analysis object with the associated error
    return analyze.saveFailed(name, err, npmsNano)
    // Score it to get a "real-time" feeling, ignoring any errors
    .then((analysis) => score(analysis, npmsNano, esClient).catch(() => {}));
}

// ----------------------------------------------------------------------------

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 consume [options]\n\n\
Consumes packages that are queued, triggering the analysis process for each package.')
    .demand(0, 0)
    .option('concurrency', {
        type: 'number',
        default: 5,
        alias: 'c',
        describe: 'Number of packages to consume concurrently',
    })
    .check((argv) => {
        assert(typeof argv.concurrency === 'number', 'Invalid argument: --concurrency must be a number');
        return true;
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-consume';
    logger.level = argv.logLevel || 'warn';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'queue', 'elasticsearch'], { wait: true })
    .spread((npmNano, npmsNano, queue, esClient) => {
        // Stats
        stats.process();
        stats.queue(queue);
        stats.progress(npmNano, npmsNano);
        stats.tokens(githubTokens, 'github');

        // Clean old packages from the download directory
        return analyze.cleanTmpDir()
        // Start consuming
        .then(() => queue.consume((message) => onMessage(message, npmNano, npmsNano, esClient), {
            concurrency: argv.concurrency,
            onRetriesExceeded: (message, err) => onFailedAnalysis(message.data, err, npmsNano, esClient),
        }));
    })
    .done();
};
