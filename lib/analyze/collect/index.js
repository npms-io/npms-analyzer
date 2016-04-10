'use strict';

const pickBy = require('lodash/pickBy');
const collectors = require('require-directory')(module);
const promisePropsSettled = require('./util/promisePropsSettled');

/**
 * Runs all the collectors.
 *
 * @param {string} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {string} dir         The module directory (usually a temporary directory)
 * @param {Nano}   npmNano     The npm nano client instance
 * @param {object} [options]   The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise that fulfills when done
 */
function collect(data, packageJson, dir, npmNano, options) {
    options = Object.assign({
        githubTokens: null,   // The GitHub API tokens to use
        waitRateLimit: false, // True to wait if rate limit for all tokens were exceeded
    }, options);

    return promisePropsSettled({
        metadata: collectors.metadata(data, packageJson),
        npm: collectors.npm(data, packageJson, npmNano),
        github: collectors.github(data, packageJson, { tokens: options.githubTokens, waitRateLimit: options.waitRateLimit }),
        source: collectors.source(data, packageJson, dir, { npmRegistry: `${npmNano.config.url}/${npmNano.config.db}` }),
    })
    .then((object) => pickBy(object));
}

module.exports = collect;
