'use strict';

const normalizePackageData = require('normalize-package-data');

const log = logger.child({ module: 'util/normalize-package-json' });

/**
 * Normalizes a package.json.
 *
 * @param {string} name        The package name
 * @param {object} packageJson The package package.json
 * @param {object} [options]   The options; read below to get to know each available option
 *
 * @return {object} The normalized package.json
 */
function normalizePackageJson(name, packageJson, options) {
    options = Object.assign({ checkName: true }, options);

    // Check if there's no name (e.g.: 6to5-runtime)
    if (options.checkName) {
        if (!packageJson.name) {
            log.warn(`No name present in ${name} package.json, overwriting it..`);
            packageJson.name = name;
        // Check if the names mismatch
        } else if (packageJson.name !== name) {
            log.info({ name, packageJsonName: packageJson.name }, `Package name mismatch detected in ${name}, overwriting it..`);
            packageJson.name = name;
        }
    }

    // Some packages in npm are corrupt and don't have a version defined, e.g.: `kevoree-utils`
    if (!packageJson.version) {
        log.warn({ packageJson }, `No version for ${name}, mocking it..`);
        packageJson.version = '0.0.1';
    }

    // Some packages error out while being normalized, for instance, when they contain malformed
    // URIs in the repository.url (e.g.: `sails-sparql@0.10.0`)
    try {
        normalizePackageData(packageJson);
    } catch (err) {
        log.warn({ err, packageJson }, `Error normalizing ${name} package.json`);
        err.unrecoverable = true;
        throw err;
    }

    // Remove duplicate .git.git until it gets fixed on normalize-package-data
    // See: https://github.com/npm/normalize-package-data/issues/84
    if (packageJson.repository) {
        packageJson.repository.url = packageJson.repository.url ? packageJson.repository.url.replace(/\.git\.git$/i, '.git') : packageJson.repository.url;
    }

    return packageJson;
}

module.exports = normalizePackageJson;
