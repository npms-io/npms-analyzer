'use strict';

const normalizePackageData = require('normalize-package-data');

const log = logger.child({ module: 'util/normalize-package-json' });

/**
 * Remove tree/<branch>/<path> from the repository URL.
 *
 * Some developers assume that repository is a simple URL and not a cloneable URL.
 * See: https://github.com/babel/babel/issues/5574
 *
 * @param {string} url The repository URL
 *
 * @return {string} The URL with any path removed
 */
function removePathFromRepositoryUrl(url) {
    const newUrl = url.replace(/(\/[^/.]+\/[^/.]+)\/tree\/.+$/, '$1');

    newUrl !== url && logger.warn({ url, newUrl }, 'Removed path from repository URL');

    return newUrl;
}

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
    // Remove tree/<target> from urls because some devs put branches in the URL
    // See: https://github.com/babel/babel/issues/5574
    if (packageJson.repository) {
        if (typeof packageJson.repository === 'string') {
            packageJson.repository = removePathFromRepositoryUrl(packageJson.repository);
        } else if (typeof packageJson.repository.url === 'string') {
            packageJson.repository.url = removePathFromRepositoryUrl(packageJson.repository.url);
        }
    }

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
