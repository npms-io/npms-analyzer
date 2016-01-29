'use strict';

const EventEmitter = require('events').EventEmitter;
const assert = require('assert');
const log = require('npmlog');
const amqp = require('amqplib');
const Promise = require('bluebird');
const errcode = require('err-code');
const assign = require('lodash/assign');
const pick = require('lodash/pick');

/**
 * Simple yet powerful queue implementation based on RabbitMQ.
 *
 * The implementation has resilience as top priority, which means that a lot of errors are handled automatically
 * for you, including connection issues. If something goes really wrong, the instance will be automatically
 * destroyed and a `error` event will be emitted.
 *
 * The `error` listeners will receive an error object with a `reason` property which can be:
 * - blocked: RabbitMQ blocked the connection, which usually means a service outage
 * - canceled: RabbitMQ canceled the consumer, which usually means a service outage (or the queue was deleted)
 *
 * Additionally the following events are emitted:
 * - reconnect: Emitted each time a reconnect is attempted, with the number of attempts
 */
class Queue extends EventEmitter {
    /**
     * Constructor.
     *
     * @param {string} name      The queue name
     * @param {string} addr      The RabbitMQ address (connection string)
     * @param {object} [options] The options; read bellow to get to know each available option
     */
    constructor(name, addr, options) {
        super();

        this._name = name;
        this._addr = addr;
        this._options = assign({
            socket: { heartbeat: 30 },  // The socket options, see: http://goo.gl/lL9SSB
            reconnectDelay: 5000,       // Time to wait before reconnecting on connection errors
        }, options);

        this._reconnectCount = 0;
    }

    /**
     * Pushes the specified data into the queue.
     * An error will be thrown if the instance is destroyed.
     *
     * @param {Mixed} data The data
     *
     * @return {Promise} A promise that fulfills when done
     */
    push(data) {
        assert(!this._destroyed, 'Queue is destroyed');

        log.silly('queue', 'Pushing into the queue', { data });

        // Ensure we are connected
        return this._connect()
        // Add it to the queue
        .then(() => {
            return this._sendToQueue({ data, pushedAt: Date.now(), retryCount: 0 });
        })
        .then(() => {
            log.silly('queue', 'Successfully pushed into the queue', { data });
        }, (err) => {
            log.error('queue', 'Failed to push data into the queue', { data, err });
            throw err;
        });
    }

    /**
     * Registers the consumer for this queue.
     *
     * The consumer function will be called with one argument - a message object that contains
     * `data`, `pushedAt` and `retryCount` properties - and is expected to return a promise.
     * Resolving the promise signals that the message was consumed successfully, rejecting the promise
     * signals that an error occurred which causes the message to be re-queued.
     *
     * One note on consumers: in error scenarios the message might be redelivered several times therefore your
     * consumer function must be coded having that in mind.
     *
     * Only one consumer is allowed as well as only one inflight attempt to register it. In both cases
     * an error will be thrown. Also, an error will be thrown if the instance has been destroyed.
     *
     * @param {function} fn        The consumer function
     * @param {object}   [options] The options; read bellow to get to know each available option
     *
     * @return {Promise} A promise that fulfills once registered
     */
    consume(fn, options) {
        assert(!this._destroyed, 'Queue is destroyed');
        assert(!this._consumer, 'Consumer is already registered');
        assert(!this._registeringConsumer, 'A consumer is being registered');

        if (typeof options === 'function') {
            fn = options;
            options = null;
        }

        options = assign({
            concurrency: 1,  // Concurrency at which `fn` will be run
            maxRetries: 5,   // Maximum number of retries allowed for the same message
        }, options);

        const consumer = assign({ fn }, options);

        this._registeringConsumer = true;

        return this._connect()
        .then(() => this._registerConsumer(consumer))
        .finally(() => { this._registeringConsumer = false; });
    }

    /**
     * Stats the queue.
     *
     * Returns a promise that resolves with an object with `messageCount` and
     * `consumerCount` properties
     *
     * An error will be thrown if the instance is destroyed.
     *
     * @return {Promise} A promise that fulfills when done
     */
    stat() {
        assert(!this._destroyed, 'Queue is destroyed');

        return this._connect()
        .then(() => this._channel.checkQueue(this._name))
        .then((res) => {
            return pick(res, 'messageCount', 'consumerCount');
        }, (err) => {
            if (err.code === 404) {
                return { messageCount: 0, consumerCount: 0 };
            }

            throw err;
        });
    }

    /**
     * Destroys the instance.
     * Any on going jobs will be automatically re-queued by RabbitMQ.
     */
    destroy() {
        this._destroyed = true;
        this._disconnect();

        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
    }

    // -----------------------------------------------------

    /**
     * Connects to RabbitMQ.
     *
     * Sets up the connection, the channel and the consumers.
     * Returns a promise that is resolved once connected. If already connected, the promise resolves immediately.
     *
     * The connection is handled carefully which means that automatic retries will be attempted on errors.
     *
     * @return {Promise} A promise that is resolved once connected
     */
    _connect() {
        if (this._connectPromise) {
            return this._connectPromise;
        }

        // Wait for the reconnect delay if any
        this._connectPromise = Promise.resolve(this._reconnectDelayPromise)
        // Connect to RabbitMQ!
        .then(() => {
            return amqp.connect(this._addr, this._options.socket)
            .tap((connection) => { this._connection = connection; });
        })
        // Configure channel & queue
        .then((connection) => {
            return connection.createConfirmChannel()
            .tap((channel) => { this._channel = channel; })
            .then((channel) => channel.assertQueue(this._name, { durable: true }));
        })
        // Register consumer
        .then(() => {
            this._assertConnected();
            return this._consumer && this._registerConsumer(this._consumer);
        })
        // Final handling
        .then(() => {
            this._assertConnected();
            this._reconnectCount = 0;

            this._connection
            .once('error', (err) => this._reconnect(err))
            .once('close', (err) => this._reconnect(err))
            .once('blocked', (reason) => {
                log.error('queue', 'RabbitMQ is blocking the connection, reason being' + reason, { reason });
                this.destroy();
                this.emit('error', errcode(new Error('Fatal error'), 'FATAL', { reason: 'blocked' }));
            });

            this._channel
            .once('error', (err) => this._reconnect(err))
            .once('close', (err) => this._reconnect(err))
            .once('return', () => log.error('queue', 'A message could not be queued and was returned back'));

            log.info('queue', 'RabbitMQ connect and setup done successfully');
        })
        // On error, try to reconnect
        .catch((err) => {
            setImmediate(() => this._reconnect(err));
            throw err;
        });

        return this._connectPromise;
    }

    /**
     * Reconnects to RabbitMQ on error.
     *
     * The client we are using does not have built-in reconnection so we handle it ourselves.
     *
     * @param {Error} [err] The error
     */
    _reconnect(err) {
        // Since this function is called in various asynchronous contexts, ensure that
        // we don't do anything if the instance has been destroyed
        if (this._destroyed) {
            log.silly('queue', 'Reconnect ignored because instance is already destroyed');
            return;
        }

        // Do not reconnect if already reconnecting..
        if (this._reconnectDelayPromise) {
            log.error('queue', 'RabbitMQ connection errored, already retrying to reconnect to..',
                { err, attemptCount: this._reconnectCount });
            return;
        }

        log.error('queue', 'RabbitMQ connection errored, reconnecting in a few moments..',
            { err, attemptCount: this._reconnectCount });

        // Emit the reconnect event and check if the listener have decided to destroy the instance
        this.emit('reconnect', this._reconnectCount);
        if (this._destroyed) {
            return;
        }

        this._reconnectCount += 1;
        this._reconnectDelayPromise = new Promise((resolve) => {
            this._reconnectTimeout = setTimeout(() => {
                this._reconnectTimeout = this._reconnectDelayPromise = null;
                resolve();
            }, this._options.reconnectDelay);
        });

        this._disconnect();
        this._connect().catch(() => {});
    }

    /**
     * Disconnects from RabbitMQ.
     */
    _disconnect() {
        this._connectPromise = null;

        if (this._connection) {
            this._connection.removeAllListeners();
            this._connection.on('error', () => {});
            try { this._connection.close(); } catch (err) { /* Do nothing */ }
            this._connection = null;
        }

        if (this._channel) {
            this._channel.removeAllListeners();
            this._channel.on('error', () => {});
            try { this._channel.close(); } catch (err) { /* Do nothing */ }
            this._channel = null;
        }
    }

    /**
     * Registers the consumer of the queue.
     *
     * @param {object} consumer An object containing the actual function and additional options
     *
     * @return {Promise} A promise that fulfills once done
     */
    _registerConsumer(consumer) {
        this._consumer = consumer;
        this._channel.prefetch(this._consumer.concurrency);

        return this._channel.consume(this._name, (queueMsg) => {
            // According to http://www.squaremobius.net/amqp.node/channel_api.html#channel_consume, if RabbitMQ
            // cancels this consumer then `queueMsg` will be null
            if (!queueMsg) {
                log.error('queue', 'Consumer function got canceled remotely..');
                this.destroy();
                this.emit('error', errcode(new Error('Fatal error'), 'FATAL', { reason: 'canceled' }));
                return;
            }

            const msg = JSON.parse(queueMsg.content.toString());

            // Call the consumer function
            Promise.try(() => this._consumer.fn(msg))
            // Handle consumer success/error
            .then(() => {
                this._handleConsumerSuccess(msg, queueMsg);
            }, (err) => {
                this._handleConsumerError(err, msg, queueMsg);
            })
            .done();
        })
        .then(() => {
            log.info('queue', 'Consumer was registered successfully, will now receive messages..');
        }, (err) => {
            this._consumer = null;
            log.error('queue', 'Failed to register consumer', { err });
            throw err;
        });
    }

    /**
     * Handles consumer success for a specific message.
     *
     * @param {object} msg      The message that the consumer received
     * @param {object} queueMsg The original consumed RabbitMQ message
     */
    _handleConsumerSuccess(msg, queueMsg) {
        // Handle the fact that we might no longer be connected.. consumers might take a while to handle the message
        if (!this._isConnected()) {
            log.warn('queue', 'Consumer handled the message but we are no longer connected', { msg });
            return;
        }

        log.verbose('queue', 'Consumer successfully handled message, ack\'ing..', { msg });
        this._channel.ack(queueMsg);
    }

    /**
     * Handles consumer error for a specific message.
     *
     * The message will be retried if the max retries were not reached.
     * Otherwise, it will simply be discarded form the queue (dead lettered).
     *
     * Retried messages are put into the end of the queue to avoid congestion.
     *
     * @param {Error}  err      The consumer error
     * @param {object} msg      The message that the consumer received
     * @param {object} queueMsg The original consumed RabbitMQ message
     */
    _handleConsumerError(err, msg, queueMsg) {
        // Handle the fact that we might no longer be connected.. consumers might take a while to handle the message
        if (!this._isConnected()) {
            log.warn('queue', 'Consumer failed to handle the message but we are no longer connected', { msg });
            return;
        }

        // Did we reach the max allowed retries?
        if (msg.retryCount >= this._consumer.maxRetries) {
            log.error('queue', 'Failed to consume message, NOT re-queueing after ' +
msg.retryCount + ' failed attempts', { err, msg });
            this._channel.nack(queueMsg, false, false);
            return;
        }

        log.error('queue', 'Failed to consume message, re-queueing..', { err, msg });
        msg.retryCount += 1;

        // Send the updated message to the tail of the queue with the updated retries count
        this._sendToQueue(msg)
        // Ack the previous message only after we are sure the updated one was added to the queue
        // This is necessary to avoid loosing messages
        .then(() => {
            this._assertConnected();
            this._channel.ack(queueMsg);
        })
        .catch((err) => log.error('queue', 'Error trying to re-queue the message, duplicates will occur!', { err }))
        .done();
    }

    /**
     * Little utility function to enqueue a message.
     *
     * @param {object} msg The message
     *
     * @return {Promise} A promise that fulfills when done
     */
    _sendToQueue(msg) {
        const content = new Buffer(JSON.stringify(msg));

        return new Promise((resolve, reject) => {
            this._channel.sendToQueue(this._name, content, { persistent: true }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Little utility function that checks if we are connected.
     *
     * @return {boolean} True if connected, false otherwise
     */
    _isConnected() {
        return this._connection && this._channel;
    }

    /**
     * Little utility function that asserts that we are connected.
     */
    _assertConnected() {
        assert(this._isConnected(), 'Not connected to RabbitMQ');
    }
}

function queue(addr, options) {
    return new Queue(addr, options);
}

module.exports = queue;
