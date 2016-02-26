'use strict';

const os = require('os');
const Promise = require('bluebird');
const mkdirp = Promise.promisify(require('mkdirp'));
const rimraf = Promise.promisify(require('rimraf'));
const writeFile = Promise.promisify(require('fs').writeFile);
const downloaders = require('require-directory')(module);

const downloadersOrder = [
    (packageJson, options) => downloaders.github(packageJson,
        { tokens: options.githubTokens, waitRateLimit: options.waitRateLimit }),
    (packageJson) => downloaders.git(packageJson),
    (packageJson) => downloaders.npm(packageJson),
];

function createTmpDir(name) {
    // Suffix the folder with a random string to make it more unique
    // This solves concurrency and case sensitive issues
    const naiveRandomStr = Math.random().toString(36).slice(2);
    const dir = `${os.tmpdir()}/npms-analyzer/${name}-${naiveRandomStr}`;

    return rimraf(dir)
    .then(() => mkdirp(dir))
    .then(() => dir);
}

function writePackageJson(packageJson, tmpDir) {
    return Promise.try(() => JSON.stringify(packageJson, null, 2))
    .then((json) => writeFile(`${tmpDir}/package.json`, json));
}

// -------------------------------------------------------------

function download(packageJson, options) {
    let downloadFn;

    downloadersOrder.some((downloader) => {
        downloadFn = downloader(packageJson, options);
        return !!downloadFn;
    });

    if (!downloadFn) {
        return Promise.reject(new Error(`Could not find suitable downloader for ${packageJson.name}`));
    }

    // Create temporary directory
    return createTmpDir(packageJson.name)
    // Download the module into the temporary directory
    .tap((tmpDir) => {
        return downloadFn(tmpDir)
        // Ensure/overwrite the package.json (we want to use the stored package json because its more exact)
        .then(() => writePackageJson(packageJson, tmpDir))
        // Cleanup the directory if download failed
        .catch((err) => {
            return rimraf(tmpDir)
            .finally(() => { throw err; });
        });
    });
}

module.exports = download;
