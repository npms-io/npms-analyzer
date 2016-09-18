'use strict';

const path = require('path');
const glob = Promise.promisify(require('glob'));
const promiseRetry = require('promise-retry');
const detectRepoLinters = require('detect-repo-linters');
const detectReadmeBadges = require('detect-readme-badges');
const fetchCoverage = require('fetch-coverage');
const loadJsonFile = require('load-json-file');
const deepCompact = require('deep-compact');
const isRegularFile = require('is-regular-file');
const camelcaseKeys = require('camelcase-keys');
const fileSize = require('./util/fileSize');
const promisePropsSettled = require('./util/promisePropsSettled');
const exec = require('../util/exec');
const gotRetries = require('../util/gotRetries');

const nspBin = path.normalize(`${__dirname}/../../../node_modules/.bin/nsp`);
const davidBin = path.normalize(`${__dirname}/bin/david-json`);
const log = logger.child({ module: 'collect/source' });

/**
 * Inspects important files, such as the tests and README file sizes.
 *
 * @param {object} data The package data
 * @param {string} dir  The package directory
 *
 * @return {Promise} The promise for the inspection result
 */
function inspectFiles(data, dir) {
    // Test for `test/`, `spec/`, `__test__` and `__spec__` directories, including its plural variants
    const testsSize = glob(`${dir}/**/*(_){test,spec}?(s)*(_)/**/*`, {
        ignore: 'node_modules/**',
        nodir: true,
        dot: true,
        silent: true,   // Do not print warnings
        strict: false,  // Do not crash on the first error
    })
    // If none were found, test for simple test and spec files in the root, including its plural variants
    .then((paths) => {
        return paths.length ? paths : glob(`${dir}/{test,spec}?(s).*`, {
            ignore: 'node_modules/**',
            nodir: true,
            dot: true,
            silent: true,   // Do not print warnings
            strict: false,  // Do not crash on the first error
        });
    })
    // TODO: Ignore fixtures?
    .then((paths) => fileSize(paths));

    return Promise.props({
        readmeSize: data.readmeFilename ? fileSize(`${dir}/${data.readmeFilename}`) : 0,
        testsSize,
        hasNpmIgnore: isRegularFile(`${dir}/.npmignore`),
        hasShrinkwrap: isRegularFile(`${dir}/npm-shrinkwrap.json`),
    });
}

/**
 * Checks the package looking for known vulnerabilities.
 * Uses https://github.com/nodesecurity/nsp under the hood.
 *
 * @param {string} name The package name
 * @param {string} dir  The package directory
 *
 * @return {Promise} The promise for the vulnerabilities or false if package is totally broken
 */
function checkVulnerabilities(name, dir) {
    const jsonFile = `${dir}/.npms-nsp.json`;

    // Need to pipe stdout to a file due to a NodeJS bug where the output was being truncated
    // See: https://github.com/nodejs/node/issues/784; Test case: run analyze for Web4.0 package
    // We also run a binary wrapper around the david package because it had memory leaks, causing the memory of this
    // process to grow over time
    return promiseRetry((retry) => {
        return exec(exec.escape`${nspBin} check --output json --warn-only > ${jsonFile}`, { cwd: dir, timeout: 60 * 1000 })
        // Retry on 503 errors since this happens often
        .catch((err) => /"statusCode"\s*:\s*503/.test(err.stderr), (err) => {
            log.warn({ err }, 'The nsp service appears to be unavailable (503), retrying..');
            retry(err);
        })
        // Retry on 504 errors since this happens often
        // The output is a buffer <html><body><h1>504 Gateway Time-out</h1>\nThe server didn\'t respond in time.\n</body></html>\n\n
        // or just a regular Debug output: Bad Gateway
        .catch((err) => err.stderr && /Bad Gateway|53,48,52,32,71,97,116,101,119,97,121,32,84,105,109,101,45,111,117,116/i.test(err.stderr), (err) => {  // eslint-disable-line max-len
            log.warn({ err }, 'The nsp service appears to be unavailable (504), retrying..');
            retry(err);
        })
        // Retry on network errors
        .catch((err) => err.stderr && gotRetries.transientErrors.some((code) => err.stderr.indexOf(code) !== -1), retry);
    })
    .then(() => loadJsonFile(jsonFile))
    .map((vulnerability) => camelcaseKeys(vulnerability, { deep: true }))
    // Ignore JOI validation error of some packages, e.g.: `allthejs`
    .catch((err) => /"statusCode":400/i.test(err.stderr), (err) => {
        log.warn({ err, dir }, `Ignoring bad request error while scanning ${name} dependencies with nsp`);
        return false;
    })
    // Ignore unknown errors that happen on some packages, e.g.: `ccbuild` which has invalid semver on dependencies
    .catch((err) => err.stderr === 'Debug output: undefined\n{}\n', (err) => {
        log.warn({ err, dir }, `Ignoring unknown error while scanning ${name} dependencies with nsp`);
        return false;
    })
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err, dir }, `Failed to scan ${name} vulnerabilities`);
        /* istanbul ignore next */
        throw err;
    });
}

/**
 * Checks the package dependencies looking for outdated versions.
 * Uses https://github.com/alanshaw/david under the hood, the package that powers https://david-dm.org/.
 *
 * @param {string} name    The package name
 * @param {string} dir     The package directory
 * @param {object} options The options inferred from source() options
 *
 * @return {Promise} The promise for the outdated dependencies, indexed by name or false if deps are totally broken
 */
function checkOutdatedDeps(name, dir, options) {
    const jsonFile = `${dir}/.npms-david.json`;

    // Need to pipe stdout to a file due to a NodeJS bug where the output was being truncated
    // See: https://github.com/nodejs/node/issues/784
    // We also run a binary wrapper around the david package because it had memory leaks, causing the memory of this
    // process to grow over time
    return exec(exec.escape`${davidBin} --registry ${options.npmRegistry} > ${jsonFile}`, { cwd: dir, timeout: 60 * 1000 })
    .then(() => loadJsonFile(jsonFile))
    // Ignore broken deps
    .catch((err) => /failed to get versions/i.test(err.stderr), (err) => {
        log.warn({ err }, `Some of ${name} dependencies are broken, skipping check outdated..`);
        return false;
    })
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err }, `Failed to check outdated dependencies of ${name}`);
        /* istanbul ignore next */
        throw err;
    });
}

/**
 * Fetches the code coverage.
 *
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {array}  badges      The badges detected by the detect-readme-badges package to speed up the process
 *
 * @return {Promise} The promise for the code coverage, a number from 0 to 1
 */
function fetchCodeCoverage(packageJson, badges) {
    const repository = packageJson.repository;


    if (!repository) {
        return Promise.resolve();
    }

    return fetchCoverage(repository.url, {
        badges,
        got: { retries: gotRetries },
    })
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err }, 'Failed to fetch code coverage');
        /* istanbul ignore next */
        throw err;
    });
}

// ----------------------------------------------------------------------------

// TODO: code complexity? https://www.npmjs.com/package/escomplex
// TODO: technical debts, such as TODO's and FIXME's?

/**
 * Runs the source analyzer.
 *
 * @param {string} data        The package data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} downloaded  The downloaded info (`dir`, `packageJson`, ...)
 * @param {object} [options]   The options; read below to get to know each available option
 *
 * @return {Promise} The promise that fulfills when done
 */
function source(data, packageJson, downloaded, options) {
    options = Object.assign({
        npmRegistry: 'https://registry.npmjs.org',  // The registry url to be used
    }, options);

    // Need to use typeof because there's some old packages in which the README is an object, e.g.: `flatsite`
    const badges = typeof data.readme === 'string' && detectReadmeBadges(data.readme);

    // Analyze source first because the external tools add files to the directory
    return promisePropsSettled({
        files: inspectFiles(data, downloaded.dir),
        repositorySize: fileSize.dir(downloaded.dir),
        linters: detectRepoLinters(downloaded.dir),
        coverage: fetchCodeCoverage(packageJson, badges),
        badges,
    })
    // Finally use external tools
    .then((props) => {
        return promisePropsSettled({
            outdatedDependencies: checkOutdatedDeps(packageJson.name, downloaded.dir, options),
            vulnerabilities: checkVulnerabilities(packageJson.name, downloaded.dir),
        })
        .then((props_) => Object.assign(props, props_));
    })
    .then((result) => deepCompact(result))
    .tap(() => log.debug(`The source collector for ${packageJson.name} completed successfully`));
}

module.exports = source;
