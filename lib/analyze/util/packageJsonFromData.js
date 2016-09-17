'use strict';

const normalizePackageJson = require('./normalizePackageJson');

const log = logger.child({ module: 'util/package-json-from-data' });

/**
 * Grab the latest package.json from the package data, normalizing it.
 *
 * @param {string} name The package name
 * @param {object} data The package data
 *
 * @return {object} The normalized package.json
 */
function packageJsonFromData(name, data) {
    const version = (data['dist-tags'] && data['dist-tags'].latest) || '0.0.1';
    let packageJson = data.versions && data.versions[version];

    // Some packages in npm are corrupt and don't have a latest version, e.g.: `node-gr`
    if (!packageJson) {
        log.warn(`No latest version information for ${name}, mocking package.json..`);
        packageJson = { name: data.name, version };
    }

    // Fail if the names mismatch
    if (data.name !== name) {
        throw Object.assign(new Error(`Package name mismatch detected in ${name}`),
            { name, dataName: data.name, unrecoverable: true });
    }

    // Check if the version is correct
    if (packageJson.version !== version) {
        log.warn(`Version mismatch for ${name}, fixing it..`);
        packageJson.version = version;
    }

    return normalizePackageJson(name, packageJson);
}

module.exports = packageJsonFromData;
