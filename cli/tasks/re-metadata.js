'use strict';

const couchdbIterator = require('couchdb-iterator');
const metadata = require('../../lib/analyze/collect/metadata');
const packageJsonFromData = require('../../lib/analyze/util/packageJsonFromData');
const analyze = require('../../lib/analyze');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/re-metadata' });

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 tasks re-metadata [options]\n\n\
Iterates over all analyzed modules, running the metadata collector again.\nThis command is useful if there was a bug in the \
metadata collector. Note that the modules score won\'t be updated.')
    .demand(2, 2);
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-re-metadata';
    logger.level = argv.logLevel || 'info';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms'])
    .spread((npmNano, npmsNano) => {
        log.info('Starting modules re-metadata');

        // Stats
        stats.process();

        // Iterate over all modules
        return couchdbIterator(npmsNano, (row) => {
            row.index && row.index % 2500 === 0 && log.info(`Processed ${row.index} rows`);

            if (!row.doc) {
                return;
            }

            const name = row.id.split('!')[1];

            // Grab module data
            return npmNano.getAsync(name)
            .then((data) => {
                let packageJson;

                // Extract package json
                try {
                    packageJson = packageJsonFromData(name, data);
                } catch (err) {
                    if (!err.unrecoverable) {
                        throw err;
                    }

                    // Remove the module if an unrecoverable error happened
                    // We do this to prevent old metadata to stay around, which will probably cause issues further ahead
                    return analyze.remove(name, npmsNano);
                }

                // Re-run metadata
                return metadata(data, packageJson)
                // Save it!
                .then((metadata) => {
                    row.doc.collected.metadata = metadata;

                    return analyze.save(row.doc, npmsNano);
                })
                .catch((err) => {
                    log.error({ err }, `Failed to process ${name}`);
                    throw err;
                });
            })
            // Delete the analisis if the module does not exist in npm (e.g.: was deleted)
            .catch({ error: 'not_found' }, () => analyze.remove(name, npmsNano));
        }, {
            startkey: 'module!',
            endkey: 'module!\ufff0',
            concurrency: 25,
            limit: 2500,
            includeDocs: true,
        })
        .then((count) => log.info(`Completed, processed a total of ${count} rows`));
    })
    .then(() => process.exit())
    .done();
};
