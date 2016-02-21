'use strict';

const Promise = require('bluebird');
const argv = require('yargs').argv;
const nano = require('nano');
const analyze = require('../analysis/analyze');
const queue = require('../analysis/queue');
const statQueue = require('./util/statQueue');

function onMessage(msg) {
    return analyze(msg.data, npmNano, npmsNano, {
        githubTokens,
        waitRateLimit: true,
    });
}

// ----------------------------------------------------------------------------

// Split out tokens into an array
const githubTokens = process.env.GITHUB_TOKENS && process.env.GITHUB_TOKENS.split(/\s*,\s*/);

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPM_ADDR, { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPMS_ADDR, { requestDefaults: { timeout: 15000 } }));

// Setup analyzer queue
const analyzeQueue = queue(process.env.RABBITMQ_QUEUE, process.env.RABBITMQ_ADDR)
.once('error', () => process.exit(1));

// Print queue stat once in a while
statQueue(analyzeQueue);

// Start consuming
analyzeQueue.consume(onMessage, { concurrency: argv.concurrency })
.catch(() => process.exit(1));
