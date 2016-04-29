'use strict';

const log = require('npmlog');
const couchdbIterator = require('couchdb-iterator');
const metadata = require('../../lib/analyze/collect/metadata');
const packageJsonFromData = require('../../lib/analyze/util/packageJsonFromData');
const save = require('../../lib/analyze').save;
const bootstrap = require('../util/bootstrap');

const logPrefix = '';

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: ./$0 tasks re-metadata [options]\n\n\
Iterates over all analyzed modules, running the metadata collector again.\nThis command is useful if there was a bug in the \
metadata collector. Note that the modules score won\'t be updated.')
    .demand(2, 2);
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-re-metadata';
    log.level = argv.logLevel || 'info';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms'], { wait: false })
    .spread((npmNano, npmsNano) => {
        log.info(logPrefix, 'Starting modules re-metadata');

        // Iterate over all modules
        return couchdbIterator(npmsNano, (row) => {
            row.index && row.index % 10000 === 0 && log.info(logPrefix, `Processed ${row.index} rows`);

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
                    if (err.unrecoverable) {
                        throw err;
                    }

                    return;
                }

                // Re-run metadata
                return metadata(data, packageJson)
                // Save it!
                .then((metadata) => {
                    row.doc.collected.metadata = metadata;

                    return save(row.doc, npmsNano);
                })
                .catch((err) => {
                    log.error(logPrefix, `Failed to process ${name}`, { err });
                    throw err;
                });
            })
            // Ignore if the module does not exist in npm (e.g.: was deleted)
            .catch({ error: 'not_found' }, () => {});
        }, {
            startkey: 'module!',
            endkey: 'module!\ufff0',
            concurrency: 25,
            limit: 2500,
            includeDocs: true,
        })
        .then((count) => log.info(logPrefix, `Completed, processed a total of ${count} rows`));
    })
    .done();
};
