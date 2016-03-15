'use strict';

const config = require('config');
const nano = require('nano');
const elasticsearch = require('elasticsearch');
const log = require('npmlog');
const prettyjson = require('prettyjson');
const analyze = require('../../lib/analyze');
const score = require('../../lib/scoring/score');

module.exports.builder = (yargs) => {
    return yargs
    .usage('Usage: ./$0 tasks process-module <module> [options]\n\nProcesses a single module, analyzing and scoring it.')
    .demand(3, 3, 'Please supply one module to process')
    .example('./$0 module analyze cross-spawn');
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-process-module';
    log.level = argv.logLevel || 'info';

    const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
    const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));
    const esClient = new elasticsearch.Client({ host: config.get('elasticsearchHost'), apiVersion: '2.2' });

    const name = argv._[2].toString();  // module 0 evaluates to number so we must cast to a string

    // Analyze the module
    return analyze(name, npmNano, npmsNano, {
        githubTokens: config.get('githubTokens'),
        gitRefOverrides: config.get('gitRefOverrides'),
    })
    .tap((analysis) => {
        process.stdout.write('\nAnalyze data:\n-------------------------------------------\n');
        process.stdout.write(prettyjson.render(analysis, {
            keysColor: 'cyan',
            dashColor: 'grey',
            stringColor: 'white',
        }));
        process.stdout.write('\n');
    })
    // Score the module
    .then((analysis) => {
        return score(analysis, npmsNano, esClient)
        .catch(() => {})
        .then((score) => {
            process.stdout.write('\nScore data:\n-------------------------------------------\n');
            process.stdout.write(prettyjson.render(score, {
                keysColor: 'cyan',
                dashColor: 'grey',
                stringColor: 'white',
            }));
            process.stdout.write('\n');
        });
    })
    .catch({ code: 'MODULE_NOT_FOUND' }, (err) => score.remove(name, esClient).finally(() => { throw err; }))
    .done();
};
