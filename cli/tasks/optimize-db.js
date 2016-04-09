'use strict';

const config = require('config');
const nano = require('nano');
const log = require('npmlog');
const minBy = require('lodash/minBy');

const logPrefix = '';

/**
 * Waits for compaction tasks to end.
 *
 * @param {Nano} nanoCouch A nano instance (root one)
 *
 * @return {Promise} The promise that fulfills when done
 */
function waitForCompaction(nanoCouch) {
    let isInflight = false;
    let contiguousErrors = 0;

    log.info(logPrefix, 'Waiting the compaction task to complete..');

    return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
            if (isInflight) {
                return;
            }

            isInflight = true;

            nanoCouch.requestAsync({ doc: '_active_tasks' })
            .finally(() => { isInflight = false; })
            .then((tasks) => {
                contiguousErrors = 0;
                tasks = tasks.filter((task) => /^(database|view)_compaction$/.test(task.type));

                if (!tasks.length) {
                    clearInterval(interval);
                    return resolve();
                }

                const slowerTask = minBy(tasks, 'progress');

                log.verbose(logPrefix, `Compaction task is at ${slowerTask.progress}%`);
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
 * @param {Nano}   nanoCouch A nano instance (root one)
 * @param {string} dbName    The database name
 *
 * @return {Promise} The promise that fulfills when done
 */
function compactDb(nanoCouch, dbName) {
    log.info(logPrefix, `Starting ${dbName} database compaction..`);

    return nanoCouch.db.compactAsync(dbName)
    .then(() => waitForCompaction(nanoCouch));
}

/**
 * Compacts a database design doc.
 *
 * @param {Nano}   nanoCouch A nano instance (root one)
 * @param {string} dbName    The database name
 * @param {string} designDoc The design document name
 *
 * @return {Promise} The promise that fulfills when done
 */
function compactDesignDoc(nanoCouch, dbName, designDoc) {
    log.info(logPrefix, `Starting ${dbName}/${designDoc} view compaction..`);

    return nanoCouch.db.compactAsync(dbName, designDoc)
    .then(() => waitForCompaction(nanoCouch));
}

/**
 * Cleanups old views from a database.
 *
 * @param {Nano}   nanoCouch A nano instance (root one)
 * @param {string} dbName    The database name
 *
 * @return {Promise} The promise that fulfills when done
 */
function cleanupViews(nanoCouch, dbName) {
    log.info(logPrefix, `Cleaning up ${dbName} views..`);

    return nanoCouch.requestAsync({ db: dbName, doc: '_view_cleanup', method: 'POST' });
}

// --------------------------------------------------

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: ./$0 tasks db-optimize [options]\n\nOptimizes the CouchDB database, compacting itself and its views.')
    .demand(2, 2)
    .example('./$0 tasks db-optimize ')
    .example('./$0 tasks db-optimize --no-compact', 'Just cleanup old views, do not compact')

    .option('compact', {
        type: 'boolean',
        default: true,
        describe: 'Either to compact or not',
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-db-optimize';
    log.level = argv.logLevel || 'info';

    const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

    const npmNanoCouch = Promise.promisifyAll(nano(npmNano.config.url, { requestDefaults: { timeout: 15000 } }));
    const npmsNanoCouch = Promise.promisifyAll(nano(npmsNano.config.url, { requestDefaults: { timeout: 15000 } }));

    Promise.promisifyAll(npmNanoCouch.db);
    Promise.promisifyAll(npmsNanoCouch.db);

    // Cleanup old views
    return Promise.all([
        cleanupViews(npmNanoCouch, npmNano.config.db),
        cleanupViews(npmsNanoCouch, npmsNano.config.db),
    ])
    // Compact databases
    .then(() => {
        if (!argv.compact) {
            return;
        }

        return compactDb(npmNanoCouch, npmNano.config.db)
        .then(() => compactDb(npmsNanoCouch, npmsNano.config.db))
        // Compact views
        .then(() => Promise.all([
            npmNano.listAsync({ startkey: '_design/', endkey: '_design/\ufff0' }),
            npmsNano.listAsync({ startkey: '_design/', endkey: '_design/\ufff0' }),
        ]))
        .spread((npmResponse, npmsResponse) => {
            const npmDesignDocs = npmResponse.rows.map((row) => row.key.substr(8));
            const npmsDesignDocs = npmsResponse.rows.map((row) => row.key.substr(8));

            return Promise.each(npmDesignDocs, (designDoc) => compactDesignDoc(npmNanoCouch, npmNano.config.db, designDoc))
            .then(() => Promise.each(npmsDesignDocs, (designDoc) => compactDesignDoc(npmsNanoCouch, npmsNano.config.db, designDoc)));
        });
    })
    .then(() => log.info(logPrefix, 'Optimization completed successfully!'))
    .done();
};
