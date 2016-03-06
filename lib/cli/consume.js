'use strict';

const config = require('config');
const argv = require('yargs').argv;
const nano = require('nano');
const log = require('npmlog');
const analyze = require('../analysis/analyze');
const queue = require('../analysis/queue');
const stats = require('./stats');

function onMessage(msg) {
    const moduleName = msg.data;

    // Check if this module is blacklisted
    // If it does, fail with an error that signals that this module should not be analyzed again
    const blacklisted = config.get('blacklist')[moduleName];

    if (blacklisted) {
        log.info('', `Module ${moduleName} is blacklisted`, { reason: blacklisted });
        return Promise.resolve();
    }

    return analyze(msg.data, npmNano, npmsNano, {
        githubTokens: config.get('githubTokens'),
        waitRateLimit: true,
    })
    .catch((err) => {
        // Ignore unrecoverable errors, so that these are not re-queued
        if (err.unrecoverable) {
            log.warn('', `Analysis of ${moduleName} failed with an unrecoverable error, ignoring..`);
        } else {
            throw err;
        }
    });
}

// ----------------------------------------------------------------------------

// Allow heapdump via USR2 signal
try {
    process.env.NODE_ENV !== 'production' && require('heapdump');  // eslint-disable-line global-require
} catch (err) { /* ignore */ }

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

// Init analyzer queue
const analyzeQueue = queue(config.get('rabbitmqQueue'), config.get('rabbitmqAddr'));

// Stats
stats.process();
stats.queue(analyzeQueue);
stats.progress(npmNano, npmsNano);
stats.tokens(config.get('githubTokens'), 'github');

// Start consuming
analyzeQueue.consume(onMessage, { concurrency: argv.concurrency })
.catch(() => process.exit(1));

// TODO: cleanup temporary folder
// TODO: not analyze if pushedAt < finishedAt of analysis
