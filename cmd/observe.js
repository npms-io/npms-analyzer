'use strict';

const assert = require('assert');
const config = require('config');
const promiseRetry = require('promise-retry');
const realtime = require('../lib/observers/realtime');
const stale = require('../lib/observers/stale');
const bootstrap = require('./util/bootstrap');
const stats = require('./util/stats');

const log = logger.child({ module: 'cli/observe' });

/**
 * Pushes a package into the queue, retrying several times on error.
 * If all retries are used, there isn't much we can do, therefore the process will gracefully exit.
 *
 * @param {Array}  name     - The package name.
 * @param {Number} priority - The priority to assign to this package when pushing into the queue.
 * @param {Queue}  queue    - The analysis queue instance.
 *
 * @returns {Promise} The promise that fulfills once done.
 */
function onPackage(name, priority, queue) {
    return promiseRetry((retry) => (
        queue.push(name, priority)
        .catch(retry)
    ))
    .catch((err) => {
        log.fatal({ err, name }, 'Too many failed attempts while trying to push the package into the queue, exiting..');
        process.exit(1);
    });
}

// ----------------------------------------------------------------------------

exports.command = 'observe [options]';
exports.describe = 'Consumes modules from the queue, analyzing them';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 observe [options]\n\n\
Starts the observing process, enqueueing packages that need to be analyzed into the queue.')

    .default('log-level', 'error')

    .option('default-seq', {
        type: 'number',
        default: 0,
        alias: 'ds',
        describe: 'The default seq to be used on first run',
    })

    .check((argv) => {
        assert(argv.defaultSeq >= 0, 'Invalid argument: --default-seq must be a number greater or equal to 0');

        return true;
    });

exports.handler = (argv) => {
    process.title = 'npms-analyzer-observe';
    logger.level = argv.logLevel || 'error';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'queue'], { wait: true })
    .spread((npmNano, npmsNano, queue) => {
        // Stats
        stats.process();
        stats.queue(queue);

        // Start observing..
        config.observers.realtime &&
            realtime(npmNano, npmsNano, { defaultSeq: argv.defaultSeq }, (name) => onPackage(name, 1, queue));
        config.observers.stale &&
            stale(npmsNano, (name) => onPackage(name, 0, queue));
    })
    .done();
};
