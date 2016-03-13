'use strict';

const log = require('npmlog');
const promiseRetry = require('promise-retry');
const normalizePackageData = require('normalize-package-data');
const collect = require('./collect');
const evaluate = require('./evaluate');
const download = require('./download');
const exec = require('./util/exec');
const hostedGitInfo = require('./util/hostedGitInfo');

const logPrefix = 'analyze';

/**
 * Grab the latest package.json from the module data, normalizing it.
 *
 * @param {string} name The module name
 * @param {object} data The module data
 *
 * @return {object} The normalized package.json
 */
function getPackageJson(name, data) {
    let packageJson = data.versions[data['dist-tags'].latest];

    // Some modules in npm are corrupt and don't have a latest version, e.g.: node-gr
    if (!packageJson) {
        log.warn(logPrefix, `No latest version information for ${data.name}, mocking package.json..`);
        packageJson = { name: data.name, version: '0.0.1' };
    }

    // Check if the names are correct
    if (packageJson.name !== data.name || packageJson.name !== name) {
        throw Object.assign(new Error('Module name mismatch'),
            { name, dataName: data.name, packageJsonName: packageJson.name, unrecoverable: true });
    }

    // Some modules in npm are corrupt and don't have a version defined, e.g.: kevoree-utils
    if (!packageJson.version) {
        log.warn(logPrefix, `No version for ${data.name}, mocking version in package.json..`);
        packageJson.version = '0.0.1';
    }

    // Some packages error out while being normalized, for instance, when they contain malformed
    // URIs in the repository.url
    // e.g.: sails-sparql@0.10.0
    try {
        normalizePackageData(packageJson);
    } catch (err) {
        log.warn(logPrefix, `Error while normalizing ${data.name} package.json, mocking it..`, { err });
        err.unrecoverable = true;
        throw err;
    }

    // Normalize trailing slashes in repository
    // See: https://github.com/npm/hosted-git-info/issues/14
    if (packageJson.repository) {
        packageJson.repository.url = hostedGitInfo.normalizeTrailingSlashes(packageJson.repository.url);
    }

    return packageJson;
}

/**
 * Saves a module analysis result.
 * Contains the collected info and the evaluation result.
 *
 * @param {object} analysis The analysis result (can be the full doc to avoid having to fetch it)
 * @param {Nano}   npmsNano The client nano instance for npms
 *
 * @return {Promise} The promise that fulfills when done
 */
function save(analysis, npmsNano) {
    const name = analysis.collected.metadata.name;
    const key = `module!${name}`;

    return promiseRetry((retry) => {
        // Fetch the doc
        return Promise.try(() => {
            if (analysis._id && analysis._rev) {
                return;
            }

            return npmsNano.getAsync(key)
            .catch({ error: 'not_found' }, () => { return { _id: key }; })
            .then((doc) => {
                analysis._id = doc._id;
                analysis._rev = doc._rev;
            });
        })
        // Save it
        .then(() => {
            return npmsNano.insertAsync(analysis)
            .catch({ error: 'conflict' }, (err) => {
                err = new Error(`Conflict while storing ${name} analysis result`);
                log.warn(logPrefix, err.message, { err });
                retry(err);
            });
        });
    });
}

/**
 * Removes a module analysis result.
 *
 * @param {string} name     The module name
 * @param {Nano}   npmsNano The client nano instance for npms
 *
 * @return {Promise} The promise that fulfills when done
 */
function remove(name, npmsNano) {
    const key = `module!${name}`;

    return promiseRetry((retry) => {
        return npmsNano.getAsync(key)
        .then((doc) => {
            return npmsNano.destroyAsync(doc._id, doc._rev)
            .catch({ error: 'conflict' }, (err) => {
                err = new Error(`Conflict while removing ${name} analysis result`);
                log.warn(logPrefix, err.message, { err });
                retry(err);
            });
        });
    })
    .catch({ error: 'not_found' }, () => {});
}

// ----------------------------------------------------------------------------

/**
 * Analyses a given module, running the collectors and evaluators and then saving the result.
 *
 * @param {string} name      The module name
 * @param {Nano}   npmNano   The npm nano client instance
 * @param {Nano}   npmsNano  The npms nano client instance
 * @param {object} [options] The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise for the saved analysis document
 */
function analyze(name, npmNano, npmsNano, options) {
    options = Object.assign({
        githubTokens: null,    // The GitHub API tokens to use
        waitRateLimit: false,  // True to wait if handle rate limit for all tokens were exceeded
    }, options);

    log.info(logPrefix, `Starting ${name} analysis`);

    const startedAt = (new Date()).toISOString();

    // Fetch module data & grab its package.json
    return npmNano.getAsync(name)
    // If it doesn't exist, attempt to delete the analysis result and then fail
    .catch({ error: 'not_found' }, (err) => {
        err.unrecoverable = true;  // Signal that this module should not be analyzed again

        return remove(name, npmsNano)
        .finally(() => { throw err; });
    })
    // Otherwise, analyze it!
    .then((data) => {
        const packageJson = getPackageJson(name, data);

        // Download
        return download(packageJson, options)
        // Collect + evaluate
        .then((tmpDir) => {
            return collect(data, packageJson, tmpDir, npmNano, options)
            .then((collected) => {
                const evaluation = evaluate(collected);

                return {
                    startedAt,
                    finishedAt: (new Date()).toISOString(),
                    collected,
                    evaluation,
                };
            })
            // Get rid of download folder
            .then((analysis) => {
                return exec(`rm -rf ${tmpDir}`)
                .return(analysis);
            }, (err) => {
                return exec(`rm -rf ${tmpDir}`)
                .finally(() => { throw err; });
            });
        });
    })
    // Finally, save the analysis
    .tap((analysis) => save(analysis, npmsNano))
    .then((analysis) => {
        log.info(logPrefix, `Analysis of ${name} completed`, { analysis });
        return analysis;
    }, (err) => {
        log[err.unrecoverable ? 'info' : 'error'](logPrefix, `Analysis of ${name} failed`, { err });
        throw err;
    });
}

module.exports = analyze;
module.exports.save = save;
module.exports.remove = save;
module.exports.getPackageJson = getPackageJson;
