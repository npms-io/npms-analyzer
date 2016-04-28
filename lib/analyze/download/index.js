'use strict';

const os = require('os');
const downloaders = require('require-directory')(module);
const exec = require('../util/exec');

const downloadersOrder = [
    (packageJson, options) => downloaders.github(packageJson,
        { tokens: options.githubTokens, refOverrides: options.gitRefOverrides, waitRateLimit: options.waitRateLimit }),
    (packageJson, options) => downloaders.git(packageJson, { refOverrides: options.gitRefOverrides }),
    (packageJson) => downloaders.npm(packageJson),
];

/**
 * Creates a temporary folder for a module to be downloaded to.
 *
 * @param {string} name The module name
 *
 * @return {Promise} The promise that resolves with the temporary folder path
 */
function createTmpDir(name) {
    // Suffix the folder with a random string to make it more unique
    // This solves concurrency and case sensitive issues
    const naiveRandomStr = Math.random().toString(36).slice(2);
    const dir = `${os.tmpdir()}/npms-analyzer/${name}-${naiveRandomStr}`;

    return exec(exec.escape`rm -rf ${dir}`)
    .then(() => exec(exec.escape`mkdir -p ${dir}`))
    .then(() => dir);
}

/**
 * Cleans old modules from the temporary folder.
 *
 * @return {Promise} The promise that resolves when odne
 */
function cleanTmpDir() {
    const dir = `${os.tmpdir()}/npms-analyzer/*`;

    return exec(exec.escape`find ${dir} -maxdepth 1 -type d -mtime +1 -print0 | xargs -0 rm -rf`);
}

// -------------------------------------------------------------

/**
 * Downloads a module into a temporary folder.
 *
 * @param {object} packageJson The module package.json
 * @param {object} [options]   The options; read bellow to get to know each available option
 *
 * @return {Promise} A promise that resolves with the temporary folder
 */
function download(packageJson, options) {
    let downloadFn;

    options = Object.assign({
        githubTokens: null,    // The GitHub API tokens to use
        gitRefOverrides: null, // An hash of ref overrides to be used
        waitRateLimit: false,  // True to wait if rate limit for all tokens were exceeded
    }, options);

    downloadersOrder.some((downloader) => {
        downloadFn = downloader(packageJson, options);
        return !!downloadFn;
    });

    if (!downloadFn) {
        return Promise.reject(Object.assign(new Error(`Could not find suitable downloader for ${packageJson.name}`),
            { unrecoverable: false }));
    }

    // Create temporary directory
    return createTmpDir(packageJson.name)
    // Download the module into the temporary directory
    .tap((tmpDir) => {
        return downloadFn(tmpDir)
        // Cleanup the directory if download failed
        .catch((err) => {
            return exec(exec.escape`rm -rf ${tmpDir}`)
            .finally(() => { throw err; });
        });
    });
}

module.exports = download;
module.exports.cleanTmpDir = cleanTmpDir;
