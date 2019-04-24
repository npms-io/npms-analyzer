'use strict';

const assert = require('assert');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/enqueue-view' });

/**
 * Fetches packages of a view.
 *
 * @param {String} view    - The view in the form of design-doc/view-name.
 * @param {Nano}   npmNano - The npm nano instance.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function fetchView(view, npmNano) {
    log.info(`Fetching view ${view}`);

    const split = view.split('/');

    return npmNano.viewAsync(split[0], split[1])
    .then((response) => (
        response.rows
        .map((row) => row.key.replace(/^package!/, ''))
    ));
}

/**
 * Enqueues packages to be analyzed.
 *
 * @param {Array}   packages - The package names to be enqueued.
 * @param {Queue}   queue    - The analysis queue instance.
 * @param {Boolean} dryRun   - True to do a dry-run, false otherwise.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function enqueueViewPackages(packages, queue, dryRun) {
    log.info(`There's a total of ${packages.length} packages in the view`);
    packages.forEach((name) => log.debug(name));

    if (!packages.length) {
        return;
    }

    if (dryRun) {
        log.info('This is a dry-run, skipping..');

        return;
    }

    let count = 0;

    return Promise.map(packages, (name) => {
        count += 1;
        count % 5000 === 0 && log.info(`Enqueued ${count} packages`);

        return queue.push(name);
    }, { concurrency: 15 })
    .then(() => log.info('View packages were enqueued!'));
}

// --------------------------------------------------

exports.command = 'enqueue-view <view> [options]';
exports.describe = 'Enqueues all packages contained in a npms view';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks enqueue-view <design-doc/view-name> [options]\n\n\
Enqueues all packages contained in the npms database view.\n\nNOTE: The view must be in the npms database and the key must be the package \
name (may be prefixed with `package!`)')
    .example('$0 tasks enqueue-view npms-analyzer/docs-to-be-fixed')

    .option('dry-run', {
        alias: 'dr',
        type: 'boolean',
        default: false,
        describe: 'Enables dry-run',
    })

    .check((argv) => {
        assert(/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(argv.view), 'The view argument must match the following format: <design-doc/view-name>');

        return true;
    });

exports.handler = (argv) => {
    process.title = 'npms-analyzer-enqueue-view';
    logger.level = argv.logLevel;

    const view = argv.view;

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'queue'])
    .spread((npmNano, npmsNano, queue) => {
        // Stats
        stats.process();

        // The strategy below loads all packages in memory.. we can do this because the total packages is around ~250k
        // which fit well in memory and is much faster than doing manual iteration (~20sec vs ~3min)

        return fetchView(view, npmsNano)
        .then((packages) => enqueueViewPackages(packages, queue, argv.dryRun));
    })
    .then(() => process.exit())
    .done();
};
