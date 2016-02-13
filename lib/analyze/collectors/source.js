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

const nspBin = path.normalize(`${__dirname}/../../../node_modules/.bin/nsp`);

function checkFiles(data, dir) {
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

function scanRepoLinters(name, dir) {
    return detectRepoLinters(dir)
    .catch((err) => {
        log.error('source', `Failed to scan ${name} repository linters`, { err, dir });
        throw err;
    });
}

function checkDepsVulnerabilities(name, dir) {
    return exec(`${nspBin} check --output json --warn-only`, { cwd: dir, timeout: 60 * 1000 })
    .spread((stdout) => JSON.parse(stdout))
    .catch((err) => {
        log.error('source', `Failed to ${name} scan dependencies vulnerabilities`, { err, dir });
        throw err;
    });
}

function checkOutdatedDeps(data, packageJson, options) {
    return david.getUpdatedDependenciesAsync(packageJson, {
        npm: { registry: options.npmRegistry || 'https://registry.npmjs.org/', 'fetch-retries': 0 },
        error: { E404: true },
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

function fetchCoverageUsingBadges(badges) {
    const coverageBadge = find(badges || [], (badge) => badge.info.type === 'coverage');
    const contentUrl = coverageBadge && coverageBadge.urls.content;

    if (!contentUrl) {
        return Promise.resolve(null);
    }

    return got(contentUrl, {
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
    });
}

// code insight
    // badges
    // checks (readme size, tests size, gitignore, npmignore, gitattributes) [done]
    // linters [done]
    // filesize [done]
    // complexity https://www.npmjs.com/package/escomplex
    // coverage
// outdated dependencies [done]
// technical debt (todos, fixme's)
// security insight with node security project [done]

function source(data, packageJson, dir, options) {
    options = assign({
        npmRegistry: null,
    }, options);

    return Promise.props({
        files: checkFiles(data, dir),
        repositorySize: fileSize(dir),
        outdatedDependencies: checkOutdatedDeps(data, packageJson, options),
        vulnerabilities: checkDepsVulnerabilities(data.name, dir),
        linters: scanRepoLinters(data.name, dir),
        badges: data.readme && detectReadmeBadges(data.readme),
    })
    /*.tap((result) => {
        return fetchCoverageUsingBadges(result.badges)
        .then((coverage) => { result.coverage = coverage; });
    })*/
    .then((result) => deepCompact(result));
}

module.exports = source;
