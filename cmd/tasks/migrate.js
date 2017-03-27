'use strict';

const couchdbIterator = require('couchdb-iterator');
const analyze = require('../../lib/analyze');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/migrate' });

function extractScope(name) {
    const match = name.match(/^@([^/]+)\/.+$/);

    return match ? match[1] : 'unscoped';
}

// --------------------------------------------------------------

exports.command = 'migrate [options]';
exports.describe = 'Run the latest migration';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks migrate [options]\n\n\
Run the latest migration.');

exports.handler = (argv) => {
    process.title = 'npms-analyzer-migrate';
    logger.level = argv.logLevel || 'info';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms'])
    .spread((npmNano, npmsNano) => {
        log.info('Starting packages re-metadata');

        // Stats
        stats.process();

        // Iterate over all packages
        return couchdbIterator(npmsNano, (row) => {
            row.index && row.index % 2500 === 0 && log.info(`Processed ${row.index} rows`);

            if (!row.doc) {
                return;
            }

            const name = row.doc.collected.metadata.name;

            row.doc.collected.metadata.scope = extractScope(name);

            return analyze.save(row.doc, npmsNano)
            .catch((err) => {
                log.error({ err }, `Failed to process ${name}`);
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
