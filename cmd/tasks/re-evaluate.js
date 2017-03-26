'use strict';

const couchdbIterator = require('couchdb-iterator');
const evaluate = require('../../lib/analyze/evaluate');
const save = require('../../lib/analyze').save;
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/re-evaluate' });

exports.command = 're-evaluate [options]';
exports.describe = 'Iterates over all analyzed packages, evaluating them again';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks re-evaluate [options]\n\n\
Iterates over all analyzed packages, evaluating them again.\nThis command is useful if the evaluation algorithm has changed and \
the evaluation needs to be re-calculated for all packages. Note that the packages score won\'t be updated.');

exports.handler = (argv) => {
    process.title = 'npms-analyzer-re-evaluate';
    logger.level = argv.logLevel || 'info';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpms'])
    .spread((npmsNano) => {
        log.info('Starting packages re-evaluation');

        // Stats
        stats.process();

        // Iterate over all packages, re-evaluating them
        return couchdbIterator(npmsNano, (row) => {
            row.index && row.index % 10000 === 0 && log.info(`Processed ${row.index} rows`);

            const doc = row.doc;

            if (!doc) {
                return;
            }

            const name = doc.collected.metadata.name;

            log.debug(`Evaluating ${name}..`);

            return Promise.try(() => {
                doc.evaluation = evaluate(doc.collected);

                return save(doc, npmsNano);
            })
            .catch((err) => {
                log.error({ err }, `Failed to evaluate ${name}`);
                throw err;
            });
        }, {
            startkey: 'package!',
            endkey: 'package!\ufff0',
            concurrency: 25,
            limit: 2500,
            includeDocs: true,
        })
        .then((count) => log.info(`Completed, processed a total of ${count} rows`));
    })
    .then(() => process.exit())
    .done();
};
