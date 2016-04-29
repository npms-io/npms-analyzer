'use strict';

const log = require('npmlog');
const normalizePackageData = require('normalize-package-data');
const hostedGitInfo = require('./hostedGitInfo');

const logPrefix = 'util/normalize-package-json';

/**
 * Normalizes a package.json.
 *
 * @param {string} name        The module name
 * @param {object} packageJson The module package.json
 *
 * @return {object} The normalized package.json
 */
function normalizePackageJson(name, packageJson) {
    // Check if there's no name (e.g.: 6to5-runtime)
    if (!packageJson.name) {
        log.warn(logPrefix, `No name present in ${name} package.json, overwriting it..`);
        packageJson.name = name;
    // Check if the names mismatch
    } else if (packageJson.name !== name) {
        log.info(logPrefix, `Module name mismatch detected in ${name}, overwriting it..`, { name, packageJsonName: packageJson.name });
        packageJson.name = name;
    }

    // Some modules in npm are corrupt and don't have a version defined, e.g.: `kevoree-utils`
    if (!packageJson.version) {
        log.warn(logPrefix, `No version for ${name}, mocking it..`, { packageJson });
        packageJson.version = '0.0.1';
    }

    // Some packages error out while being normalized, for instance, when they contain malformed
    // URIs in the repository.url (e.g.: `sails-sparql@0.10.0`)
    try {
        normalizePackageData(packageJson);
    } catch (err) {
        log.warn(logPrefix, `Error normalizing ${name} package.json`, { err, packageJson });
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

module.exports = normalizePackageJson;
