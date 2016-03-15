'use strict';

const config = require('config');
const nano = require('nano');
const log = require('npmlog');
const couchdbIterator = require('couchdb-iterator');
const evaluate = require('../../lib/analyze/evaluate');
const save = require('../../lib/analyze').save;

const logPrefix = '';

module.exports.builder = (yargs) => {
    return yargs
    .usage('Iterates over all analyzed modules, evaluating them again.\nThis command is useful if the evaluation algorithm has changed and \
the evaluation needs to be re-calculated for all modules. Note that the modules score won\'t be updated.\n\n\
Usage: ./$0 tasks re-evaluate [options]')
    .demand(2, 2);
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-re-evaluate';
    log.level = argv.logLevel || 'info';

    // Prepare DB stuff
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

    log.info(logPrefix, 'Starting modules re-evaluation');

    // Iterate over all modules, re-evaluating them
    couchdbIterator(npmsNano, (row, index) => {
        index && index % 10000 === 0 && log.info(logPrefix, `Processed ${index} rows`);
        row.doc.evaluation = evaluate(row.doc.collected);

        return save(row.doc, npmsNano);
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
