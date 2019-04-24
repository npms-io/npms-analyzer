'use strict';

const couchdbIterator = require('couchdb-iterator');
const metadata = require('../../lib/analyze/collect/metadata');
const packageJsonFromData = require('../../lib/analyze/util/packageJsonFromData');
const analyze = require('../../lib/analyze');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/re-metadata' });

exports.command = 're-metadata [options]';
exports.describe = 'Iterates over all analyzed packages, running the metadata collector again';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks re-metadata [options]\n\n\
Iterates over all analyzed packages, running the metadata collector again.\nThis command is useful if there was a bug in the \
metadata collector. Note that the packages score won\'t be updated.');

exports.handler = (argv) => {
    process.title = 'npms-analyzer-re-metadata';
    logger.level = argv.logLevel;

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

            const name = row.id.split('!')[1];

            // Grab package data
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

                    // Remove the package if an unrecoverable error happened
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
            // Delete the analisis if the package does not exist in npm (e.g.: was deleted)
            .catch({ error: 'not_found' }, () => analyze.remove(name, npmsNano));
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
