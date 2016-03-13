'use strict';

const config = require('config');
const log = require('npmlog');
const nano = require('nano');
const elasticsearch = require('elasticsearch');
const couchdbIterator = require('couchdb-iterator');
const humanizeDuration = require('humanize-duration');
const score = require('../lib/scoring/score');
const aggregate = require('../lib/scoring/aggregate');
const stats = require('./stats');

/**
 * Runs a scoring cycle.
 * When it finishes, another cycle will be automatically run after a certain delay.
 *
 * @param {Nano}          npmsNano The npm nano instance
 * @param {Elasticsearch} esClient The elasticsearch client instance
 */
function cycle(npmsNano, esClient) {
    const startedAt = Date.now();

    log.info('', 'Aggregation evaluations..');

    aggregate(npmsNano)
    .spread((aggregation) => {
        log.info('', 'Scoring modules..');

        // Finally iterate and compute the score
        return couchdbIterator(npmsNano, (row, index) => {
            index && index % 10000 === 0 && log.info('', `Scored a total of ${index} modules`);

            return score(row.doc, aggregation, esClient);
        }, {
            startkey: 'module!',
            endkey: 'module!\ufff0',
            concurrency: 50,
            limit: 2500,
            includeDocs: true,
        })
        .then((count) => {
            const duration = humanizeDuration(Math.round((Date.now() - startedAt) / 1000) * 1000, { largest: 2 });

            log.info('', `Scoring cycle successful, processed a total of ${count} modules in ${duration}`);
            return [aggregation, count];
        }, (err) => {
            log.error('', 'Scoring cycle failed', { err });
            throw err;
        });
    })
    .catch((err) => log.error('', 'Scoring cycle failed', { err }))
    .then(() => Promise.delay(60000))
    .then(() => cycle(npmsNano, esClient));
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
