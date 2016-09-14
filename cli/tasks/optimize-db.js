'use strict';

const minBy = require('lodash/minBy');
const bootstrap = require('../util/bootstrap');

const log = logger.child({ module: 'cli/optimize-db' });

/**
 * Waits for compaction tasks to end.
 *
 * @param {Nano} nanoCouch A nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function waitForCompaction(nanoCouch) {
    let isInflight = false;
    let contiguousErrors = 0;

    log.info('Waiting for compaction tasks to complete..');

    return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
            if (isInflight) {
                return;
            }

            isInflight = true;

            nanoCouch.serverScope.requestAsync({ doc: '_active_tasks' })
            .finally(() => { isInflight = false; })
            .then((tasks) => {
                contiguousErrors = 0;
                tasks = tasks.filter((task) => /^(database|view)_compaction$/.test(task.type));

                if (!tasks.length) {
                    clearInterval(interval);
                    return resolve();
                }

                const slowerTask = minBy(tasks, 'progress');

                log.debug(`Compaction task is at ${slowerTask.progress}%`);
            })
            .catch((err) => {
                contiguousErrors += 1;
                contiguousErrors >= 5 && reject(err);
            });
        }, 5000);
    });
}

/**
 * Compacts a database.
 *
 * @param {Nano} nanoCouch A nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function compactDb(nanoCouch) {
    log.info(`Compacting ${nanoCouch.config.db} database..`);

    return nanoCouch.compactAsync()
    .then(() => waitForCompaction(nanoCouch));
}

/**
 * Compacts a database design doc.
 *
 * @param {Nano}   nanoCouch A nano instance
 * @param {string} designDoc The design document name
 *
 * @return {Promise} The promise that fulfills when done
 */
function compactDesignDoc(nanoCouch, designDoc) {
    log.info(`Compacting ${nanoCouch.config.db}/${designDoc} view..`);

    return nanoCouch.compactAsync(designDoc)
    .then(() => waitForCompaction(nanoCouch));
}

/**
 * Cleanups old views from a database.
 *
 * @param {Nano} nanoCouch A nano instance
 *
 * @return {Promise} The promise that fulfills when done
 */
function cleanupViews(nanoCouch) {
    log.info(`Cleaning up ${nanoCouch.config.db} views..`);

    return nanoCouch.serverScope.requestAsync({ db: nanoCouch.config.db, doc: '_view_cleanup', method: 'POST' });
}

// --------------------------------------------------

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 tasks db-optimize [options]\n\nOptimizes the CouchDB database, compacting itself and its views.')
    .demand(0, 0)
    .example('$0 tasks db-optimize ')
    .example('$0 tasks db-optimize --no-compact', 'Just cleanup old views, do not compact')

    .option('compact', {
        type: 'boolean',
        default: true,
        describe: 'Either to compact or not',
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-db-optimize';
    logger.level = argv.logLevel || 'info';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms'])
    .spread((npmNano, npmsNano) => {
        // Cleanup old views
        return Promise.all([
            cleanupViews(npmNano),
            cleanupViews(npmsNano),
        ])
        .then(() => {
            if (!argv.compact) {
                return;
            }

            // Wait for compaction if any
            return waitForCompaction(npmNano)
            .then(() => npmNano.config.url !== npmsNano.config.url && waitForCompaction(npmsNano))
            // Compact databases
            .then(() => compactDb(npmNano))
            .then(() => compactDb(npmsNano))
            // Compact views
            .then(() => Promise.all([
                npmNano.listAsync({ startkey: '_design/', endkey: '_design/\ufff0' }),
                npmsNano.listAsync({ startkey: '_design/', endkey: '_design/\ufff0' }),
            ]))
            .spread((npmResponse, npmsResponse) => {
                const npmDesignDocs = npmResponse.rows.map((row) => row.key.substr(8));
                const npmsDesignDocs = npmsResponse.rows.map((row) => row.key.substr(8));

                return Promise.each(npmDesignDocs, (designDoc) => compactDesignDoc(npmNano, designDoc))
                .then(() => Promise.each(npmsDesignDocs, (designDoc) => compactDesignDoc(npmsNano, designDoc)));
            });
        })
        .then(() => log.info('Optimization completed successfully!'));
    })
    .then(() => process.exit())
    .done();
};
