'use strict';

const config = require('config');
const difference = require('lodash/difference');
const stats = require('../util/stats');
const bootstrap = require('../util/bootstrap');

const blacklisted = config.get('blacklist');
const log = logger.child({ module: 'cli/clean-extraneous' });

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

// --------------------------------------------------

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 tasks clean-extraneous [options]\n\n\
Finds modules that are analyzed but no longer exist in npm.\nThis command is useful if operations were lost due to repeated \
errors, e.g.: RabbitMQ or CouchDB were down or unstable.')
    .demand(2, 2)

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

    bootstrap(['couchdbNpm', 'couchdbNpms'], { wait: false })
    .spread((npmNano, npmsNano) => {
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
            const extraneousModules = difference(npmsModules, npmModules);

            log.info(`There's a total of ${extraneousModules.length} extraneous modules`);
            extraneousModules.forEach((name) => log.debug(name));

            if (!extraneousModules.length || argv.dryRun) {
                log.info('Exiting..');
                return;
            }

            return Promise.map(extraneousModules, (name, index) => {
                index && index % 100 === 0 && log.info(`Removed ${index} modules`);

                const key = `module!${name}`;

                return npmsNano.getAsync(key)
                .then((doc) => npmsNano.destroyAsync(key, doc._rev));
            }, { concurrency: 15 })
            .then(() => log.info('Extraneous modules were removed!'));
        });
    })
    .done();
};
