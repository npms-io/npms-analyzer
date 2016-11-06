'use strict';

const difference = require('lodash/difference');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/enqueue-missing' });

/**
 * Fetches the npm packages.
 *
 * @param {Nano} npmNano The npm nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function fetchNpmPackages(npmNano) {
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
    return npmsNano.listAsync({ startkey: 'package!', endkey: 'package!\ufff0' })
    .then((response) => {
        return response.rows.map((row) => row.id.split('!')[1]);
    });
}

// --------------------------------------------------

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 tasks enqueue-missing [options]\n\n\
Finds packages that were not analyzed and enqueues them.\nThis command is useful if packages were lost due to repeated transient \
errors, e.g.: internet connection was lot or GitHub was down.')
    .demand(0, 0)

    .option('dry-run', {
        alias: 'dr',
        type: 'boolean',
        default: false,
        describe: 'Enables dry-run',
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-enqueue-missing';
    logger.level = argv.logLevel || 'info';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'queue'])
    .spread((npmNano, npmsNano, queue) => {
        // Stats
        stats.process();

        log.info('Fetching npm & npms packages, this might take a while..');

        // Load all packages in memory.. we can do this because the total packages is around ~250k which fit well in memory
        // and is much faster than doing manual iteration ( ~20sec vs ~3min)
        return Promise.all([
            fetchNpmPackages(npmNano),
            fetchNpmsPackages(npmsNano),
        ])
        .spread((npmPackages, npmsPackages) => {
            const missingPackages = difference(npmPackages, npmsPackages);

            log.info(`There's a total of ${missingPackages.length} missing packages`);
            missingPackages.forEach((name) => log.debug(name));

            if (!missingPackages.length || argv.dryRun) {
                log.info('Exiting..');
                return;
            }

            let count = 0;

            return Promise.map(missingPackages, (name) => {
                count += 1;
                count % 1000 === 0 && log.info(`Enqueued ${count} packages`);
                return queue.push(name);
            }, { concurrency: 15 })
            .then(() => log.info('Missing packages were enqueued!'));
        });
    })
    .then(() => process.exit())
    .done();
};
