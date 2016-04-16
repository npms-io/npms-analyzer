'use strict';

const writeFile = Promise.promisify(require('fs').writeFile);
const loadJsonFile = require('load-json-file');
const assignWith = require('lodash/assignWith');
const normalizePackageJson = require('../../util/normalizePackageJson');

/**
 * Merges the package json with the downloaded one.
 *
 * The published package.json has higher priority than the one downloaded from the source code since it's more exact.
 * It also solves problems with broken package.json files that a lot of people put into source-control.
 *
 * @param {object} packageJson The package.json from the registry
 * @param {string} tmpDir      The temporary folder in which the module was downloaded
 * @param {object} [options]   The options; read bellow to get to know each available option
 *
 * @return {Promise} A promise that resolves with the merged package json
 */
function mergePackageJson(packageJson, tmpDir, options) {
    options = Object.assign({
        preferDownloaded: false,  // True to prefer the downloaded package json over the npm one
    }, options);

    const target = `${tmpDir}/package.json`;

    return loadJsonFile(target)
    .tap((json) => normalizePackageJson(json))
    .catch(() => { return {}; })
    .then((json) => {
        if (!options.preferDownloaded) {
            assignWith(packageJson, json, (objValue, srcValue) => objValue === undefined ? srcValue : objValue);
        } else {
            Object.assign(packageJson, json);
        }
    })
    .then(() => {
        return writeFile(target, JSON.stringify(packageJson, null, 2));
    })
    .return(packageJson);
}

module.exports = mergePackageJson;
