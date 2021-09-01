'use strict';

const promiseRetry = require('promise-retry');
const serializeError = require('serialize-error');
const omit = require('lodash/omit');
const collect = require('./collect');
const evaluate = require('./evaluate');
const download = require('./download');
const exec = require('./util/exec');
const packageJsonFromData = require('./util/packageJsonFromData');

const log = logger.child({ module: 'analyze' });

/**
 * Gets a package analysis.
 *
 * @param {String} name     - The package name.
 * @param {Nano}   npmsNano - The client nano instance for npms.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function get(name, npmsNano) {
    return npmsNano.getAsync(`package!${name}`)
    .catch({ error: 'not_found' }, () => {
        throw Object.assign(new Error(`Analysis for package ${name} does not exist`), { code: 'ANALYSIS_NOT_FOUND' });
    });
}

/**
 * Removes a package analysis.
 *
 * @param {String} name     - The package name.
 * @param {Nano}   npmsNano - The client nano instance for npms.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function remove(name, npmsNano) {
    return promiseRetry((retry) => (
        get(name, npmsNano)
        .then((doc) => (
            npmsNano.destroyAsync(doc._id, doc._rev)
            .catch({ error: 'conflict' }, (err) => {
                err = new Error(`Conflict while removing ${name} analysis`);
                log.warn({ err }, err.message);
                retry(err);
            })
        ))
    ))
    .catch({ code: 'ANALYSIS_NOT_FOUND' }, () => {})
    .then(() => log.trace(`Removed analysis of ${name}`));
}

/**
 * Saves a package analysis.
 * Contains the collected info and the evaluation result.
 *
 * @param {Object} analysis - The analysis (can be the full doc to avoid having to fetch it).
 * @param {Nano}   npmsNano - The client nano instance for npms.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function save(analysis, npmsNano) {
    const name = analysis.collected.metadata.name;

    return promiseRetry((retry) =>
        // Fetch the doc if necessary to obtain its rev
        Promise.try(() => {
            if (analysis._rev) {
                return;
            }

            return get(name, npmsNano)
            .then((doc) => { analysis._rev = doc._rev; })
            .catch({ code: 'ANALYSIS_NOT_FOUND' }, () => {});
        })
        // Save it
        .then(() => {
            analysis._id = `package!${name}`;

            return npmsNano.insertAsync(analysis)
            .tap((response) => { analysis._rev = response.rev; })
            .catch({ error: 'conflict' }, (err) => {
                err = new Error(`Conflict while storing ${name} analysis`);
                log.warn({ err }, err.message);

                delete analysis._rev;
                retry(err);
            });
        })
    )
    .return(analysis)
    .tap((analysis) => log.trace({ analysis }, `Saved analysis of ${name}`));
}

/**
 * Saves a failed analysis of a package.
 *
 * @param {String} name     - The package name.
 * @param {Error}  err      - The analysis error.
 * @param {Nano}   npmsNano - The npms nano client instance.
 *
 * @returns {Promise} The promise for the saved analysis document.
 */
function saveFailed(name, err, npmsNano) {
    return get(name, npmsNano)
    .catch({ code: 'ANALYSIS_NOT_FOUND' }, () => ({}))
    .tap((analysis) => {
        analysis.error = omit(
            serializeError(err),
            'gotOptions' // Please note gotOptions might contain sensitive information such as tokens.
        );
        analysis.error.caughtAt = (new Date()).toISOString();
        analysis.startedAt = analysis.startedAt || (new Date()).toISOString();
        analysis.finishedAt = analysis.finishedAt || (new Date()).toISOString();
        analysis.collected = analysis.collected || collect.empty(name);
        analysis.evaluation = analysis.evaluation || evaluate(analysis.collected);
    })
    .then((analysis) => save(analysis, npmsNano))
    .then((analysis) => {
        log.debug({ analysis }, `Saved failed analysis of ${name}`);

        return analysis;
    }, (err) => {
        log.error({ err }, `Error while saving failed analysis of ${name}`);
        throw err;
    });
}

/**
 * Analyses a package, running the collectors & evaluators and then saving the result.
 *
 * @param {String} name      - The package name.
 * @param {Nano}   npmNano   - The npm nano client instance.
 * @param {Nano}   npmsNano  - The npms nano client instance.
 * @param {Object} [options] - The options; read below to get to know each available option.
 *
 * @returns {Promise} The promise for the saved analysis document.
 */
function analyze(name, npmNano, npmsNano, options) {
    options = Object.assign({
        githubTokens: null, // The GitHub API tokens to use
        waitRateLimit: false, // True to wait if rate limit for all tokens were exceeded
        rev: null, // Pass the previous analysis revision if any
    }, options);

    log.trace(`Starting ${name} analysis`);

    const startedAt = (new Date()).toISOString();

    // Fetch package data & grab its package.json
    return npmNano.getAsync(name)
    // If it doesn't exist, attempt to delete the analysis and then fail
    .catch({ error: 'not_found' }, () => (
        remove(name, npmsNano)
        .finally(() => {
            throw Object.assign(new Error(`Package ${name} does not exist`), { code: 'PACKAGE_NOT_FOUND', unrecoverable: true });
        })
    ))
    // Otherwise, analyze it!
    .then((data) => {
        const packageJson = packageJsonFromData(name, data);

        // Download
        return download(packageJson, options)
        // Collect + evaluate
        .then((downloaded) => (
            collect(data, packageJson, downloaded, npmNano, options)
            .then((collected) => {
                const evaluation = evaluate(collected);

                return {
                    startedAt,
                    finishedAt: (new Date()).toISOString(),
                    collected,
                    evaluation,
                    _rev: options.rev || undefined,
                };
            })
            // Get rid of download folder
            .then((analysis) => (
                exec(exec.escape`rm -rf ${downloaded.dir}`)
                .return(analysis)
            ), (err) => (
                exec(exec.escape`rm -rf ${downloaded.dir}`)
                .finally(() => { throw err; })
            ))
        ));
    })
    // Finally, save the analysis
    .tap((analysis) => save(analysis, npmsNano))
    .then((analysis) => {
        log.debug({ analysis }, `Analysis of ${name} completed`);

        return analysis;
    }, (err) => {
        log[err.unrecoverable ? 'info' : 'error']({ err }, `Analysis of ${name} failed`);
        throw err;
    });
}

module.exports = analyze;
module.exports.get = get;
module.exports.save = save;
module.exports.saveFailed = saveFailed;
module.exports.remove = remove;
module.exports.cleanTmpDir = download.cleanTmpDir;
