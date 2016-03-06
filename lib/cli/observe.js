'use strict';

process.title = 'npms-analyzer-observe';

const config = require('config');
const log = require('npmlog');
const argv = require('yargs').argv;
const nano = require('nano');
const promiseRetry = require('promise-retry');
const realtime = require('../analysis/observers/realtime');
const stale = require('../analysis/observers/stale');
const queue = require('../analysis/queue');
const stats = require('./stats');

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

// Allow heapdump's via USR2 signal
try {
    process.env.NODE_ENV !== 'production' && require('heapdump');  // eslint-disable-line global-require
} catch (err) { /* ignore */ }

// Init analyzer queue
const analyzeQueue = queue(config.get('rabbitmqQueue'), config.get('rabbitmqAddr'));

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

// Start observing..
stale(npmsNano, onModules);
realtime(npmNano, npmsNano, { defaultSeq: argv.defaultSeq }, onModules);

// Stats
stats.process();
stats.queue(analyzeQueue);
