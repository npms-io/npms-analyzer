'use strict';

const config = require('config');
const nano = require('nano');
const elasticsearch = require('elasticsearch');
const promiseRetry = require('promise-retry');
const get = require('lodash/get');
const queue = require('../../lib/queue');

const retriesOption = { minTimeout: 2500, retries: 5 };
const log = logger.child({ module: 'bootstrap' });

/**
 * Bootstrap several dependencies, waiting for them to be ready: CouchDB, Elasticsearch and Queue.
 * Tries several times before failing.
 *
 * @param {object} deps      The dependencies to setup
 * @param {object} [options] The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise that resolves when they are ready
 */
function bootstrap(deps, options) {
    options = Object.assign({
        wait: false,  // True to wait for the dependencies to be ready (in case they are unavailable)
    }, options);

    // Log uncaught exceptions
    process.on('uncaughtException', (err) => {
        log.fatal({ err }, `Uncaught exception: ${err.message}`);
        throw err;
    });

    return Promise.map(deps, (dep) => {
        switch (dep) {
        case 'couchdbNpm':
        case 'couchdbNpms':
            return bootstrapCouchdb(config.get(dep), options);
        case 'elasticsearch':
            return bootstrapElasticsearch(config.get('elasticsearch'), options);
        case 'queue':
            return bootstrapQueue(config.get('queue'), options);
        default:
            throw new Error(`Unknown dependency: ${dep}`);
        }
    });
}

// ----------------------------------------------------------------------------

/**
 * Bootstraps a CouchDB database client, returning a nano instance.
 *
 * @param {object}  config  The CouchDB config
 * @param {options} options The options inferred from bootstrap()
 *
 * @return {Promise} The promise that resolves when done
 */
function bootstrapCouchdb(config, options) {
    const nanoClient = Promise.promisifyAll(nano(config));

    if (!nanoClient.config.db) {
        throw new Error('Expected CouchDB URL to point to a DB');
    }

    nanoClient.serverScope = Promise.promisifyAll(nano(Object.assign({}, config, { url: nanoClient.config.url })));

    return promiseRetry((retry) => {
        return nanoClient.getAsync('somedocthatwillneverexist')
        .catch({ error: 'not_found' }, () => {})
        .catch((err) => {
            log.warn({ err }, `Check of ${nanoClient.config.db} failed`);
            retry(err);
        });
    }, options.wait ? retriesOption : { retries: 0 })
    .then(() => log.debug(`CouchDB for ${nanoClient.config.db} is ready`))
    .return(nanoClient);
}

/**
 * Bootstraps a Elasticsearch client.
 *
 * @param {object}  config  The Elasticsearch config
 * @param {options} options The options inferred from bootstrap()
 *
 * @return {Promise} The promise that resolves when done
 */
function bootstrapElasticsearch(config, options) {
    const esClient = new elasticsearch.Client(config);

    return promiseRetry((retry) => {
        return Promise.resolve(esClient.get({
            index: 'someindexthatwillneverexist',
            type: 'sometypethatwillneverexist',
            id: 'someidthatwillneverexist',
            maxRetries: 0,
        }))
        .catch((err) => get(err, 'body.error.type') === 'index_not_found_exception', () => {})
        .catch((err) => {
            log.warn({ err }, 'Check of Elasticsearch failed');
            retry(err);
        });
    }, options.wait ? retriesOption : { retries: 0 })
    .then(() => log.debug('Elasticsearch is ready'))
    .return(esClient);
}

/**
 * Bootstraps the analysis queue.
 *
 * @param {object}  config  The queue config
 * @param {options} options The options inferred from bootstrap()
 *
 * @return {Promise} The promise that resolves when done
 */
function bootstrapQueue(config, options) {
    const analysisQueue = queue(config.name, config.addr, config.options);

    return promiseRetry((retry) => {
        return analysisQueue.stat()
        .catch((err) => {
            log.warn({ err }, 'Check of Queue failed');
            retry(err);
        });
    }, options.wait ? retriesOption : { retries: 0 })
    .then(() => log.debug('Queue is ready'))
    .return(analysisQueue);
}

module.exports = bootstrap;
