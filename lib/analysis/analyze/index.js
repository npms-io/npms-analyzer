'use strict';

const Promise = require('bluebird');
const log = require('npmlog');
const promiseRetry = require('promise-retry');
const normalizePackageData = require('normalize-package-data');
const collectors = require('./collectors');
const evaluators = require('./evaluators');

/**
 * Runs all the collectors.
 *
 * @param {string} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {Nano}   npmNano     The npm nano client instance
 * @param {object} options     The options inferred from analyze() options
 *
 * @return {Promise} The promise that fulfills when done
 */
function collect(data, packageJson, npmNano, options) {
    return Promise.props({
        metadata: collectors.metadata(data, packageJson),
        npm: collectors.npm(data, npmNano),
        github: collectors.github(data, packageJson,
            { tokens: options.githubTokens, waitRateLimit: options.waitRateLimit }),
        source: collectors.source(data, packageJson, '.',
            { npmRegistry: `${npmNano.config.url}/${npmNano.config.db}` }),
    });
}

/**
 * Runs all the evaluators.
 *
 * @param {object} info The collected information
 *
 * @return {object} The evaluation result
 */
function evaluate(info) {
    return {
        quality: evaluators.quality(info),
        popularity: evaluators.popularity(info),
        maintenance: evaluators.maintenance(info),
    };
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
                log.warn('analyze', `Skipping storing ${moduleName} analysis result the stored one is more recent`,
                    { analyzedAt: result.analyzedAt, storedAnalyzedAt: doc.analyzedAt });
                return;
            }

            Object.assign(doc, result);

            return npmsNano.insertAsync(doc)
            .catch((err) => {
                if (err.error === 'conflict') {
                    err = new Error(`Conflict while storing ${moduleName} analysis result`);
                    log.warn('analyze', err.message, { err });
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

    log.info('analyze', `Starting ${moduleName} analysis`);

    const startedAt = (new Date()).toISOString();

    // Fetch module data
    return npmNano.getAsync(moduleName)
    // Collect info + evaluate
    .then((data) => {
        const packageJson = data.versions[data['dist-tags'].latest];

        normalizePackageData(packageJson);

        return collect(data, packageJson, npmNano, options)
        .then((info) => {
            return {
                startedAt,
                finishedAt: (new Date()).toISOString(),
                info,
                evaluation: evaluate(info),
            };
        });
    })
    // Store result
    .tap((result) => save(moduleName, result, npmsNano))
    .tap((result) => {
        log.info('analyze', `Analysis of ${moduleName} completed`, { result });
    }, (err) => {
        log.error('analyze', `Analysis of ${moduleName} failed`, { err });
        throw err;
    });
}

module.exports = analyze;
module.exports.collect = collect;
module.exports.evaluate = evaluate;
