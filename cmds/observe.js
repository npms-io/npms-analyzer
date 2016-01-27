'use strict';

const log = require('npmlog');
const argv = require('yargs').argv;
const Promise = require('bluebird');
const promiseRetry = require('promise-retry');
const realtime = require('../lib/observers/realtime');
const stale = require('../lib/observers/stale');
const queue = require('../lib/queue');
const statQueue = require('./util/statQueue');

/**
 * Pushes modules into the queue, retrying several times on error.
 * If all retries are used, there isn't much we can do, therefore the process will gracefully exit.
 *
 * @param {array} modules The modules
 *
 * @return {Promise} The promise that fulfills once done
 */
function onModules(modules) {
    return promiseRetry((retry) => {
        let lastErr;

        return Promise.filter(modules, (module) => {
            return analyzeQueue.push(module)
            .then(() => false, (err) => { lastErr = err; return true; });
        })
        .then((failedModules) => {
            if (failedModules.length) {
                modules = failedModules;
                retry(lastErr);
            }
        });
    })
    .catch((err) => {
        log.error('', 'Too much failed attempts while trying to push modules into the queue, exiting..', {
            err,
            modules: modules.slice(0, 10),
            total: modules.length,
        });

        process.exit(1);
    });
}

// ----------------------------------------------------------------------------

// Setup analyzer queue
const analyzeQueue = queue(process.env.RABBITMQ_QUEUE, process.env.RABBITMQ_ADDR)
.once('error', () => process.exit(1));

// Start observing..
stale(process.env.COUCHDB_NPM_ADDR, onModules);
realtime(process.env.COUCHDB_NPM_ADDR, process.env.COUCHDB_NPMS_ADDR, { defaultSeq: argv.defaultSeq }, onModules);

// Print queue stat once in a while
statQueue(analyzeQueue);
