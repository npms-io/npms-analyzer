'use strict';

const couchdbIterator = require('couchdb-iterator');
const couchdbForce = require('couchdb-force');
const get = require('lodash/get');

const log = logger.child({ module: 'observer/stale' });

class StaleObserver {
    /**
     * Constructor.
     *
     * Note that the `onModule` function may return a promise that will be waited
     * before resuming the observe process. If the `onModule` function fails, the process will be restarted and resumed
     * at the same module.
     *
     * @param {Nano}     npmsNano  The npms nano client instance
     * @param {function} onModule  The function to be called to notify modules
     * @param {object}   [options] The options; read below to get to know each available option
     */
    constructor(npmsNano, onModule, options) {
        if (typeof options === 'function') {
            onModule = options;
            options = null;
        }

        this._npmsNano = npmsNano;
        this._onModule = onModule;
        this._options = Object.assign({
            concurrency: 25,                           // The maximum concurrency in which to call `onModule`
            staleThreshold: 15 * 24 * 60 * 60 * 1000,  // Threshold in which a module is considered stale (defaults to 15d)
            checkDelay: 30 * 60 * 1000,                // Time to wait before checking for stale modules (defaults to 30m)
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

    /**
     * Little utility to halt the flow of promises if `_stop()` was called in the middle
     * of a complex promise flow.
     *
     * @param {function} fn A function that returns a promise
     *
     * @return {function} A function that returns a wrapped promise that never fulfills if stopped
     */
    _ignoreIfStopped(fn) {
        return function () {
            if (!this._started) {
                return new Promise(() => {});
            }

            return fn.apply(this, arguments);
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
     * Searches the database, looking for stale modules.
     *
     * Schedules a new check once done.
     */
    _check() {
        log.debug('Looking for stale modules..');

        // Fetch stale modules by querying the `modules-stale` view
        couchdbIterator.bulk(this._npmsNano, 'npms-analyzer/modules-stale', this._ignoreIfStopped((rows) => {
            const names = rows.filter((row) => row.doc).map((row) => row.doc.collected.metadata.name);

            log.debug(`Got ${rows.length} modules that are considered stale, filtering..`);

            // Filter names to only contain the ones that have new versions
            return this._filterNotNotified(names)
            // Notify modules, updating the observer doc for successful ones
            .spread(this._ignoreIfStopped((filteredNames, bulkUpdate) => {
                const ignoredCount = names.length - filteredNames.length;
                const successfulNames = [];

                filteredNames && log.debug(`Notifying ${filteredNames.length} stale modules`);
                ignoredCount && log.info(`Ignored ${ignoredCount} modules because they were already notified`);

                return Promise.map(filteredNames, this._ignoreIfStopped((name) => {
                    return this._onModule(name)
                    .then(() => { successfulNames.push(name); });
                }))
                .finally(this._ignoreIfStopped(() => bulkUpdate(successfulNames)));
            }));
        }), {
            startkey: [0, null],
            endkey: [Date.now() - this._options.staleThreshold, '\ufff0'],
            includeDocs: true,
            bulkSize: this._options.concurrency,
        })
        .catch(this._ignoreIfStopped((err) => {
            log.error({ err }, 'Stale observer failed when notifying modules');
        }))
        // Schedule the next check
        .then(this._ignoreIfStopped(() => {
            this._checkTimeout = setTimeout(() => {
                this._checkTimeout = null;
                this._check();
            }, this._options.checkDelay);
        }));
    }

    /**
     * Filters modules that were not yet notified.
     *
     * It might take some time for a module to be analyzed. Having that said, we must ensure
     * that modules that were previously notified are filtered to avoid repetition.
     *
     * @param {array} names The module names
     *
     * @return {Promise} A promise that resolves with [filteredNames, bulkUpdate]
     */
    _filterNotNotified(names) {
        return this._npmsNano.fetchAsync({ keys: names.map((key) => `observer!module!${key}`) })
        .get('rows')
        .then(this._ignoreIfStopped((observerRows) => {
            // Filter only the ones that were not notified or enough time has passed
            // aggregating the docs for each one
            const docsHash = {};

            const filteredNames = names.filter((name, index) => {
                const notifiedAt = get(observerRows[index], 'doc.stale.notifiedAt');

                if (notifiedAt && Date.now() - Date.parse(notifiedAt) <= this._options.staleThreshold) {
                    return false;
                }

                docsHash[name] = observerRows[index].doc;

                return true;
            });

            // Resolve with the filtered names and a bulkUpdate function to update the observer docs
            return [filteredNames, (successfulNames) => {
                const now = (new Date()).toISOString();
                const docs = successfulNames.map((name) => docsHash[name]);
                const patches = successfulNames.map((name) => {
                    return { _id: `observer!module!${name}`, stale: { notifiedAt: now } };
                });

                return couchdbForce.bulkPatch(this._npmsNano, patches, { docs });
            }];
        }));
    }
}

function realtime(npmsAddr, onModule, options) {
    return new StaleObserver(npmsAddr, onModule, options);
}

module.exports = realtime;
