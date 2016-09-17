'use strict';

const writeFile = Promise.promisify(require('fs').writeFile);
const loadJsonFile = require('load-json-file');
const assignWith = require('lodash/assignWith');
const omit = require('lodash/omit');
const normalizePackageJson = require('../../util/normalizePackageJson');

/**
 * Merges the package json with the downloaded one.
 *
 * The published package.json has higher priority than the one downloaded from the source code since it's more exact.
 * It also solves problems with broken package.json files that a lot of people put into source-control.
 *
 * The passed in `packageJson` will be mutated and it will be written out to the downloaded folder, overwriting the downloaded one.
 * The promise will be resolved with the original downloaded package json.
 *
 * @param {object} packageJson The package.json from the registry
 * @param {string} tmpDir      The temporary folder in which the package was downloaded
 * @param {object} [options]   The options; read below to get to know each available option
 *
 * @return {Promise} A promise that resolves with the downloaded package json
 */
function mergePackageJson(packageJson, tmpDir, options) {
    options = Object.assign({
        preferDownloaded: false,  // True to prefer the downloaded package.json over the npm one (except name property)
    }, options);

    const target = `${tmpDir}/package.json`;

    return loadJsonFile(target)
    .then((downloadedPackageJson) => normalizePackageJson(packageJson.name, downloadedPackageJson, { checkName: false }))
    .catch(() => ({}))
    .tap((downloadedPackageJson) => {
        if (!options.preferDownloaded) {
            assignWith(packageJson, downloadedPackageJson, (objValue, srcValue) => objValue === undefined ? srcValue : objValue);
        } else {
            Object.assign(packageJson, omit(downloadedPackageJson, 'name'));
        }

        return writeFile(target, JSON.stringify(packageJson, null, 2));
    });
}

module.exports = mergePackageJson;
