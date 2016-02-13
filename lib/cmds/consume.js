'use strict';

const Promise = require('bluebird');
const argv = require('yargs').argv;
const nano = require('nano');
const analyze = require('../analysis/analyze');
const queue = require('../analysis/queue');
const statQueue = require('./util/statQueue');

function onMessage(msg) {
    return analyze(msg.data, analyzeConfig);
}

// ----------------------------------------------------------------------------

// Setup nano instances
const npmNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPM_ADDR, { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPMS_ADDR, { requestDefaults: { timeout: 15000 } }));

// Setup analyzer queue
const analyzeQueue = queue(process.env.RABBITMQ_QUEUE, process.env.RABBITMQ_ADDR)
.once('error', () => process.exit(1));

// Print queue stat once in a while
statQueue(analyzeQueue);

// Setup analyze config
const analyzeConfig = {
    npmNano,
    npmsNano,
    githubToken: process.env.GITHUB_TOKEN,
};

// Start consuming
analyzeQueue.consume(onMessage, { concurrency: argv.concurrency })
.catch(() => process.exit(1));
