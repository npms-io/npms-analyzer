'use strict';

const assert = require('assert');
const config = require('config');
const nano = require('nano');
const log = require('npmlog');
const promiseRetry = require('promise-retry');
const realtime = require('../lib/analysis/observers/realtime');
const stale = require('../lib/analysis/observers/stale');
const queue = require('../lib/analysis/queue');
const stats = require('./stats');

/**
 * Pushes modules into the queue, retrying several times on error.
 * If all retries are used, there isn't much we can do, therefore the process will gracefully exit.
 *
 * @param {array} names         The modules
 * @param {Queue} analysisQueue The analysis queue instance
 *
 * @return {Promise} The promise that fulfills once done
 */
function onModules(names, analysisQueue) {
    return promiseRetry((retry) => {
        let lastErr;

        return Promise.filter(names, (module) => {
            return analysisQueue.push(module)
            .then(() => false, (err) => { lastErr = err; return true; });
        })
        .then((failedNames) => {
            if (failedNames.length) {
                names = failedNames;
                retry(lastErr);
            }
        });
    })
    .catch((err) => {
        log.error('', 'Too much failed attempts while trying to push modules into the queue, exiting..', {
            err,
            modules: names.slice(0, 10),
            total: names.length,
        });

        process.exit(1);
    });
}

// ----------------------------------------------------------------------------

module.exports.builder = (yargs) => {
    return yargs
    .usage('Starts the observing process, enqueueing modules that need to be analyzed into the queue.\n\nUsage: ./$0 observe [options]')
    .demand(1, 1)
    .option('default-seq', {
        type: 'number',
        default: 0,
        alias: 'ds',
        describe: 'The default seq to be used on first run',
    })
    .check((argv) => {
        assert(typeof argv.defaultSeq === 'number', 'Invalid argument: --default-seq must be a positive integer');
        return true;
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-observe';
    log.level = argv.logLevel || 'warn';

    // Allow heapdump via USR2 signal
    process.env.NODE_ENV !== 'test' && require('heapdump');  // eslint-disable-line global-require

    // Prepare DB stuff
    const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));
    const analysisQueue = queue(config.get('rabbitmqQueue'), config.get('rabbitmqAddr'));

    // Stats
    stats.process();
    stats.queue(analysisQueue);

    // Start observing..
    realtime(npmNano, npmsNano, { defaultSeq: argv.defaultSeq }, (names) => onModules(names, analysisQueue));
    stale(npmsNano, (names) => onModules(names, analysisQueue));
};
