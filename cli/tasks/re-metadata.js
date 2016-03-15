'use strict';

const config = require('config');
const nano = require('nano');
const log = require('npmlog');
const couchdbIterator = require('couchdb-iterator');
const metadata = require('../../lib/analyze/collect/metadata');
const packageJsonFromData = require('../../lib/analyze/util/packageJsonFromData');
const save = require('../../lib/analyze').save;

const logPrefix = '';

module.exports.builder = (yargs) => {
    return yargs
    .usage('Iterates over all analyzed modules, running the metadata collector again.\nThis command is useful if there was a bug in the \
metadata collector. Note that the modules score won\'t be updated.\n\nUsage: ./$0 tasks re-metadata [options]')
    .demand(2, 2);
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-re-metadata';
    log.level = argv.logLevel || 'info';

    // Prepare DB stuff
    const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

    log.info(logPrefix, 'Starting modules re-metadata');

    // Iterate over all modules
    couchdbIterator(npmsNano, (row, index) => {
        index && index % 10000 === 0 && log.info(logPrefix, `Processed ${index} rows`);

        const name = row.id.split('!')[1];

        // Grab module data
        return npmNano.getAsync(name)
        .then((data) => {
            const packageJson = packageJsonFromData(name, data);

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
        concurrency: 50,
        limit: 2500,
        includeDocs: true,
    })
    .then((count) => log.info(logPrefix, `Completed, processed a total of ${count} rows`))
    .done();
};
