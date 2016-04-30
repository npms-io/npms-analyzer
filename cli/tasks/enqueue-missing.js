'use strict';

const config = require('config');
const difference = require('lodash/difference');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const blacklisted = config.get('blacklist');
const log = logger.child({ module: 'cli/enqueue-missing' });

/**
 * Fetches the npm modules.
 *
 * @param {Nano} npmNano The npm nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function fetchNpmModules(npmNano) {
    return npmNano.listAsync()
    .then((response) => {
        return response.rows
        .map((row) => row.id)
        .filter((id) => id.indexOf('_design/') !== 0 && !blacklisted[id]);
    });
}

/**
 * Fetches the npms modules.
 *
 * @param {Nano} npmsNano The npms nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function fetchNpmsModules(npmsNano) {
    return npmsNano.listAsync({ startkey: 'module!', endkey: 'module!\ufff0' })
    .then((response) => {
        return response.rows.map((row) => row.id.split('!')[1]);
    });
}

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: ./$0 tasks enqueue-missing [options]\n\n\
Finds modules that were not analyzed and enqueues them.\nThis command is useful if modules were lost due to repeated transient \
errors, e.g.: internet connection was lot or GitHub was down.')
    .demand(2, 2)

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
    bootstrap(['couchdbNpm', 'couchdbNpms', 'queue'], { wait: false })
    .spread((npmNano, npmsNano, queue) => {
        // Stats
        stats.process();

        log.info('Fetching npm & npms modules, this might take a while..');

        // Load all modules in memory.. we can do this because the total modules is around ~250k which fit well in memory
        // and is much faster than doing manual iteration ( ~20sec vs ~3min)
        return Promise.all([
            fetchNpmModules(npmNano),
            fetchNpmsModules(npmsNano),
        ])
        .spread((npmModules, npmsModules) => {
            const missingModules = difference(npmModules, npmsModules);

            log.info(`There's a total of ${missingModules.length} missing modules`);
            missingModules.forEach((name) => log.debug(name));

            if (!missingModules.length || argv.dryRun) {
                log.info('Exiting..');
                return;
            }

            return Promise.map(missingModules, (name, index) => {
                index && index % 1000 === 0 && log.info(`Enqueued ${index} modules`);
                return queue.push(name);
            }, { concurrency: 15 })
            .then(() => log.info('Missing modules were enqueued!'));
        })
        .then(() => process.exit()); // Need to force exit because of queue
    })
    .done();
};
