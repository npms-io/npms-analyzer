'use strict';

const couchdbIterator = require('couchdb-iterator');
const couchdbForce = require('couchdb-force');
const get = require('lodash/get');

const log = logger.child({ module: 'observer/stale' });

class StaleObserver {
    /**
     * Constructor.
     *
     * Note that the `onPackage` function may return a promise that will be waited
     * before resuming the observe process. If the `onPackage` function fails, the process will be restarted and resumed
     * at the same package.
     *
     * @param {Nano}     npmsNano  - The npms nano client instance.
     * @param {function} onPackage - The function to be called to notify packages.
     * @param {Object}   [options] - The options; read below to get to know each available option.
     */
    constructor(npmsNano, onPackage, options) {
        if (typeof options === 'function') {
            onPackage = options;
            options = null;
        }

        this._npmsNano = npmsNano;
        this._onPackage = onPackage;
        this._options = Object.assign({
            concurrency: 25, // The maximum concurrency in which to call `onPackage`
            staleThreshold: {
                normal: 25 * 24 * 60 * 60 * 1000, // Threshold in which a package analysis is considered stale (defaults to 25d)
                failed: 12 * 60 * 60 * 1000, // Threshold in which a failed package analysis is considered stale (defaults to 12h)
            },
            checkDelay: 5 * 60 * 1000, // Time to wait before checking for stale package analysis (defaults to 5m)
        }, options);

        // Start the thingy!
        this._start();
    }

    /**
     * Destroys the instance.
     */
    destroy() {
        this._stop();
    }

    // -----------------------------------------------------

    /**
     * Little utility to halt the flow of promises if `_stop()` was called in the middle
     * of a complex promise flow.
     *
     * @param {function} fn - A function that returns a promise.
     *
     * @returns {function} A function that returns a wrapped promise that never fulfills if stopped.
     */
    _ignoreIfStopped(fn) {
        return function (...args) {
            if (!this._started) {
                return new Promise(() => {});
            }

            return fn(...args);
        }.bind(this);
    }

    /**
     * Starts observing.
     *
     * This process is infinite until `destroy()` is called.
     */
    _start() {
        this._started = true;

        log.info('Starting stale observer..');

        this._check();
    }

    /**
     * Stops observing.
     */
    _stop() {
        this._started = false;

        if (this._checkTimeout) {
            clearTimeout(this._checkTimeout);
            this._checkTimeout = null;
        }
    }

    /**
     * Searches the database, looking for stale packages.
     *
     * Schedules a new check once done.
     */
    _check() {
        // Check for normal stale packages
        this._checkType('failed')
        // Check for stale packages which analysis have failed
        .then(() => this._checkType('normal'))
        // Schedule the next check
        .then(this._ignoreIfStopped(() => {
            this._checkTimeout = setTimeout(() => {
                this._checkTimeout = null;
                this._check();
            }, this._options.checkDelay);
        }));
    }

    /**
     * Searches the database, looking for stale packages of a specific type.
     *
     * @param {String} type - The staleness type (normal or failed).
     *
     * @returns {Promise} A promise that fullfills when done.
     */
    _checkType(type) {
        log.debug(`Looking for stale packages (${type})..`);

        // Fetch stale packages by querying the `packages-stale` view
        return couchdbIterator.bulk(this._npmsNano, 'npms-analyzer/packages-stale', this._ignoreIfStopped((rows) => {
            const names = rows.filter((row) => row.doc).map((row) => row.doc.collected.metadata.name);

            log.debug(`Got ${rows.length} packages that are considered stale (${type}), filtering..`);

            // Filter names to only contain the ones that have new versions
            return this._filterNotNotified(names, type)
            // Notify packages, updating the observer doc for successful ones
            .spread(this._ignoreIfStopped((filteredNames, bulkUpdate) => {
                const filteredCount = filteredNames.length;
                const ignoredCount = names.length - filteredCount;
                const successfulNames = [];

                filteredCount && log.debug(`Notifying ${filteredNames.length} stale packages (${type})`);
                ignoredCount && log.info(`Ignored ${ignoredCount} stale packages (${type}) because they were already notified`);

                return Promise.map(filteredNames, this._ignoreIfStopped((name) => this._onPackage(name)
                .then(() => { successfulNames.push(name); })))
                .finally(this._ignoreIfStopped(() => bulkUpdate(successfulNames)));
            }));
        }), {
            startkey: [type, 0, null],
            endkey: [type, Date.now() - this._options.staleThreshold[type], '\ufff0'],
            includeDocs: true,
            bulkSize: this._options.concurrency,
        })
        .catch(this._ignoreIfStopped((err) => {
            log.error({ err }, `Stale observer failed when notifying stale packages (${type})`);
        }));
    }

    /**
     * Filters packages that were not yet notified.
     *
     * It might take some time for a package to be analyzed. Having that said, we must ensure
     * that packages that were previously notified are filtered to avoid repetition.
     *
     * @param {Array}  names - The package names.
     * @param {String} type  - The stale type (normal or failed).
     *
     * @returns {Promise} A promise that resolves with [filteredNames, bulkUpdate].
     */
    _filterNotNotified(names, type) {
        return this._npmsNano.fetchAsync({ keys: names.map((key) => `observer!package!${key}`) })
        .get('rows')
        .then(this._ignoreIfStopped((observerRows) => {
            // Filter only the ones that were not notified or enough time has passed, aggregating the docs for each one
            const docsHash = {};

            const filteredNames = names.filter((name, index) => {
                const notifiedAt = get(observerRows[index], 'doc.stale.notifiedAt');

                if (notifiedAt && Date.now() - Date.parse(notifiedAt) <= this._options.staleThreshold[type]) {
                    return false;
                }

                docsHash[name] = observerRows[index].doc;

                return true;
            });

            // Resolve with the filtered names and a bulkUpdate function to update the observer docs
            return [filteredNames, (successfulNames) => {
                const now = (new Date()).toISOString();
                const docs = successfulNames.map((name) => docsHash[name]);
                const patches = successfulNames.map((name) => ({
                    _id: `observer!package!${name}`,
                    stale: { notifiedAt: now },
                }));

                return couchdbForce.bulkPatch(this._npmsNano, patches, { docs });
            }];
        }));
    }
}

function stale(npmsAddr, onPackage, options) {
    return new StaleObserver(npmsAddr, onPackage, options);
}

module.exports = stale;
