'use strict';

const log = require('npmlog');
const normalizePackageJson = require('./normalizePackageJson');

const logPrefix = 'util/package-json-from-data';

/**
 * Grab the latest package.json from the module data, normalizing it.
 *
 * @param {string} name The module name
 * @param {object} data The module data
 *
 * @return {object} The normalized package.json
 */
function packageJsonFromData(name, data) {
    const version = (data['dist-tags'] && data['dist-tags'].latest) || '0.0.1';
    let packageJson = data.versions && data.versions[version];

    // Some modules in npm are corrupt and don't have a latest version, e.g.: `node-gr`
    if (!packageJson) {
        log.warn(logPrefix, `No latest version information for ${name}, mocking package.json..`);
        packageJson = { name: data.name, version };
    }

    // Fail if the names mismatch
    if (data.name !== name) {
        throw Object.assign(new Error(`Module name mismatch detected in ${name}`),
            { name, dataName: data.name, unrecoverable: true });
    }

    // Check if the version is correct
    if (packageJson.version !== version) {
        log.warn(logPrefix, `Version mismatch for ${name}, fixing it..`);
        packageJson.version = version;
    }

    return normalizePackageJson(name, packageJson);
}

module.exports = packageJsonFromData;
