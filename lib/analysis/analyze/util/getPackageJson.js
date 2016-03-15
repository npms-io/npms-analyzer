'use strict';

const log = require('npmlog');
const normalizePackageData = require('normalize-package-data');
const hostedGitInfo = require('./hostedGitInfo');

const logPrefix = 'util/get-package-json';

/**
 * Grab the latest package.json from the module data, normalizing it.
 *
 * @param {string} name The module name
 * @param {object} data The module data
 *
 * @return {object} The normalized package.json
 */
function getPackageJson(name, data) {
    let packageJson = data.versions[data['dist-tags'].latest];

    // Some modules in npm are corrupt and don't have a latest version, e.g.: node-gr
    if (!packageJson) {
        log.warn(logPrefix, `No latest version information for ${data.name}, mocking package.json..`);
        packageJson = { name: data.name, version: '0.0.1' };
    }

    // Check if the names are correct
    if (packageJson.name !== data.name || packageJson.name !== name) {
        throw Object.assign(new Error('Module name mismatch'),
            { name, dataName: data.name, packageJsonName: packageJson.name, unrecoverable: true });
    }

    // Some modules in npm are corrupt and don't have a version defined, e.g.: kevoree-utils
    if (!packageJson.version) {
        log.warn(logPrefix, `No version for ${data.name}, mocking version in package.json..`);
        packageJson.version = '0.0.1';
    }

    // Some packages error out while being normalized, for instance, when they contain malformed
    // URIs in the repository.url
    // e.g.: sails-sparql@0.10.0
    try {
        normalizePackageData(packageJson);
    } catch (err) {
        log.warn(logPrefix, `Error while normalizing ${data.name} package.json, mocking it..`, { err });
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

module.exports = getPackageJson;
