'use strict';

const config = require('config');
const analyze = require('../../lib/analyze');
const score = require('../../lib/scoring/score');
const bootstrap = require('../util/bootstrap');

const log = logger.child({ module: 'cli/process-package' });

exports.command = 'process-package <package> [options]';
exports.describe = 'Processes a single package, analyzing and scoring it';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 tasks process-package <package> [options]\n\n\
Processes a single package, analyzing and scoring it.')
    .example('$0 tasks process-package analyze cross-spawn')
    .example('$0 tasks process-package analyze cross-spawn --no-analyze', 'Just score the package, do not analyze')

    .option('analyze', {
        type: 'boolean',
        default: true,
        describe: 'Either to analyze and score or just score',
    });

exports.handler = (argv) => {
    process.title = 'npms-analyzer-process-package';
    logger.level = argv.logLevel || 'info';

    const name = argv.package.toString(); // Package 0 evaluates to number so we must cast to a string

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'elasticsearch'])
    .spread((npmNano, npmsNano, esClient) => (
        // Analyze the package
        Promise.try(() => {
            if (!argv.analyze) {
                return analyze.get(name, npmsNano);
            }

            return analyze(name, npmNano, npmsNano, {
                githubTokens: config.get('githubTokens'),
                snykToken: config.get('snykToken'),
            });
        })
        .tap((analysis) => log.info({ analysis }, 'Analyze data'))
        // Score the package
        .then((analysis) => (
            score(analysis, npmsNano, esClient)
            .tap((score) => log.info({ score }, 'Score data'))
            .catch({ code: 'SCORE_INDEX_NOT_FOUND' }, () => {})
        ))
        .catch({ code: 'PACKAGE_NOT_FOUND' }, (err) => score.remove(name, esClient).finally(() => { throw err; }))
    ))
    .then(() => process.exit())
    .done();
};
