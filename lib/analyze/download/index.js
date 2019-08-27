'use strict';

const os = require('os');
const stat = Promise.promisify(require('fs').stat);
const downloaders = require('require-directory')(module, './', { recurse: false });
const kebabCase = require('lodash/kebabCase');
const exec = require('../util/exec');

const downloadersOrder = [
    (packageJson) => downloaders.npm(packageJson),
    (packageJson) => downloaders.git(packageJson),
    // this used to be at the top, but we get ratelimited too often by github
    (packageJson, options) => downloaders.github(packageJson, { tokens: options.githubTokens, waitRateLimit: options.waitRateLimit }),
];

/**
 * Generates a random string.
 * This is a very fast but naive algorithm.
 *
 * @returns {String} The random string.
 */
function getRandomStr() {
    return Math.random()
    .toString(36)
    .slice(2);
}

/**
 * Creates a temporary folder for a package to be downloaded to.
 *
 * @param {String} name - The package name.
 *
 * @returns {Promise} The promise that resolves with the temporary folder path.
 */
function createTmpDir(name) {
    // Suffix the folder with a random string to make it more unique
    // Additionally, transform any special chars such as `/` to avoid having recursive directories
    const dir = `${os.tmpdir()}/npms-analyzer/${kebabCase(name)}-${getRandomStr()}`;

    return exec(exec.escape`rm -rf ${dir}`)
    .then(() => exec(exec.escape`mkdir -p ${dir}`))
    .then(() => dir);
}

/**
 * Cleans old packages from the temporary folder.
 *
 * @returns {Promise} The promise that resolves when odne.
 */
function cleanTmpDir() {
    const dir = `${os.tmpdir()}/npms-analyzer`;

    return stat(dir)
    .catch({ code: 'ENOENT' }, () => false)
    .return(true)
    .then((exists) => exists && exec(exec.escape`find ${dir} -mindepth 1 -maxdepth 1 -type d -mtime +1 -print0 | xargs -0 rm -rf`));
}

// -------------------------------------------------------------

/**
 * Downloads a package into a temporary folder.
 *
 * @param {Object} packageJson - The latest package.json data (normalized).
 * @param {Object} [options]   - The options; read below to get to know each available option.
 *
 * @returns {Promise} A promise that resolves with the downloaded info (`dir`, `packageJson`, ...).
 */
function download(packageJson, options) {
    let downloadFn;

    options = Object.assign({
        githubTokens: null, // The GitHub API tokens to use
        waitRateLimit: false, // True to wait if rate limit for all tokens were exceeded
    }, options);

    downloadersOrder.some((downloader) => {
        downloadFn = downloader(packageJson, options);

        return !!downloadFn;
    });

    /* istanbul ignore if */
    if (!downloadFn) {
        return Promise.reject(Object.assign(new Error(`Could not find suitable downloader for ${packageJson.name}`),
            { unrecoverable: false }));
    }

    // Create temporary directory
    return createTmpDir(packageJson.name)
    // Download the package into the temporary directory
    .then((tmpDir) => (
        downloadFn(tmpDir)
        // Cleanup the directory if download failed
        .catch((err) => (
            exec(exec.escape`rm -rf ${tmpDir}`)
            .finally(() => { throw err; })
        ))
    ));
}

module.exports = download;
module.exports.downloaders = downloaders;
module.exports.cleanTmpDir = cleanTmpDir;
