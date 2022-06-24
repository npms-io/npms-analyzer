'use strict';

const difference = require('lodash/difference');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/enqueue-missing' });

/**
 * Fetches the npm packages.
 *
 * @param {Nano} npmNano - The npm nano instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function fetchNpmPackages(npmNano) {
    log.info('Fetching npm packages, this might take a while..');

    return npmNano.listAsync()
    .then((response) => (
        response.rows
        .map((row) => row.id)
        .filter((id) => id.indexOf('_design/') !== 0)
    ));
}

/**
 * Fetches the npms packages.
 *
 * @param {Nano} npmsNano - The npms nano instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function fetchNpmsPackages(npmsNano) {
    log.info('Fetching npms packages, this might take a while..');

    return npmsNano.listAsync({ startkey: 'package!', endkey: 'package!\ufff0' })
    .then((response) => response.rows.map((row) => row.id.split('!')[1]));
}

/**
 * Calculates which packages are missing and enqueues them.
 *
 * @param {Array}   npmPackages  - All npm packages.
 * @param {Array}   npmsPackages - All npms packages.
 * @param {Queue}   queue        - The analysis queue instance.
 * @param {Boolean} dryRun       - True to do a dry-run, false otherwise.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function enqueueMissingPackages(npmPackages, npmsPackages, queue, dryRun) {
    const missingPackages = difference(npmPackages, npmsPackages);

    log.info(`There's a total of ${missingPackages.length} missing packages`);
    missingPackages.forEach((name) => log.debug(name));

    if (!missingPackages.length) {
        return;
    }

    if (dryRun) {
        log.info('This is a dry-run, skipping..');

        return;
    }

    let count = 0;

    return Promise.map(missingPackages, (name) => {
        count += 1;
        count % 1000 === 0 && log.info(`Enqueued ${count} packages`);

        return queue.push(name);
    }, { concurrency: 15 })
    .then(() => log.info('Missing packages were enqueued!'));
}

// --------------------------------------------------

exports.command = 'enqueue-missing [options]';
exports.describe = 'Finds packages that were not analyzed and enqueues them';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks enqueue-missing [options]\n\n\
Finds packages that were not analyzed and enqueues them.\nThis command is useful if packages were lost due to repeated transient \
errors, e.g.: internet connection was lot or GitHub was down.')

    .option('dry-run', {
        alias: 'dr',
        type: 'boolean',
        default: false,
        describe: 'Enables dry-run',
    });

exports.handler = (argv) => {
    process.title = 'npms-analyzer-enqueue-missing';
    logger.level = argv.logLevel;

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'queue'])
    .spread((npmNano, npmsNano, queue) => {
        // Stats
        stats.process();

        // The strategy below loads all packages in memory.. we can do this because the total packages is around ~250k
        // which fit well in memory and is much faster than doing manual iteration (~20sec vs ~3min)

        return Promise.all([
            fetchNpmPackages(npmNano),
            fetchNpmsPackages(npmsNano),
        ])
        .spread((npmPackages, npmsPackages) => enqueueMissingPackages(npmPackages, npmsPackages, queue, argv.dryRun));
    })
    .then(() => process.exit())
    .done();
};
