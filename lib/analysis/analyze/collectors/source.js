'use strict';

const Promise = require('bluebird');
const path = require('path');
const exec = Promise.promisify(require('child_process').exec, { multiArgs: true });
const glob = Promise.promisify(require('glob'));
const david = Promise.promisifyAll(require('david'));
const fileSize = Promise.promisify(require('get-folder-size'));
const detectRepoLinters = require('detect-repo-linters');
const detectReadmeBadges = require('detect-readme-badges');
const deepCompact = require('deep-compact');
const got = require('got');
const log = require('npmlog');
const pickBy = require('lodash/pickBy');
const find = require('lodash/find');
const assign = require('lodash/assign');
const isFile = require('./util/isFile');

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
    .map((path) => fileSize(path))
    .reduce((sum, size) => sum + size, 0);

    return Promise.props({
        gitignore: isFile(`${dir}/.gitignore`),
        npmignore: isFile(`${dir}/.npmignore`),
        gitattributes: isFile(`${dir}/.gitattributes`),
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
        log.error('source', `Failed to scan ${name} repository linters`, { err, dir });
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
    return exec(`${nspBin} check --output json --warn-only`, { cwd: dir, timeout: 60 * 1000 })
    .spread((stdout) => JSON.parse(stdout))
    .catch((err) => {
        log.error('source', `Failed to ${name} scan dependencies vulnerabilities`, { err, dir });
        throw err;
    });
}

/**
 * Checks the module dependencies looking for outdated versions.
 * Uses https://github.com/alanshaw/davidunder the hood, the module that powers https://david-dm.org/.
 *
 * @param {string} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} options     The options inferred from the source() options
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

            log.warn('source', `Filtered ${name}@${dep.required} from outdated dependencies analysis due to an error`,
                { err: dep.warn, name: data.name });
        });
    }, (err) => {
        log.error('source', `Failed to check outdated dependencies of ${data.name}`, { err, name: data.name });
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
        retries: 0,
        json: true,
        timeout: 15000,
    })
    .then((response) => {
        const json = response.body;
        const match = (json.value || '').match(/^(\d+)%$/);

        if (!match) {
            log.error('source', 'Could not get coverage % from JSON response', { json });
            return null;
        }

        return Number(match[1]) / 100;
    }, (err) => {
        log.error('source', `Failed to get coverage %, request to ${url} failed`, { url });
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
    options = assign({
        npmRegistry: 'https://registry.npmjs.org',  // The registry url to be used
    }, options);

    const badges = data.readme && detectReadmeBadges(data.readme);

    return Promise.props({
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
