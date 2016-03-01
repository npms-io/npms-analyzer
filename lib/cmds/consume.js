'use strict';

const Promise = require('bluebird');
const argv = require('yargs').argv;
const nano = require('nano');
const config = require('../../config.json');
const analyze = require('../analysis/analyze');
const queue = require('../analysis/queue');
const statQueue = require('./util/statQueue');
const statTokens = require('./util/statTokens');
const statProgress = require('./util/statProgress');

function onMessage(msg) {
    return analyze(msg.data, npmNano, npmsNano, {
        githubTokens: config.githubTokens,
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
const npmNano = Promise.promisifyAll(nano(config.couchdbNpmAddr, { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(config.couchdbNpmsAddr, { requestDefaults: { timeout: 15000 } }));

// Init analyzer queue
const analyzeQueue = queue(config.rabbitmqQueue, config.rabbitmqAddr)
.once('error', () => process.exit(1));

// Print stats
statQueue(analyzeQueue);                    // Print queue stat once in a while
statTokens(config.githubTokens, 'github');  // Print token usage once in a while
statProgress(npmNano, npmsNano);            // Print global analysis progress

// Start consuming
analyzeQueue.consume(onMessage, { concurrency: argv.concurrency })
.catch(() => process.exit(1));

// TODO: cleanup temporary folder
// TODO: not analyze if pushedAt < finishedAt of analysis
