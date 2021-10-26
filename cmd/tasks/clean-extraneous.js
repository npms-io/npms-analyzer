'use strict';

const stats = require('../util/stats');
const bootstrap = require('../util/bootstrap');

const log = logger.child({ module: 'cli/clean-extraneous' });

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
    .then((response) =>
        response.rows.map((row) =>
            row.id
            .split('!')
            .slice(1)
            .join('!')
        ));
}

/**
 * Fetches the npms packages.
 *
 * @param {Nano} npmsNano - The npms nano instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function fetchNpmsObservedPackages(npmsNano) {
    log.info('Fetching npms observed packages, this might take a while..');

    return npmsNano.listAsync({ startkey: 'observer!package!', endkey: 'observer!package!\ufff0' })
    .then((response) =>
        response.rows.map((row) =>
            row.id
            .split('!')
            .slice(2)
            .join('!')
        ));
}

/**
 * Calculates which npms packages are considered extraneous and removes them.
 *
 * @param {Array}   npmPackages  - All npm packages.
 * @param {Array}   npmsPackages - All npms packages.
 * @param {Nano}    npmsNano     - The npms nano instance.
 * @param {Boolean} dryRun       - True to do a dry-run, false otherwise.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function cleanExtraneousNpmsPackages(npmPackages, npmsPackages, npmsNano, dryRun) {
    log.info(
        { npmPackagesCount: npmPackages.length, npmsPackagesCount: npmsPackages.length },
        'Calculating extraneous packages, this might take a while..'
    );

    const npmPackagesSet = new Set(npmPackages);
    const extraneousPackages = npmsPackages.filter((name) => !npmPackagesSet.has(name));

    log.info(`There's a total of ${extraneousPackages.length} extraneous packages`);
    extraneousPackages.forEach((name) => log.debug(name));

    if (!extraneousPackages.length) {
        return;
    }

    if (dryRun) {
        log.info('This is a dry-run, skipping..');

        return;
    }

    let count = 0;

    return Promise.map(extraneousPackages, (name) => {
        count += 1;
        count % 100 === 0 && log.info(`Removed ${count} packages`);

        const key = `package!${name}`;

        return npmsNano.getAsync(key)
        .then((doc) => npmsNano.destroyAsync(key, doc._rev));
    }, { concurrency: 15 })
    .then(() => log.info('Extraneous packages were removed!'));
}

/**
 * Calculates which npms observed packages are considered extraneous and removes them.
 *
 * @param {Array}   npmPackages          - All npm packages.
 * @param {Array}   npmsObservedPackages - All npms observed packages.
 * @param {Nano}    npmsNano             - The npms nano instance.
 * @param {Boolean} dryRun               - True to do a dry-run, false otherwise.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function cleanExtraneousNpmsObservedPackages(npmPackages, npmsObservedPackages, npmsNano, dryRun) {
    log.info(
        { npmPackagesCount: npmPackages.length, npmsObservedPackagesCount: npmsObservedPackages.length },
        'Calculating extraneous observed packages, this might take a while..'
    );

    const npmPackagesSet = new Set(npmPackages);
    const extraneousPackages = npmsObservedPackages.filter((name) => !npmPackagesSet.has(name));

    log.info(`There's a total of ${extraneousPackages.length} extraneous observed packages`);
    extraneousPackages.forEach((name) => log.debug(name));

    if (!extraneousPackages.length || dryRun) {
        log.info('This is a dry-run, skipping..');

        return;
    }

    let count = 0;

    return Promise.map(extraneousPackages, (name) => {
        count += 1;
        count % 100 === 0 && log.info(`Removed ${count} observed packages`);

        const key = `observer!package!${name}`;

        return npmsNano.getAsync(key)
        .then((doc) => npmsNano.destroyAsync(key, doc._rev));
    }, { concurrency: 15 })
    .then(() => log.info('Extraneous observed packages were removed!'));
}

// --------------------------------------------------

exports.command = 'clean-extraneous [options]';
exports.describe = 'Finds packages that are analyzed but no longer exist in npm';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks clean-extraneous [options]\n\n\
Finds packages that are analyzed but no longer exist in npm.\nThis command is useful if operations were lost due to repeated \
errors, e.g.: RabbitMQ or CouchDB were down or unstable.')

    .option('dry-run', {
        alias: 'dr',
        type: 'boolean',
        default: false,
        describe: 'Enables dry-run',
    });

exports.handler = (argv) => {
    process.title = 'npms-analyzer-clean-extraneous';
    logger.level = argv.logLevel;

    bootstrap(['couchdbNpm', 'couchdbNpms'])
    .spread((npmNano, npmsNano) => {
        // Stats
        stats.process();

        // The strategy below loads all packages in memory.. we can do this because the total packages is around ~250k
        // which fit well in memory and is much faster than doing manual iteration (~20sec vs ~3min)

        // Fetch npm packages
        return fetchNpmPackages(npmNano)
        // Fetch npms packages & clean extraneous
        .tap((npmPackages) => (
            fetchNpmsPackages(npmsNano)
            .then((npmsPackages) => cleanExtraneousNpmsPackages(npmPackages, npmsPackages, npmsNano, argv.dryRun))
        ))
        // Fetch npms observed packages & clean extraneous
        .then((npmPackages) => (
            fetchNpmsObservedPackages(npmsNano)
            .then((npmsObservedPackages) => cleanExtraneousNpmsObservedPackages(npmPackages, npmsObservedPackages, npmsNano, argv.dryRun))
        ));
    })
    .then(() => process.exit())
    .done();
};
