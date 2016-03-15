'use strict';

const config = require('config');
const nano = require('nano');
const log = require('npmlog');
const stats = require('../stats');
const difference = require('lodash/difference');

const blacklisted = config.get('blacklist');
const logPrefix = 'cli/clean-extraneous';

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
    .usage('Finds modules that are analyzed but no longer exist in npm.\nThis command is useful if operations were lost due to repeated \
errors, e.g.: RabbitMQ or CouchDB were down or unstable.\n\nUsage: ./$0 tasks clean-extraneous [options]')
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
    log.level = argv.logLevel || 'info';

    // Prepare DB stuff
    const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

    // Stats
    stats.process();

    log.info(logPrefix, 'Fetching npm & npms modules, this might take a while..');

    // Load all modules in memory.. we can do this because the total modules is around ~250k which fit well in memory
    // and is much faster than doing manual iteration ( ~20sec vs ~3min)
    return Promise.all([
        fetchNpmModules(npmNano),
        fetchNpmsModules(npmsNano),
    ])
    .spread((npmModules, npmsModules) => {
        const extraneousModules = difference(npmsModules, npmModules);

        log.info(logPrefix, `There's a total of ${extraneousModules.length} extraneous modules`);
        extraneousModules.forEach((name) => log.verbose(logPrefix, name));

        if (!extraneousModules.length || argv.dryRun) {
            log.info(logPrefix, 'Exiting..');
            return;
        }

        return Promise.map(extraneousModules, (name, index) => {
            index && index % 100 === 0 && log.info(logPrefix, `Removed ${index} modules`);

            const key = `module!${name}`;

            return npmsNano.getAsync(key)
            .then((doc) => npmsNano.destroyAsync(key, doc._rev));
        }, { concurrency: 15 })
        .then(() => log.info(logPrefix, 'Extraneous modules were removed!'));
    })
    .done();
};
