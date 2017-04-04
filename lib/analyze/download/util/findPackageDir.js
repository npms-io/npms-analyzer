'use strict';

const path = require('path');
const loadJsonFile = require('load-json-file');
const glob = Promise.promisify(require('glob'));

/**
 * Searches for the real package dir after testing against the root one fails.
 *
 * @param {object} packageJson The package.json from the registry
 * @param {string} dir The folder in which the package was downloaded
 *
 * @return {Promise} A promise that resolves with the package dir or null
 */
function lookForPackageDir(packageJson, dir) {
    // Gather all package json files
    return glob('**/package.json', {
        cwd: dir,
        silent: true,   // Do not print warnings
        strict: false,  // Do not crash on the first error
    })
    // Transform them into directories, removing the root one
    .then((files) => {
        return files
        // Filter root one
        .filter((file) => file !== 'package.json')
        // Build dir arrays from matched files
        .map((file) => path.join(dir, path.dirname(file)));
    })
    // Find the one that matches the package
    .reduce((packageDir, possiblePackageDir) => {
        if (packageDir) {
            return packageDir;
        }

        return isSamePackage(packageJson, possiblePackageDir)
        .then((isSame) => isSame ? possiblePackageDir : null);
    }, null);
}

/**
 * Tests if a directory matches the package we are looking for.
 *
 * @param {object} packageJson The package.json from the registry
 * @param {string} dir The folder we are testing against
 *
 * @return {Promise} A promise that resolves with true if it matched, false otherwise
 */
function isSamePackage(packageJson, dir) {
    return loadJsonFile(`${dir}/package.json`)
    .catch(() => ({}))  // Swallow any read errors
    .then((downloadedPackageJson) => packageJson.name === downloadedPackageJson.name);
}

// -----------------------------------------------------

/**
 * Finds the real package directory.
 *
 * If the package.json file at the root matches, the `packageDir` will be the same as `dir`.
 * If not, this function will do a deep search for a package.json that matches.
 *
 * For standard repositories, `packageDir` will be equal to the `dir`.
 * For mono repositories, `packageDir` will be a sub-directory of `dir` pointing to where the package actually is.
 * If we couldn't find the `packageDir`, `dir` will be returned.
 *
 * @param {object} packageJson The package.json from the registry
 * @param {string} dir The folder in which the package was downloaded
 *
 * @return {Promise} A promise that resolves with the package directory
 */
function findPackageDir(packageJson, dir) {
    // Short-circuit to check against the root
    return isSamePackage(packageJson, dir)
    // Find using glob
    .then((isSame) => isSame ? dir : lookForPackageDir(packageJson, dir))
    // Fallback to using the root dir
    .then((packageDir) => packageDir || dir);
}

module.exports = findPackageDir;
