'use strict';

const log = require('npmlog');

const logPrefix = 'observer/realtime';

class RealtimeObserver {
    /**
     * Constructor.
     *
     * Note that the `onModules` function may return a promise that will be waited
     * before resuming the observe process.
     *
     * @param {Nano}     npmNano   The npm nano client instance
     * @param {Nano}     npmsNano  The npms nano client instance
     * @param {function} onModules The function to be called to report modules
     * @param {object}   [options] The options; read bellow to get to know each available option
     */
    constructor(npmNano, npmsNano, onModules, options) {
        if (typeof options === 'function') {
            onModules = options;
            options = null;
        }

        this._npmNano = npmNano;
        this._npmsNano = npmsNano;
        this._onModules = onModules;
        this._options = Object.assign({
            defaultSeq: 0,           // Default seq to be used in the first run
            restartDelay: 5000,      // Time to wait before restarting on couchdb errors
            bufferSize: 1000,        // Buffer up to X burst changes before notifying
            bufferFlushDelay: 2000,  // If the buffer didn't get full with changes, notify after X delay
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
     * Little utility to halt the flow of promises if `_stop()`` was called in the middle
     * of a complex promise flow.
     *
     * @param {function} fn A function that returns a promise
     *
     * @return {function} A function that returns a wrapped promise that never fulfills if stopped
     */
    _ignoreIfStopped(fn) {
        return (arg) => {
            if (!this._started) {
                return new Promise(() => {});
            }

            return fn.call(this, arg);
        };
    }

    /**
     * Starts observing.
     *
     * This process is infinite until `destroy()` is called.
     * Errors will be automatically retried.
     */
    _start() {
        this._started = true;

        log.info(logPrefix, 'Starting realtime observer..');

        // Fetch the last followed sequence
        this._fetchLastSeq()
        // Follow changes since the last sequence
        .then(this._ignoreIfStopped(() => this._followChanges()))
        // If anything goes wrong, retry!
        .catch(this._ignoreIfStopped((err) => {
            log.error(logPrefix, 'Realtime failed, restarting in a few moments..', { err });

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
     * Fetches the last followed couchdb seq.
     *
     * @return {Promise} A promise that resolves to the seq.
     */
    _fetchLastSeq() {
        return this._npmsNano.getAsync('last_followed_seq')
        .then((doc) => {
            this._lastSeq = doc;
        }, (err) => {
            if (err.error !== 'not_found') {
                throw err;
            }

            this._lastSeq = {
                _id: 'last_followed_seq',
                value: this._options.defaultSeq,
            };
        });
    }

    /**
     * Starts following couchdb changes in realtime.
     * Each change is buffered and flushed when appropriate.
     *
     * @return {Promise} A promise that is rejected on error
     */
    _followChanges() {
        return new Promise((resolve, reject) => {
            const since = this._lastSeq.value == null ? 'now' : this._lastSeq.value;

            log.info(logPrefix, `Will now start to follow changes since ${since}`, { since });

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
     * @param {object} change The couchdb change object
     */
    _addToBuffer(change) {
        this._buffer.push(change);

        // Cancel previous flush timeout if any
        if (this._flushBufferTimeout) {
            clearTimeout(this._flushBufferTimeout);
            this._flushBufferTimeout = null;
        }

        // Flush if buffer is full
        if (this._buffer.length >= this._options.bufferSize) {
            this._flushBuffer();
        // Flush if there are no more changes within a certain timeframe
        } else {
            this._flushBufferTimeout = setTimeout(() => {
                this._flushBufferTimeout = null;
                this._buffer.length && this._flushBuffer();
            }, this._options.bufferFlushDelay);
        }
    }

    /**
     * Flushes the buffer, pausing the follow feed until the process is complete.
     * The `onModules()` function will be called with the buffered modules.
     * Once complete, the followed seq will be updated and the feed will resume.
     */
    _flushBuffer() {
        log.verbose(logPrefix, `Flushing changes buffer with a total of ${this._buffer.length} changes..`);

        // Pause the follower
        this._follower.pause();

        // Grab last seq & modules before emptying
        const seq = this._buffer[this._buffer.length - 1].seq;
        const moduleNames = this._buffer.map((change) => change.id);

        this._buffer = [];

        // Notify changes and wait for them to be handled
        // We ignore errors because its not our responsibility
        Promise.try(() => this._onModules(moduleNames)).catch(() => {})
        // Update last followed seq
        .then(this._ignoreIfStopped(() => {
            return this._npmsNano.insertAsync({
                _rev: this._lastSeq._rev,
                value: seq,
            }, 'last_followed_seq');
        }))
        // Set last seq with the update result
        .then(this._ignoreIfStopped((inserted) => {
            log.verbose(logPrefix, `Flush done, last followed seq updated to ${seq}`, { seq });

            this._lastSeq._rev = inserted.rev;
            this._lastSeq.value = seq;
        }), this._ignoreIfStopped((err) => {
            log.error(logPrefix, 'Failed to update last followed seq', { seq, err });
            err.error === 'conflict' && log.warn(logPrefix, 'Are two realtime instances running simultaneously?');

            // Attempt to re-fetch the seq, it might have changed somehow..
            return this._fetchLastSeq().catch(() => {});
        }))
        // Resume the follower
        .then(this._ignoreIfStopped(() => this._follower.resume()))
        .done();
    }
}

function realtime(npmAddr, npmsAddr, onModules, options) {
    return new RealtimeObserver(npmAddr, npmsAddr, onModules, options);
}

module.exports = realtime;
