'use strict';

const writeFile = Promise.promisify(require('fs').writeFile);
const loadJsonFile = require('load-json-file');
const assignWith = require('lodash/assignWith');
const notEmpty = require('deep-compact').notEmpty;
const normalizePackageJson = require('../../util/normalizePackageJson');

const log = logger.child({ module: 'util/merge-package-json' });

/**
 * Merges the package json with the downloaded one.
 *
 * The published package.json has higher priority than the one downloaded from the source code since it's more exact.
 * Though, some packages have pre-publish scripts that mutate the package.json hiding important stuff: One good example is
 * `bower`, which bundles dependencies in the package itself to speed up installation.
 *
 * The passed in `packageJson` will be mutated and it will be written out to the downloaded folder, overwriting the downloaded one.
 * The promise will be resolved with the original downloaded package json.
 *
 * @param {Object} packageJson - The package.json from the registry.
 * @param {String} packageDir  - The temporary folder in which the package was downloaded.
 *
 * @returns {Promise} A promise that resolves with the downloaded package json.
 */
function mergePackageJson(packageJson, packageDir) {
    const file = `${packageDir}/package.json`;

    // Read json file & normalize it
    return loadJsonFile(file)
    .then((downloadedPackageJson) => normalizePackageJson(downloadedPackageJson))
    // Ignore any errors
    .catch((err) => {
        log.warn({ err, file }, 'Error reading downloaded package.json');

        return {};
    })
    // Merge
    .tap((downloadedPackageJson) => {
        assignWith(packageJson, downloadedPackageJson,
            (objValue, srcValue, key, obj) => notEmpty(objValue, key, obj) ? objValue : srcValue);
    })
    // Write to disk
    .tap(() => writeFile(file, JSON.stringify(packageJson, null, 2)));
}

module.exports = mergePackageJson;
