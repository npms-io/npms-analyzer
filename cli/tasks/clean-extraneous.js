'use strict';

const difference = require('lodash/difference');
const stats = require('../util/stats');
const bootstrap = require('../util/bootstrap');

const log = logger.child({ module: 'cli/clean-extraneous' });

/**
 * Fetches the npm packages.
 *
 * @param {Nano} npmNano The npm nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function fetchNpmPackages(npmNano) {
    log.info('Fetching npm packages, this might take a while..');

    return npmNano.listAsync()
    .then((response) => {
        return response.rows
        .map((row) => row.id)
        .filter((id) => id.indexOf('_design/') !== 0);
    });
}

/**
 * Fetches the npms packages.
 *
 * @param {Nano} npmsNano The npms nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function fetchNpmsPackages(npmsNano) {
    log.info('Fetching npms packages, this might take a while..');

    return npmsNano.listAsync({ startkey: 'package!', endkey: 'package!\ufff0' })
    .then((response) => {
        return response.rows.map((row) => row.id.split('!')[1]);
    });
}

/**
 * Fetches the npms packages.
 *
 * @param {Nano} npmsNano The npms nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function fetchNpmsObservedPackages(npmsNano) {
    log.info('Fetching npms observed packages, this might take a while..');

    return npmsNano.listAsync({ startkey: 'observer!package!', endkey: 'observer!package!\ufff0' })
    .then((response) => {
        return response.rows.map((row) => row.id.split('!')[2]);
    });
}

/**
 * Calculates which npms packages are considered extraneous and removes them.
 *
 * @param {array}    npmPackages  All npm packages
 * @param {array}    npmsPackages All npms packages
 * @param {Nano}     npmsNano     The npms nano instance
 * @param {boolean}  dryRun       True to do a dry-run, false otherwise
 *
 * @return {Promise} The promise that fulfills when done
 */
function cleanExtraneousNpmsPackages(npmPackages, npmsPackages, npmsNano, dryRun) {
    const extraneousPackages = difference(npmsPackages, npmPackages);

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
 * @param {array}    npmPackages          All npm packages
 * @param {array}    npmsObservedPackages All npms observed packages
 * @param {Nano}     npmsNano             The npms nano instance
 * @param {boolean}  dryRun               True to do a dry-run, false otherwise
 *
 * @return {Promise} The promise that fulfills when done
 */
function cleanExtraneousNpmsObservedPackages(npmPackages, npmsObservedPackages, npmsNano, dryRun) {
    const extraneousPackages = difference(npmsObservedPackages, npmPackages);

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

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 tasks clean-extraneous [options]\n\n\
Finds packages that are analyzed but no longer exist in npm.\nThis command is useful if operations were lost due to repeated \
errors, e.g.: RabbitMQ or CouchDB were down or unstable.')
    .demand(0, 0)

    .option('dry-run', {
        alias: 'dr',
        type: 'boolean',
        default: false,
        describe: 'Enables dry-run',
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-clean-extraneous';
    logger.level = argv.logLevel || 'info';

    bootstrap(['couchdbNpm', 'couchdbNpms'])
    .spread((npmNano, npmsNano) => {
        // Stats
        stats.process();

        // The strategy below loads all packages in memory.. we can do this because the total packages is around ~250k
        // which fit well in memory and is much faster than doing manual iteration (~20sec vs ~3min)

        // Fetch npm packages
        return fetchNpmPackages(npmNano)
        // Fetch npms packages & clean extraneous
        .tap((npmPackages) => {
            return fetchNpmsPackages(npmsNano)
            .then((npmsPackages) => cleanExtraneousNpmsPackages(npmPackages, npmsPackages, npmsNano, argv.dryRun));
        })
        // Fetch npms observed packages & clean extraneous
        .then((npmPackages) => {
            return fetchNpmsObservedPackages(npmsNano)
            .then((npmsObservedPackages) => cleanExtraneousNpmsObservedPackages(npmPackages, npmsObservedPackages, npmsNano, argv.dryRun));
        });
    })
    .then(() => process.exit())
    .done();
};
