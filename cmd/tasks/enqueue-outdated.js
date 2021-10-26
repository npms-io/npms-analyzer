'use strict';

const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/enqueue-outdated' });

/**
 * Fetches the npm packages.
 *
 * @param {Nano} npmNano - The npm nano instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function fetchNpmPackages(npmNano) {
    log.info('Fetching npm packages, this might take a while..');

    return npmNano.viewAsync('npms-analyzer', 'packages-version')
    .then((response) => (
        response.rows
        .map((row) => ({ name: row.key, version: row.value }))
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

    return npmsNano.viewAsync('npms-analyzer', 'packages-version')
    .then((response) => (
        response.rows
        .map((row) => ({ name: row.key, version: row.value }))
    ));
}

/**
 * Calculates which packages are outdated (missing or version mismatch) and enqueues them.
 *
 * @param {Array}   npmPackages  - All npm packages.
 * @param {Array}   npmsPackages - All npms packages.
 * @param {Queue}   queue        - The analysis queue instance.
 * @param {Boolean} dryRun       - True to do a dry-run, false otherwise.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function enqueueOutdated(npmPackages, npmsPackages, queue, dryRun) {
    log.info(
        { npmPackagesCount: npmPackages.length, npmsPackagesCount: npmsPackages.length },
        'Calculating outdated packages, this might take a while..'
    );

    const npmsPackagesMap = npmsPackages.reduce((npmsPackagesMap, pkg) => npmsPackagesMap.set(pkg.name, pkg.version), new Map());
    const outdatedPackages = npmPackages.filter((pkg) => npmsPackagesMap.get(pkg.name) !== pkg.version);

    log.info(`There's a total of ${outdatedPackages.length} outdated packages`);
    outdatedPackages.forEach((pkg) => log.debug(pkg.name));

    if (!outdatedPackages.length) {
        return;
    }

    if (dryRun) {
        log.info('This is a dry-run, skipping..');

        return;
    }

    let count = 0;

    return Promise.map(outdatedPackages, (pkg) => {
        count += 1;
        count % 1000 === 0 && log.info(`Enqueued ${count} packages`);

        return queue.push(pkg.name);
    }, { concurrency: 15 })
    .then(() => log.info('Outdated packages were enqueued!'));
}

// --------------------------------------------------

exports.command = 'enqueue-outdated [options]';
exports.describe = 'Finds packages that are outdated and enqueues them';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks enqueue-outdated [options]\n\n\
Finds packages that are outdated and enqueues them.\nThis command is useful if packages were lost due to repeated transient \
errors, e.g.: internet connection was lot or GitHub was down.')

    .option('dry-run', {
        alias: 'dr',
        type: 'boolean',
        default: false,
        describe: 'Enables dry-run',
    });

exports.handler = (argv) => {
    process.title = 'npms-analyzer-enqueue-outdated';
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
        .spread((npmPackages, npmsPackages) => enqueueOutdated(npmPackages, npmsPackages, queue, argv.dryRun));
    })
    .then(() => process.exit())
    .done();
};
