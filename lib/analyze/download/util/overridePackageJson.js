'use strict';

const writeFile = Promise.promisify(require('fs').writeFile);
const loadJsonFile = require('load-json-file');
const normalizePackageJson = require('../../util/normalizePackageJson');

/**
 * Overrides the downloaded package.json file.
 *
 * The published package.json has higher priority than the one downloaded from the source code since it's more exact.
 * It also solves problems with broken package.json files that a lot of people put into source-control.
 *
 * @param {object} packageJson The package.json from the registry
 * @param {string} tmpDir      The temporary folder in which the module was downloaded
 * @param {object} [options]   The options; read bellow to get to know each available option
 *
 * @return {Promise} A promise that resolves with a boolean (true if it was overridden, false otherwise)
 */
function overridePackageJson(packageJson, tmpDir, options) {
    options = Object.assign({
        onlyIfBroken: false,  // True to only override if the downloaded package.json is broken; the downloaded package.json will get
                              // its properties merged with the published package.json
    }, options);

    const target = `${tmpDir}/package.json`;

    return Promise.try(() => {
        if (!options.onlyIfBroken) {
            return true;
        }

        return loadJsonFile(target)
        .then((json) => Object.assign(packageJson, normalizePackageJson(json)))  // Merge properties
        .then(() => false, () => true);
    })
    .tap((override) => {
        return override && writeFile(target, JSON.stringify(packageJson, null, 2));
    });
}

module.exports = overridePackageJson;
