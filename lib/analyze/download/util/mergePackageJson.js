'use strict';

const writeFile = Promise.promisify(require('fs').writeFile);
const loadJsonFile = require('load-json-file');
const assignWith = require('lodash/assignWith');
const normalizePackageJson = require('../../util/normalizePackageJson');

/**
 * Merges the package json with the downloaded one.
 *
 * The published package.json has higher priority than the one downloaded from the source code since it's more exact.
 * Though, some packages have pre-publish scripts that mutate the package.json hiding important stuff: one good example is
 * `bower`, which bundles dependencies in the package itself to speed up installation.
 *
 * The passed in `packageJson` will be mutated and it will be written out to the downloaded folder, overwriting the downloaded one.
 * The promise will be resolved with the original downloaded package json.
 *
 * @param {object} packageJson The package.json from the registry
 * @param {string} tmpDir      The temporary folder in which the package was downloaded
 *
 * @return {Promise} A promise that resolves with the downloaded package json
 */
function mergePackageJson(packageJson, tmpDir) {
    const target = `${tmpDir}/package.json`;

    // Read & normalize, ignoring any errors
    return loadJsonFile(target)
    .then((downloadedPackageJson) => normalizePackageJson(downloadedPackageJson))
    .catch(() => ({}))
    // Merge
    .tap((downloadedPackageJson) => {
        assignWith(packageJson, downloadedPackageJson, (objValue, srcValue) => objValue === undefined ? srcValue : objValue);
    })
    // Write to disk
    .tap(() => writeFile(target, JSON.stringify(packageJson, null, 2)));
}

module.exports = mergePackageJson;
