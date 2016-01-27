'use strict';

const Promise = require('bluebird');
const argv = require('yargs').argv;
const queue = require('../lib/queue');
const statQueue = require('./util/statQueue');

function onMessage(/* msg */) {
    return Promise.delay(1000);
}

// ----------------------------------------------------------------------------

// Setup analyzer queue
const analyzeQueue = queue(process.env.RABBITMQ_QUEUE, process.env.RABBITMQ_ADDR)
.once('error', () => process.exit(1));

// Print queue stat once in a while
statQueue(analyzeQueue);

// Start consuming
analyzeQueue.consume(onMessage, { concurrency: argv.concurrency })
.catch(() => process.exit(1));
