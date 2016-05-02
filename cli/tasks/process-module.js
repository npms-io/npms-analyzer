'use strict';

const config = require('config');
const prettyjson = require('prettyjson');
const analyze = require('../../lib/analyze');
const score = require('../../lib/scoring/score');
const bootstrap = require('../util/bootstrap');

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: ./$0 tasks process-module <module> [options]\n\n\
Processes a single module, analyzing and scoring it.')
    .demand(3, 3, 'Please supply one module to process')
    .example('./$0 tasks process-module analyze cross-spawn')
    .example('./$0 tasks process-module analyze cross-spawn --no-analyze', 'Just score the module, do not analyze')

    .option('analyze', {
        type: 'boolean',
        default: true,
        describe: 'Either to analyze and score or just score',
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-process-module';
    logger.level = argv.logLevel || 'info';

    const name = argv._[2].toString();  // module 0 evaluates to number so we must cast to a string

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'elasticsearch'], { wait: false })
    .spread((npmNano, npmsNano, esClient) => {
        // Analyze the module
        return Promise.try(() => {
            if (!argv.analyze) {
                return analyze.get(name, npmsNano);
            }

            return analyze(name, npmNano, npmsNano, {
                githubTokens: config.get('githubTokens'),
                gitRefOverrides: config.get('gitRefOverrides'),
            });
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
        .catch({ code: 'MODULE_NOT_FOUND' }, (err) => score.remove(name, esClient).finally(() => { throw err; }));
    })
    .done();
};
