'use strict';

const config = require('config');
const got = require('got');

const githubTokens = config.get('githubTokens');
const log = logger.child({ module: 'cli/check-gh-tokens' });

exports.command = 'check-gh-tokens [options]';
exports.describe = 'Checks the status of each GitHub token';

exports.builder = (yargs) =>
    yargs
    .usage('Usage: $0 check-gh-tokens [options]\n\n\
Checks the status of each GitHub token.');

exports.handler = (argv) => {
    process.title = 'npms-analyzer-check-gh-tokens';
    logger.level = argv.logLevel;

    const valid = [];
    const invalid = [];

    Promise.map(githubTokens, (token) => (
        got.get('https://api.github.com/user', {
            json: true,
            headers: {
                accept: 'application/vnd.github.v3+json',
                authorization: `token ${token}`,
            },
        })
        .then(() => valid.push(token))
        .catch((err) => err.statusCode === 401 || err.statusCode === 403, (err) => {
            log.debug({ err }, `Token ${token} seems invalid`);
            invalid.push(token);
        })
    ), { concurrency: 5 })
    .then(() => {
        log.info({ valid }, `${valid.length} valid tokens`);
        invalid.length && log.error({ invalid }, `${invalid.length} invalid tokens`);
    })
    .then(() => process.exit(invalid.length ? 1 : 0))
    .done();
};
