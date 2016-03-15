'use strict';

const config = require('config');
const log = require('npmlog');
const nano = require('nano');
const elasticsearch = require('elasticsearch');
const couchdbIterator = require('couchdb-iterator');
const humanizeDuration = require('humanize-duration');
const difference = require('lodash/difference');
const esIndexConfig = require('../config/elasticsearch/npms.json');
const score = require('../lib/scoring/score');
const aggregate = require('../lib/scoring/aggregate');
const stats = require('./stats');

const logPrefix = 'cli';

/**
 * Prepares the elasticsearch for the scoring cycle.
 * Collects information about the current indices and aliases, creates a new index for the
 * scores to be written and updates the `npms-write` alias to point to it.
 *
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} A promise that resolves with the elasticsearch information
 */
function prepareElasticsearch(esClient) {
    const esInfo = {};

    log.info(logPrefix, 'Preparing elasticsearch..');

    // Get current indices and aliases
    return Promise.try(() => {
        log.verbose(logPrefix, 'Gathering elasticsearch info..');

        return Promise.all([
            esClient.cat.indices({ h: ['index'] }),
            esClient.cat.aliases({ h: ['alias', 'index'] }),
        ])
        .spread((indicesCat, aliasesCat) => {
            esInfo.indices = [];
            esInfo.aliases = { read: [], write: [] };

            (indicesCat || '').split(/\s*\n\s*/).forEach((lines) => {
                const split = lines.split(/\s+/);
                const index = split[0];

                /^npms\-\d+$/.test(index) && esInfo.indices.push(index);
            });

            (aliasesCat || '').split(/\s*\n\s*/).forEach((lines) => {
                const split = lines.split(/\s+/);
                const alias = split[0];
                const index = split[1];
                const match = alias.match(/^npms\-(write|read)$/);

                match && esInfo.aliases[match[1]].push(index);
            });
        });
    })
    // Create a new index in which the scores will be written
    .then(() => {
        esInfo.newIndex = `npms-${Date.now()}`;

        log.verbose(logPrefix, `Creating index ${esInfo.newIndex}..`);

        return esClient.indices.create({ index: esInfo.newIndex, body: esIndexConfig });
    })
    // Update the `npms-write` alias to point to the previously created index
    .then(() => {
        const actions = esInfo.aliases.write.map((index) => {
            return { remove: { index, alias: 'npms-write' } };
        });

        actions.push({ add: { index: esInfo.newIndex, alias: 'npms-write' } });

        log.verbose(logPrefix, 'Updating npms-write alias..', { actions });

        return esClient.indices.updateAliases({ body: { actions } });
    })
    // Remove all indices except the ones pointing to `npms-read` (should be only 1)
    .then(() => {
        const indices = difference(esInfo.indices, esInfo.aliases.read);

        log.verbose(logPrefix, 'Removing unnecessary indices', { indices });

        return esClient.indices.delete({ index: indices });
    })

    .return(esInfo);
}

/**
 * Finalizes the elasticsearch to end the scoring cycle.
 * Updates the `npms-read` alias to point to the new index and removes all the old indices.
 *
 * @param {object}  esInfo   The object with the elasticsearch information
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} A promise that fulfills when done
 */
function finalizeElasticsearch(esInfo, esClient) {
    log.info(logPrefix, 'Finalizing elasticsearch..');

    // Update `npms-read` alias to point to the new index
    return Promise.try(() => {
        const actions = esInfo.aliases.read.map((index) => {
            return { remove: { index, alias: 'npms-read' } };
        });

        actions.push({ add: { index: esInfo.newIndex, alias: 'npms-read' } });

        log.verbose(logPrefix, 'Updating npms-read alias..', { actions });

        return esClient.indices.updateAliases({ body: { actions } });
    })
    // Remove old indices
    .then(() => {
        const indices = esInfo.aliases.read;

        log.verbose(logPrefix, 'Removing old npms-read indices', { indices });

        return esClient.indices.delete({ index: indices });
    });
}

/**
 * Scores all modules.
 *
 * @param {Nano}    npmsNano The npm nano instance
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} A promise that fulfills when done
 */
function scoreModules(npmsNano, esClient) {
    log.info(logPrefix, 'Aggregating..');

    return aggregate(npmsNano)
    .then((aggregation) => {
        log.info(logPrefix, 'Scoring modules..', { aggregation });

        return couchdbIterator(npmsNano, (row, index) => {
            index && index % 10000 === 0 && log.info(logPrefix, `Scored a total of ${index} modules`);

            return score.calculate(row.doc, aggregation, esClient);
        }, {
            startkey: 'module!',
            endkey: 'module!\ufff0',
            concurrency: 50,
            limit: 2500,
            includeDocs: true,
        });
    });
}

/**
 * Runs a scoring cycle.
 * When it finishes, another cycle will be automatically run after a certain delay.
 *
 * @param {Nano}    npmsNano The npm nano instance
 * @param {Elastic} esClient The elasticsearch instance
 */
function cycle(npmsNano, esClient) {
    const startedAt = Date.now();

    // Prepare elasticsearch
    prepareElasticsearch(esClient)
    // Score all modules
    .tap(() => scoreModules(npmsNano, esClient))
    // Finalize elasticsearch
    .then((esInfo) => finalizeElasticsearch(esInfo, esClient))
    // We are done!
    .then(() => {
        const duration = humanizeDuration(Math.round((Date.now() - startedAt) / 1000) * 1000, { largest: 2 });

        log.info(logPrefix, `Scoring cycle successful, took ${duration}`);
    }, (err) => {
        log.error(logPrefix, 'Scoring cycle failed', { err });
    })
    // Start all over again after a short delay
    .then(() => {
        Promise.delay(60000)
        .then(() => cycle(npmsNano, esClient));
    })
    .done();
}

// ----------------------------------------------------------------------------

exports.builder = (yargs) => {
    return yargs
    .usage('Continuously iterate over the analyzed modules, scoring them.\n\nUsage: ./$0 scoring [options]')
    .demand(1, 1);
};

exports.handler = (argv) => {
    process.title = 'npms-analyzer-scoring';
    log.level = argv.logLevel || 'warn';

    // Allow heapdump via USR2 signal
    process.env.NODE_ENV !== 'test' && require('heapdump');  // eslint-disable-line global-require

    // Prepare DB stuff
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));
    const esClient = new elasticsearch.Client({ host: config.get('elasticsearchHost'), apiVersion: '2.2' });

    // Stats
    stats.process();

    // Start the continuous process of scoring!
    cycle(npmsNano, esClient);
};
