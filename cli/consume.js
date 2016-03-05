'use strict';

const config = require('config');
const argv = require('yargs').argv;
const nano = require('nano');
const log = require('npmlog');
const analyze = require('../lib/analysis/analyze');
const queue = require('../lib/analysis/queue');
const statQueue = require('./stat/queue');
const statTokens = require('./stat/tokens');
const statProgress = require('./stat/progress');

function onMessage(msg) {
    const moduleName = msg.data;

    // Check if this module is blacklisted
    // If it does, fail with an error that signals that this module should not be analyzed again
    const blacklisted = config.get('blacklist')[moduleName];

    if (blacklisted) {
        log.info('logPrefix', `Module ${moduleName} is blacklisted`, { reason: blacklisted });
        return Promise.resolve();
    }

    return analyze(msg.data, npmNano, npmsNano, {
        githubTokens: config.get('githubTokens'),
        waitRateLimit: true,
    })
    .catch((err) => {
        // Ignore unrecoverable errors, so that these are not re-queued
        if (!err.unrecoverable) {
            throw err;
        }
    });
}

// ----------------------------------------------------------------------------

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

// Init analyzer queue
const analyzeQueue = queue(config.get('rabbitmqQueue'), config.get('rabbitmqAddr'))
.once('error', () => process.exit(1));

// Print stats
statQueue(analyzeQueue);                           // Print queue stat once in a while
statProgress(npmNano, npmsNano);                   // Print global analysis progress
statTokens(config.get('githubTokens'), 'github');  // Print token usage once in a while

// Start consuming
analyzeQueue.consume(onMessage, { concurrency: argv.concurrency })
.catch(() => process.exit(1));

// TODO: cleanup temporary folder
// TODO: not analyze if pushedAt < finishedAt of analysis
