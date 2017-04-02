'use strict';

const path = require('path');
const loadJsonFile = require('load-json-file');
const glob = Promise.promisify(require('glob'));

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

function isSamePackage(packageJson, dir) {
    return loadJsonFile(`${dir}/package.json`)
    .catch(() => ({}))  // Swallow any read errors
    .then((downloadedPackageJson) => packageJson.name === downloadedPackageJson.name);
}

// -----------------------------------------------------

function findPackageDir(packageJson, dir) {
    // Short-circuit to check agains the root
    return isSamePackage(packageJson, dir)
    // Find using glob
    .then((isSame) => isSame ? dir : lookForPackageDir(packageJson, dir))
    // Fallback to using the root dir
    .then((packageDir) => packageDir || dir);
}

module.exports = findPackageDir;
