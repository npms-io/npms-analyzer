'use strict';

const config = require('config');
const nano = require('nano');
const log = require('npmlog');
const prettyjson = require('prettyjson');
const analyze = require('../../lib/analysis/analyze');

module.exports.builder = (yargs) => {
    return yargs
    .usage('Usage: ./$0 module analyze <module> [options]\n\nRuns the analysis process for a single module.')
    .demand(3, 3, 'Please supply one module to analyze')
    .example('./$0 module analyze cross-spawn');
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-module-analyze';
    log.level = argv.logLevel || 'verbose';

    const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

    // Analyze module
    const name = argv._[2].toString();  // module 0 evaluates to number so we must cast to a string

    return analyze(name, npmNano, npmsNano, { githubTokens: config.get('githubTokens') })
    .then((result) => {
        process.stdout.write(prettyjson.render(result, {
            keysColor: 'cyan',
            dashColor: 'grey',
            stringColor: 'white',
        }));
        process.stdout.write('\n');
    })
    .done();
};
