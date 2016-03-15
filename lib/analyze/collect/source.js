'use strict';

const path = require('path');
const glob = Promise.promisify(require('glob'));
const detectRepoLinters = require('detect-repo-linters');
const detectReadmeBadges = require('detect-readme-badges');
const loadJsonFile = require('load-json-file');
const deepCompact = require('deep-compact');
const got = require('got');
const log = require('npmlog');
const pickBy = require('lodash/pickBy');
const find = require('lodash/find');
const isFile = require('./util/isFile');
const fileSize = require('./util/fileSize');
const promisePropsSettled = require('./util/promisePropsSettled');
const exec = require('../util/exec');
const gotRetries = require('../util/gotRetries');

const nspBin = path.normalize(`${__dirname}/../../../node_modules/.bin/nsp`);
const davidBin = path.normalize(`${__dirname}/bin/david-json`);
const logPrefix = 'collect/source';

/**
 * Inspects important files, such as the tests and README file sizes.
 *
 * @param {object} data The module data
 * @param {string} dir  The module directory
 *
 * @return {Promise} The promise for the inspection result
 */
function inspectFiles(data, dir) {
    // Test for `test/`, `spec/`, `__test__` and `__spec__` directories, including its plural variants
    const testsSize = glob('**/*(_){test,spec}?(s)*(_)/', { cwd: dir, ignore: 'node_modules/**' })
    // If none were found, test for simple test and spec files in the root, including its plural variants
    .then((paths) => {
        return paths.length ? paths : glob('{test,spec}?(s).*', { cwd: dir, nodir: true, ignore: 'node_modules/**' });
    })
    .map((path) => fileSize(`${dir}/${path}`))
    .reduce((sum, size) => sum + size, 0);

    return Promise.props({
        readmeSize: data.readmeFilename ? fileSize(data.readmeFilename) : 0,
        testsSize,
        hasNpmIgnore: isFile(`${dir}/.npmignore`),
    });
}

/**
 * Scans the module directory for common used linters (eslint, jshint, etc).
 *
 * @param {string} name The module name
 * @param {string} dir  The module directory
 *
 * @return {Promise} The promise for the linters result
 */
function scanRepoLinters(name, dir) {
    return detectRepoLinters(dir)
    .catch((err) => {
        log.error(logPrefix, `Failed to scan ${name} repository linters`, { err, dir });
        throw err;
    });
}

/**
 * Checks the module dependencies looking for known vulnerabilities.
 * Uses https://github.com/nodesecurity/nsp under the hood.
 *
 * @param {string} name The module name
 * @param {string} dir  The module directory
 *
 * @return {Promise} The promise for the vulnerabilities
 */
function checkDepsVulnerabilities(name, dir) {
    const jsonFile = `${dir}/.npms-nsp.json`;

    // Need to pipe stdout to a file due to a NodeJS bug where the output was being truncated
    // See: https://github.com/nodejs/node/issues/784
    // Test case: run analyze for Web4.0 module
    return exec(`${nspBin} check --output json --warn-only > ${jsonFile}`, { cwd: dir, timeout: 60 * 1000 })
    // Ignore validation errors of invalid or broken modules
    // e.g.: allthejs
    .then(() => loadJsonFile(jsonFile))
    .catch((err) => /"statusCode":400/i.test(err.stderr), (err) => {
        log.warn(logPrefix, `Ignoring bad request error while scanning ${name} dependencies with nsp`, { err, dir });
        return [];
    })
    .catch((err) => {
        log.error(logPrefix, `Failed to scan ${name} dependencies vulnerabilities`, { err, dir });
        throw err;
    });
}

/**
 * Checks the module dependencies looking for outdated versions.
 * Uses https://github.com/alanshaw/david under the hood, the module that powers https://david-dm.org/.
 *
 * @param {string} name    The module name
 * @param {string} dir     The module directory
 * @param {object} options The options inferred from source() options
 *
 * @return {Promise} The promise for the outdated dependencies, indexed by name
 */
function checkOutdatedDeps(name, dir, options) {
    const jsonFile = `${dir}/.npms-david.json`;

    // Need to pipe stdout to a file due to a NodeJS bug where the output was being truncated
    // See: https://github.com/nodejs/node/issues/784
    // We also run a binary wrapper around the david module because it had memory leaks, causing the memory of this
    // process to grow over time
    return exec(`${davidBin} --registry ${options.npmRegistry} > ${jsonFile}`, { cwd: dir, timeout: 60 * 1000 })
    .then(() => loadJsonFile(jsonFile))
    .then((deps) => {
        return pickBy(deps, (dep, name) => {
            if (!dep.warn) {
                return true;
            }

            log.info(logPrefix, `Filtered ${name}@${dep.required} from outdated dependencies analysis due to an error`,
                { err: dep.warn, name });
        });
    })
    // Ignore broken deps
    .catch((err) => /failed to get versions/i.test(err.stderr), (err) => {
        log.warn(logPrefix, `Some of ${name} dependencies are broken, skipping check outdated..`, { err });
        return {};
    })
    .catch((err) => {
        log.error(logPrefix, `Failed to check outdated dependencies of ${name}`, { err });
        throw err;
    });
}

/**
 * Fetches the coverage percentage from badges of type "coverage".
 * e.g.: https://img.shields.io/coveralls/IndigoUnited/node-planify.json
 *
 * @param {array} badges The badges detected by the detect-readme-badges module
 *
 * @return {Promise} The promise for the coverage %, a number from 0 to 1
 */
function fetchCoverageUsingBadges(badges) {
    const coverageBadge = find(badges || [], (badge) => badge.info.type === 'coverage');
    const url = coverageBadge && coverageBadge.urls.content;

    if (!url) {
        return Promise.resolve();
    }

    return got(url, {
        json: true,
        timeout: 15000,
        retries: gotRetries,
    })
    .then((response) => {
        const json = response.body;

        if (/unknown/i.test(json.value)) {
            return null;
        }

        const match = (json.value || '').match(/^(\d+)%$/);

        if (!match) {
            log.error(logPrefix, 'Could not get coverage % from JSON response', { json });
            return null;
        }

        return Number(match[1]) / 100;
    })
    .catch((err) => {
        log.error(logPrefix, `Failed to get coverage %, request to ${url} failed`, { url });
        throw err;
    });
}

// ----------------------------------------------------------------------------

// TODO: code complexity? https://www.npmjs.com/package/escomplex
// TODO: technical debts, such as TODO's and FIXME's?

/**
 * Runs the source analyzer.
 *
 * @param {string} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {string} dir         The module directory
 * @param {object} [options]   The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise that fulfills when done
 */
function source(data, packageJson, dir, options) {
    options = Object.assign({
        npmRegistry: 'https://registry.npmjs.org',  // The registry url to be used
    }, options);

    // Need to use typeof because there's some old modules in which the README is an object, e.g.: flatsite
    const badges = typeof data.readme === 'string' && detectReadmeBadges(data.readme);

    return promisePropsSettled({
        files: inspectFiles(data, dir),
        repositorySize: fileSize(dir),
        outdatedDependencies: checkOutdatedDeps(packageJson.name, dir, options),
        dependenciesVulnerabilities: checkDepsVulnerabilities(packageJson.name, dir),
        linters: scanRepoLinters(packageJson.name, dir),
        coverage: fetchCoverageUsingBadges(badges),
        badges,
    })
    .then((result) => deepCompact(result))
    .tap(() => log.verbose(logPrefix, 'The source collector completed successfully'));
}

module.exports = source;
