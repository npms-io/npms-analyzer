'use strict';

const log = require('npmlog');
const promiseRetry = require('promise-retry');
const normalizePackageData = require('normalize-package-data');
const rimraf = Promise.promisify(require('rimraf'));
const collect = require('./collect');
const evaluate = require('./evaluate');
const download = require('./download');

const logPrefix = 'analyze';

/**
 * Grab the latest package.json from the module data, normalizing it.
 *
 * @param {object} data The module data
 *
 * @return {object} The normalized package json
 */
function getPackageJson(data) {
    let packageJson = data.versions[data['dist-tags'].latest];

    // Some modules in npm are corrupt and don't have a latest version, e.g.: node-gr
    if (!packageJson) {
        log.warn(logPrefix, `No latest version information for ${data.name}, mocking package json..`);
        packageJson = { name: data.name, version: '0.0.1' };
    // Some modules in npm are corrupt and don't have a version defined, e.g.: kevoree-utils
    } else if (!packageJson.version) {
        packageJson.version = '0.0.1';
    }

    normalizePackageData(packageJson);

    return packageJson;
}

/**
 * Saves the module analysis result.
 * Contains the collected info and the evaluation result.
 *
 * @param {string} moduleName The module name
 * @param {object} result     The analysis result
 * @param {Nano}   npmsNano   The client nano instance for npms
 *
 * @return {Promise} The promise that fulfills when done
 */
function save(moduleName, result, npmsNano) {
    const key = `module!${moduleName}`;

    return promiseRetry((retry) => {
        return npmsNano.getAsync(key)
        .catch((err) => {
            if (err.error === 'not_found') {
                return { _id: key };
            }

            throw err;
        })
        .then((doc) => {
            if (doc.startedAt && Date.parse(doc.startedAt) >= Date.parse(result.startedAt)) {
                log.warn(logPrefix, `Skipping storing ${moduleName} analysis result the stored one is more recent`,
                    { analyzedAt: result.analyzedAt, storedAnalyzedAt: doc.analyzedAt });
                return;
            }

            Object.assign(doc, result);

            return npmsNano.insertAsync(doc)
            .catch((err) => {
                if (err.error === 'conflict') {
                    err = new Error(`Conflict while storing ${moduleName} analysis result`);
                    log.warn(logPrefix, err.message, { err });
                    retry(err);
                }

                throw err;
            });
        });
    });
}

// ----------------------------------------------------------------------------

/**
 * Analyses a given module, running the collectors and evaluators and then saving the result.
 *
 * @param {string} moduleName The module name
 * @param {Nano}   npmNano    The npm nano client instance
 * @param {Nano}   npmsNano   The npms nano client instance
 * @param {object} [options]  The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise for the result
 */
function analyze(moduleName, npmNano, npmsNano, options) {
    options = Object.assign({
        githubTokens: null,    // The GitHub API tokens to use
        waitRateLimit: false,  // True to wait if handle rate limit for all tokens were exceeded
    }, options);

    log.info(logPrefix, `Starting ${moduleName} analysis`);

    const startedAt = (new Date()).toISOString();


    // Fetch module data & grab its package json
    return npmNano.getAsync(moduleName)
    .catch((err) => {
        if (err.error === 'not_found' && err.reason === 'deleted') {
            err.unrecoverable = true;  // Signal that this module should not be analyzed again
        }

        throw err;
    })
    .then((data) => [data, getPackageJson(data)])
    // Download the module
    .spread((data, packageJson) => {
        return download(packageJson, options)
        .then((tmpDir) => [data, packageJson, tmpDir]);
    })
    // Collect info + evaluate
    .spread((data, packageJson, tmpDir) => {
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
        // The temporary folder is no longer necessary, so delete it
        .then((result) => {
            return rimraf(tmpDir)
            .return(result);
        }, (err) => {
            return rimraf(tmpDir)
            .finally(() => { throw err; });
        });
    })
    // Store result
    .tap((result) => save(moduleName, result, npmsNano))
    .then((result) => {
        log.info(logPrefix, `Analysis of ${moduleName} completed`, { result });
        return result;
    }, (err) => {
        log[err.unrecoverable ? 'warn' : 'error'](logPrefix, `Analysis of ${moduleName} failed`, { err });
        throw err;
    });
}

module.exports = analyze;
