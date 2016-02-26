'use strict';

const Promise = require('bluebird');
const path = require('path');
const glob = Promise.promisify(require('glob'));
const david = Promise.promisifyAll(require('david'));
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

const logPrefix = 'collect/source';
const nspBin = path.normalize(`${__dirname}/../../../../node_modules/.bin/nsp`);

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
        npmignore: isFile(`${dir}/.npmignore`),
        readmeSize: data.readmeFilename ? fileSize(data.readmeFilename) : 0,
        testsSize,
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
    const jsonFile = `${dir}/.nsp.json`;

    // Need to pipe stdout to a file due to a NodeJS bug where the output was being truncated
    // See: https://github.com/nodejs/node/issues/784
    // Test case: run analyze for Web4.0 module
    return exec(`${nspBin} check --output json --warn-only > ${jsonFile}`, { cwd: dir, timeout: 60 * 1000 })
    .then(() => loadJsonFile(jsonFile))
    .catch((err) => {
        log.error(logPrefix, `Failed to scan ${name} dependencies vulnerabilities`, { err, dir });
        throw err;
    });
}

/**
 * Checks the module dependencies looking for outdated versions.
 * Uses https://github.com/alanshaw/david under the hood, the module that powers https://david-dm.org/.
 *
 * @param {string} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} options     The options inferred from source() options
 *
 * @return {Promise} The promise for the outdated dependencies, indexed by name
 */
function checkOutdatedDeps(data, packageJson, options) {
    return david.getUpdatedDependenciesAsync(packageJson, {
        npm: { registry: options.npmRegistry, 'fetch-retries': 0 },
        loose: true, // Enable loose semver, there's some really strange versions that got into the registry somehow
    })
    .then((deps) => {
        return pickBy(deps, (dep, name) => {
            if (!dep.warn) {
                return true;
            }

            log.warn(logPrefix, `Filtered ${name}@${dep.required} from outdated dependencies analysis due to an error`,
                { err: dep.warn, name: data.name });
        });
    }, (err) => {
        log.error(logPrefix, `Failed to check outdated dependencies of ${data.name}`, { err, name: data.name });
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
    }, (err) => {
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

    const badges = data.readme && detectReadmeBadges(data.readme);

    return promisePropsSettled({
        files: inspectFiles(data, dir),
        repositorySize: fileSize(dir),
        outdatedDependencies: checkOutdatedDeps(data, packageJson, options),
        dependenciesVulnerabilities: checkDepsVulnerabilities(data.name, dir),
        linters: scanRepoLinters(data.name, dir),
        coverage: fetchCoverageUsingBadges(badges),
        badges,
    })
    .then((result) => deepCompact(result));
}

module.exports = source;
