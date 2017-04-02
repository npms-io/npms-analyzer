'use strict';

const normalizePackageData = require('normalize-package-data');

const log = logger.child({ module: 'util/normalize-package-json' });

/**
 * Normalizes a package.json.
 *
 * Wrapper around normalize-package-data module that handles extra stuff, see code below.
 *
 * @param {object} packageJson The package package.json
 *
 * @return {object} The normalized package.json
 */
function normalizePackageJson(packageJson) {
    // Some packages error out while being normalized, for instance, when they contain malformed
    // URIs in the repository.url (e.g.: `sails-sparql@0.10.0`)
    try {
        normalizePackageData(packageJson);
    } catch (err) {
        log.warn({ err, packageJson }, `Error normalizing ${packageJson.name} package.json`);
        err.unrecoverable = true;
        throw err;
    }

    // Remove duplicate .git.git until it gets fixed on normalize-package-data
    // See: https://github.com/npm/normalize-package-data/issues/84
    if (packageJson.repository && packageJson.repository.url) {
        packageJson.repository.url = packageJson.repository.url.replace(/\.git\.git$/i, '.git');
    }

    return packageJson;
}

module.exports = normalizePackageJson;
