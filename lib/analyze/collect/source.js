'use strict';

const path = require('path');
const detectRepoLinters = require('detect-repo-linters');
const detectRepoTestFiles = require('detect-repo-test-files');
const detectReadmeBadges = require('detect-readme-badges');
const detectRepoChangelog = require('detect-repo-changelog');
const fetchCoverage = require('fetch-coverage');
const loadJsonFile = require('load-json-file');
const readFile = Promise.promisify(require('fs').readFile);
const deepCompact = require('deep-compact');
const isRegularFile = require('is-regular-file');
const got = require('got');
const fileSize = require('./util/fileSize');
const promisePropsSettled = require('./util/promisePropsSettled');
const exec = require('../util/exec');
const gotRetry = require('../util/gotRetry');

const davidBin = path.normalize(`${__dirname}/bin/david-json`);
const log = logger.child({ module: 'collect/source' });

/**
 * Inspects important files, such as the tests and README file sizes.
 *
 * @param {Object} data - The package data.
 * @param {Object} downloaded - The downloaded info (`dir`, `packageDir`, ...).
 *
 * @returns {Promise} The promise for the inspection result.
 */
function inspectFiles(data, downloaded) {
    // Readme must be located in the package dir
    const readmeSize = data.readmeFilename ? fileSize(`${downloaded.packageDir}/${data.readmeFilename}`) : 0;
    // Prefer tests located in the package dir and fallback to the root
    const testsSize = (
        detectRepoTestFiles(downloaded.packageDir)
        .then((files) => !files.length && downloaded.dir !== downloaded.packageDir ? detectRepoTestFiles(downloaded.dir) : files)
        .then((files) => fileSize(files))
    );
    // .npmignore must be located inside the package dir
    // TODO: Improve npmignore detection because it can be in sub-directories too
    const hasNpmIgnore = isRegularFile(`${downloaded.packageDir}/.npmignore`).then((is) => is || null);
    // npm-shrinkwrap must be located inside the package dir
    const hasShrinkwrap = isRegularFile(`${downloaded.packageDir}/npm-shrinkwrap.json`).then((is) => is || null);
    // Usually changelogs are at the root directory, still we prefer the package dir one if it exists
    const hasChangelog = detectRepoChangelog(downloaded.packageDir)
    .then((file) => !file && downloaded.dir !== downloaded.packageDir ? detectRepoChangelog(downloaded.dir) : file)
    .then((file) => file ? true : null);

    return Promise.props({
        readmeSize,
        testsSize,
        hasNpmIgnore,
        hasShrinkwrap,
        hasChangelog,
    });
}

/**
 * Gets the readme badges.

 * @param {Object} data - The package data.
 * @param {Object} downloaded - The downloaded info (`dir`, `packageDir`, ...).
 *
 * @returns {Promise} The promise for the badges result.
 */
function getReadmeBadges(data, downloaded) {
    // Prefer README badges from the package dir but usually badges are at the root README
    // Need to use typeof because there's some old packages in which the README is an object, e.g.: `flatsite`
    return Promise.try(() => typeof data.readme === 'string' ? detectReadmeBadges(data.readme) : [])
    .then((badges) => {
        if (!badges.length && downloaded.dir !== downloaded.packageDir && data.readmeFilename) {
            return readFile(`${downloaded.dir}/${data.readmeFilename}`)
            .then((readme) => detectReadmeBadges(readme.toString()))
            // Ignore if file does not exist or is actually a directory
            .catch({ code: 'ENOENT' }, () => [])
            .catch({ code: 'EISDIR' }, () => []);
        }

        return badges;
    });
}

/**
 * Gets the repository linters.
 *
 * @param {Object} downloaded  - The downloaded info (`dir`, `packageDir`, ...).
 *
 * @returns {Promise} The promise for the linters result.
 */
function getRepoLinters(downloaded) {
    // Linters usually are at the root but prefer the ones within the package just in case..
    return detectRepoLinters(downloaded.packageDir)
    .then((linters) => {
        if (linters.length || downloaded.dir === downloaded.packageDir) {
            return linters;
        }

        return detectRepoLinters(downloaded.dir)
        // A JSON error might occur if `detect-repo-linters`fails to parse `package.json` as JSON
        // Since the `package.json` at the root was not validated, it can have errors
        // If that's the case, we want to skip them here
        .catch({ name: 'JSONError' }, () => {
            log.warn({ dir: downloaded.dir }, 'Error reading downloaded package.json when scanning for linters');

            return [];
        });
    });
}

/**
 * Fetches the code coverage.
 *
 * @param {Object} packageJson - The latest package.json data (normalized).
 * @param {Array}  badges      - The badges detected by the detect-readme-badges package to speed up the process.
 *
 * @returns {Promise} The promise for the code coverage, a number from 0 to 1.
 */
function fetchCodeCoverage(packageJson, badges) {
    const repository = packageJson.repository;

    if (!repository) {
        return Promise.resolve();
    }

    return fetchCoverage(repository.url, {
        badges,
        got: { retry: gotRetry },
    })
    .catch((err) => {
        const name = packageJson.name;

        /* istanbul ignore next */
        if (err.errors) {
            err.errors.forEach((err, index) => log.warn({ err }, `Error #${index} while fetching ${name} code coverage of`));
        }

        /* istanbul ignore next  */
        log.error({ err }, `Failed to fetch ${name} code coverage`);
        /* istanbul ignore next */
        throw err;
    });
}

/**
 * Checks the package looking for known vulnerabilities.
 * Uses https://github.com/nodesecurity/nsp under the hood.
 *
 * @param {Object} packageJson - The latest package.json data (normalized).
 *
 * @returns {Promise} The promise for the vulnerabilities or false if package is totally broken.
 */
function checkVulnerabilities(packageJson) {
    const url = 'https://registry.npmjs.org/-/npm/v1/security/advisories/search';

    return got(url, {
        json: true,
        retry: gotRetry,
        query: {
            module: packageJson.name,
            version: packageJson.version,
        },
    })
    .then((res) => res.body.objects)
    .map((vulnerability) => ({
        id: vulnerability.id,
        title: vulnerability.title,
        overview: vulnerability.overview,
        recommendation: vulnerability.recommendation,
        createdAt: vulnerability.created,
        updatedAt: vulnerability.updated,
        severity: vulnerability.severity,
        module: vulnerability.module_name,
        vulnerableVersions: vulnerability.vulnerable_versions,
        patchedVersions: vulnerability.patched_versions,
        advisory: vulnerability.url,
    }))
    .catch({ statusCode: 404 }, () => {
        log.warn({ url }, `The npm security API returned 404 when fetching ${packageJson.name}@${packageJson.version} vulnerabilities`);

        return [];
    })
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err }, `Failed to scan ${packageJson.name}@${packageJson.version} vulnerabilities`);
        /* istanbul ignore next */
        throw err;
    });
}

/**
 * Checks the package dependencies looking for outdated versions.
 * Uses https://github.com/alanshaw/david under the hood, the package that powers https://david-dm.org/.
 *
 * @param {String} name    - The package name.
 * @param {String} dir     - The package directory.
 * @param {Object} options - The options inferred from source() options.
 *
 * @returns {Promise} The promise for the outdated dependencies, indexed by name or false if deps are totally broken.
 */
function checkOutdatedDeps(name, dir, options) {
    const jsonFile = `${dir}/.npms-david.json`;

    // Need to pipe stdout to a file due to a NodeJS bug where the output was being truncated
    // See: https://github.com/nodejs/node/issues/784
    // We also run a binary wrapper around the david package because it had memory leaks, causing the memory of this
    // process to grow over time
    return exec(exec.escape`${davidBin} --registry ${options.npmRegistry} > ${jsonFile}`, {
        cwd: dir,
        timeout: 60 * 1000,
    })
    .then(() => loadJsonFile(jsonFile))
    // Ignore broken deps (e.g.: ccbuild@1.8.1)
    .catch((err) => /failed to get versions/i.test(err.stderr), (err) => {
        log.warn({ err }, `Some of ${name} dependencies are broken, skipping check outdated..`);

        return false;
    })
    // Ignore broken package data (e.g.: gqformemail)
    .catch((err) => /versions.sort is not a function/i.test(err.stderr), (err) => {
        log.warn({ err }, `The package data of ${name} is broken, skipping check outdated..`);

        return false;
    })
    // Ignore broken package name (e.g.: @~lisfan/vue-image-placeholder)
    .catch((err) => /\[ERR_ASSERTION\]/i.test(err.stderr), (err) => {
        log.warn({ err }, `The package data of ${name} is broken (probably the name), skipping check outdated..`);

        return false;
    })
    // Many packages have a `.npmrc` with a custom registry that require authentication
    // Those packages are broken, in the sense that they can't be installed by the outside world (e.g.: webhint-hint-chisel)
    .catch((err) => /requires auth credentials/i.test(err.message), (err) => {
        err.unrecoverable = true;
        throw err;
    })
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err }, `Failed to check outdated dependencies of ${name}`);
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
 * @param {String} data        - The package data.
 * @param {Object} packageJson - The latest package.json data (normalized).
 * @param {Object} downloaded  - The downloaded info (`dir`, `packageJson`, ...).
 * @param {Object} [options]   - The options; read below to get to know each available option.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function source(data, packageJson, downloaded, options) {
    options = Object.assign({
        npmRegistry: 'https://registry.npmjs.org', // The registry url to be used
    }, options);

    // Analyze source first because the external cli tools add files to the directory
    return Promise.try(() => (
        promisePropsSettled({
            files: inspectFiles(data, downloaded),
            badges: getReadmeBadges(data, downloaded),
            linters: getRepoLinters(downloaded),
        })
        .tap((props) =>
            // Only now we got badges..
            fetchCodeCoverage(packageJson, props.badges)
            .then((coverage) => { props.coverage = coverage; })
        )
    ))
    // Finally use external cli tools
    .then((props) => (
        promisePropsSettled({
            outdatedDependencies: checkOutdatedDeps(packageJson.name, downloaded.packageDir, options),
            vulnerabilities: checkVulnerabilities(packageJson),
        })
        .then((props_) => Object.assign(props, props_))
    ))
    .then((result) => deepCompact(result))
    .tap(() => log.debug(`The source collector for ${packageJson.name} completed successfully`));
}

module.exports = source;
