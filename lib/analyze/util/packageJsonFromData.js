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

    return normalizePackageJson(packageJson);
}

module.exports = packageJsonFromData;
