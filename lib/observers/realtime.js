'use strict';

const couchdbForce = require('couchdb-force');
const get = require('lodash/get');
const uniq = require('lodash/uniq');

const log = logger.child({ module: 'observer/realtime' });

class RealtimeObserver {
    /**
     * Constructor.
     *
     * Note that the `onPackage` function may return a promise that will be waited before resuming the observe process.
     * If the `onPackage` function fails, the observing process will be restarted and resumed at the same package.
     *
     * @param {Nano}     npmNano   - The npm nano client instance.
     * @param {Nano}     npmsNano  - The npms nano client instance.
     * @param {function} onPackage - The function to be called to notify packages.
     * @param {Object}   [options] - The options; read below to get to know each available option.
     */
    constructor(npmNano, npmsNano, onPackage, options) {
        if (typeof options === 'function') {
            onPackage = options;
            options = null;
        }

        this._npmNano = npmNano;
        this._npmsNano = npmsNano;
        this._onPackage = onPackage;
        this._options = Object.assign({
            concurrency: 25, // The maximum concurrency in which to call `onPackage`
            defaultSeq: null, // Default seq to be used in the first run (null means from now on)
            restartDelay: 5000, // Time to wait before restarting on CouchDB errors
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
     * Little utility to halt the flow of promises if `_stop() was called in the middle
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
     * Errors will be automatically retried.
     */
    _start() {
        this._started = true;

        log.info('Starting realtime observer..');

        // Fetch the last followed sequence
        this._fetchLastSeq()
        // Follow changes since the last sequence
        .then(this._ignoreIfStopped(() => this._followChanges()))
        // If anything goes wrong, retry!
        .catch(this._ignoreIfStopped((err) => {
            log.error({ err }, 'Realtime observer failed, restarting in a few moments..');

            this._stop();
            this._restartTimeout = setTimeout(() => {
                this._restartTimeout = null;
                this._start();
            }, this._options.restartDelay);
        }))
        .done();
    }

    /**
     * Stops observing.
     */
    _stop() {
        this._started = false;

        if (this._follower) {
            this._follower.stop();
            this._follower = null;
        }

        if (this._restartTimeout) {
            clearTimeout(this._restartTimeout);
            this._restartTimeout = null;
        }

        if (this._flushBufferTimeout) {
            clearTimeout(this._flushBufferTimeout);
            this._flushBufferTimeout = null;
        }
    }

    /**
     * Fetches the last followed CouchDB seq.
     *
     * @returns {Promise} A promise that resolves to the seq.
     */
    _fetchLastSeq() {
        return this._npmsNano.getAsync('observer!realtime!last_followed_seq')
        .then(this._ignoreIfStopped((doc) => {
            this._lastSeq = doc;
        }))
        .catch({ error: 'not_found' }, this._ignoreIfStopped(() => {
            this._lastSeq = {
                _id: 'observer!realtime!last_followed_seq',
                value: this._options.defaultSeq === 'number' ? this._options.defaultSeq : null,
            };
        }));
    }

    /**
     * Updates the last followed CouchDB seq.
     * If it fails due to a conflict, the last followed seq is refetched.
     *
     * @param {Number} seq - The sequence.
     *
     * @returns {Promise} A promise that resolves to the seq.
     */
    _updateLastSeq(seq) {
        return this._npmsNano.insertAsync({
            value: seq,
            _rev: this._lastSeq._rev,
        }, 'observer!realtime!last_followed_seq')
        // Set last seq with the update result
        .then(this._ignoreIfStopped((inserted) => {
            log.debug({ seq }, `Last followed seq updated to ${seq}`);

            this._lastSeq.value = seq;
            this._lastSeq._rev = inserted.rev;
        }))
        .catch({ error: 'conflict' }, this._ignoreIfStopped(() => {
            log.warn('Are two realtime instances running simultaneously?');

            // Attempt to re-fetch the seq, it might have changed somehow..
            return this._fetchLastSeq().catch(() => {});
        }));
    }

    /**
     * Starts following CouchDB changes in realtime.
     * Each change is buffered and flushed when appropriate.
     *
     * @returns {Promise} A promise that is rejected on error.
     */
    _followChanges() {
        return new Promise((resolve, reject) => {
            const since = this._lastSeq.value == null ? 'now' : this._lastSeq.value;

            log.info({ since }, `Will now start to follow changes since ${since}`);

            this._buffer = [];

            this._follower = this._npmNano.follow({ since });
            this._follower
            // Buffer each change
            .on('change', this._ignoreIfStopped((change) => this._addToBuffer(change)))
            // The follow functionality is resilient to errors.. if an error happens,
            // it must be really serious
            .on('error', reject)
            .follow();
        });
    }

    /**
     * Adds a change to the buffer.
     * The buffer will be flushed if full or after a certain delay.
     *
     * @param {Object} change - The CouchDB change object.
     */
    _addToBuffer(change) {
        // Ignore design documents and other stuff that are not actually packages
        if (change.id[0] === '_') {
            return;
        }

        this._buffer.push(change);

        // Cancel previous flush timeout if any
        if (this._flushBufferTimeout) {
            clearTimeout(this._flushBufferTimeout);
            this._flushBufferTimeout = null;
        }

        // Flush if buffer is full
        if (this._buffer.length >= this._options.concurrency * 10) {
            this._flushBuffer();
        // Flush if there are no more changes within a certain timeframe
        } else {
            this._flushBufferTimeout = setTimeout(() => {
                this._flushBufferTimeout = null;
                this._buffer.length && this._flushBuffer();
            }, 2500);
        }
    }

    /**
     * Flushes the buffer, pausing the follow feed until the flush is completed.
     * The `onPackage()` function will be called for each buffered package.
     * Once done, the followed seq will be updated and the feed will be resumed.
     */
    _flushBuffer() {
        if (!this._buffer.length) {
            return;
        }

        log.debug(`Flushing changes buffer with a total of ${this._buffer.length} changes..`);

        // Pause the follower
        this._follower.pause();

        const seq = this._buffer[this._buffer.length - 1].seq;
        const names = uniq(this._buffer.map((change) => change.id)); // Might contain duplicates

        this._buffer = [];

        // Filter names to only contain the ones that have new versions
        this._filterModified(names)
        // Notify packages, updating the observer doc for successful ones
        .spread(this._ignoreIfStopped((filteredNames, bulkUpdate) => {
            const ignoredCount = names.length - filteredNames.length;
            const successfulNames = [];

            filteredNames && log.debug(`Notifying ${filteredNames.length} changed packages`);
            ignoredCount && log.info(`Ignored ${ignoredCount} packages because they have the same version`);

            return Promise.map(filteredNames, this._ignoreIfStopped((name) => (
                this._onPackage(name)
                .then(() => { successfulNames.push(name); })
            )), { concurrency: this._options.concurrency })
            .finally(this._ignoreIfStopped(() => bulkUpdate(successfulNames)));
        }))
        // Update the last followed seq id
        .then(this._ignoreIfStopped(() => (
            this._updateLastSeq(seq)
            .catch((err) => log.error({ seq, err }, 'Failed to update last followed seq, ignoring..')))
        ))
        // If all was good, simply resume the follower
        // Otherwise stop the process and restart in a few moments
        .then(this._ignoreIfStopped(() => (
            this._follower.resume()
        )), this._ignoreIfStopped((err) => {
            log.error({ err }, 'Realtime failed when notifying packages, restarting in a few moments..');

            this._stop();
            this._restartTimeout = setTimeout(() => {
                this._restartTimeout = null;
                this._start();
            }, this._options.restartDelay);
        }))
        .done();
    }

    /**
     * Filters packages that actually got their version changed or were removed.
     *
     * When a user stars a package, a change is produced. Also, the `npm` usually perform
     * maintenance fixes on documents that also trigger a change.
     * Though, we are only interested in changes that were produced by a publish or similar actions.
     *
     * This function resolves with an array where the first element is the filtered packages
     * and the second element is function to internally update - - - - - - - - - The package names.
     *
     * @param {Array} names - The package names.
     *
     * @returns {Promise} A promise that resolves with [filteredNames, bulkUpdate].
     */
    _filterModified(names) {
        return Promise.all([
            this._npmNano.fetchAsync({ keys: names }).get('rows'),
            this._npmsNano.fetchAsync({ keys: names.map((name) => `observer!package!${name}`) }).get('rows'),
        ])
        .spread(this._ignoreIfStopped((npmRows, observerRows) => {
            // Filter only the ones that were actually modified, aggregating the docs and patches for each one
            const docsHash = {};
            const patchesHash = {};

            const filteredNames = names.filter((name, index) => {
                const npmModifiedAt = npmRows[index].doc && get(npmRows[index].doc, 'time.modified', null);
                const observerModifiedAt = get(observerRows[index], 'doc.realtime.modifiedAt');
                const wasModified = !npmModifiedAt || !observerModifiedAt || npmModifiedAt !== observerModifiedAt;

                if (!wasModified) {
                    return false;
                }

                docsHash[name] = observerRows[index].doc;
                patchesHash[name] = { _id: `observer!package!${name}`, realtime: { modifiedAt: npmModifiedAt } };

                return true;
            });

            // Resolve with the filtered names and a bulkUpdate function to update the observer docs
            return [filteredNames, (successfulNames) => {
                const docs = successfulNames.map((name) => docsHash[name]);
                const patches = successfulNames.map((name) => patchesHash[name]);

                return couchdbForce.bulkPatch(this._npmsNano, patches, { docs });
            }];
        }));
    }
}

function realtime(npmAddr, npmsAddr, onPackage, options) {
    return new RealtimeObserver(npmAddr, npmsAddr, onPackage, options);
}

module.exports = realtime;
