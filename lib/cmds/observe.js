'use strict';

const log = require('npmlog');
const argv = require('yargs').argv;
const nano = require('nano');
const promiseRetry = require('promise-retry');
const config = require('../../config.json');
const realtime = require('../analysis/observers/realtime');
const stale = require('../analysis/observers/stale');
const queue = require('../analysis/queue');
const statQueue = require('./util/statQueue');

/**
 * Pushes modules into the queue, retrying several times on error.
 * If all retries are used, there isn't much we can do, therefore the process will gracefully exit.
 *
 * @param {array} moduleNames The modules
 *
 * @return {Promise} The promise that fulfills once done
 */
function onModules(moduleNames) {
    return promiseRetry((retry) => {
        let lastErr;

        return Promise.filter(moduleNames, (module) => {
            return analyzeQueue.push(module)
            .then(() => false, (err) => { lastErr = err; return true; });
        })
        .then((failedModuleNames) => {
            if (failedModuleNames.length) {
                moduleNames = failedModuleNames;
                retry(lastErr);
            }
        });
    })
    .catch((err) => {
        log.error('', 'Too much failed attempts while trying to push modules into the queue, exiting..', {
            err,
            modules: moduleNames.slice(0, 10),
            total: moduleNames.length,
        });

        process.exit(1);
    });
}

// ----------------------------------------------------------------------------

// Init analyzer queue
const analyzeQueue = queue(config.rabbitmqQueue, config.rabbitmqAddr)
.once('error', () => process.exit(1));

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(config.couchdbNpmAddr, { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(config.couchdbNpmsAddr, { requestDefaults: { timeout: 15000 } }));

// Start observing..
stale(npmsNano, onModules);
realtime(npmNano, npmsNano, { defaultSeq: argv.defaultSeq }, onModules);

// Print stats
statQueue(analyzeQueue);  // Print queue stat once in a while

