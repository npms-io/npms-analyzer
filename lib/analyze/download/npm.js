'use strict';

const fs = require('fs');
const got = require('got');
const untar = require('./util/untar');
const gotRetry = require('../util/gotRetry');
const exec = require('../util/exec');
const mergePackageJson = require('./util/mergePackageJson');

const log = logger.child({ module: 'download/npm' });

/**
 * Downloads the package from the npm registry.
 *
 * @param {String} target  - The <name>@<version> to download.
 * @param {String} url     - The tarball URL.
 * @param {String} tmpDir  - The temporary dir path to download to.
 * @param {Object} options - The options inferred from npm() options.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function download(target, url, tmpDir, options) {
    const tarballFile = `${tmpDir}/tarball.tar.gz`;

    log.debug({ url }, `Will download tarball of ${target}..`);

    // Download tarball
    return new Promise((resolve, reject) => {
        let request;

        got.stream(url, { timeout: 30000, retry: gotRetry })
        .on('error', reject)
        .on('request', (request_) => { request = request_; })
        .on('response', (response) => {
            // Check if the file is too big..
            const contentLength = Number(response.headers['content-length']);

            if (contentLength > options.maxSize) {
                request.abort();
                reject(Object.assign(new Error(`Tarball is too large (~${Math.round(contentLength / 1024 / 1024)}MB)`), {
                    unrecoverable: true,
                }));
            }
        })
        .pipe(fs.createWriteStream(tarballFile))
        .on('error', reject)
        .on('finish', resolve);
    })
    // Extract tarball
    .then(() => {
        log.debug({ tarballFile }, `Successfully downloaded ${target} tarball, will now extract ..`);

        return untar(tarballFile, { maxFiles: options.maxFiles });
    })
    // Check if the repository does not exist
    .catch({ statusCode: 404 }, (err) => {
        log.warn({ err }, `Download of ${target} tarball failed with ${err.statusCode}`);

        return exec(exec.escape`rm -rf ${tarballFile}`);
    })
    .catch((err) => {
        log.error({ err }, `Download of ${target} tarball failed`);
        throw err;
    });
}

// ------------------------------------------------------------------

/**
 * Checks if this package should be downloaded from the npm registry.
 *
 * If it does, the promise results with a function that will download the package.
 * If it does not, the promise will resolve to null.
 *
 * @param {Object} packageJson - The latest package.json data (normalized).
 * @param {Object} [options]   - The options; read below to get to know each available option.
 *
 * @returns {Function} The download function or null.
 */
function npm(packageJson, options) {
    options = Object.assign({
        maxSize: 262144000, // Max allowed download size (250MB)
        maxFiles: 32000, // Max allowed files to download (extract)
    }, options);

    return (tmpDir) => {
        const url = packageJson.dist && packageJson.dist.tarball;
        const target = `${packageJson.name}@${packageJson.version}`;

        return Promise.try(() => {
            // Protect against packages that don't have tarballs, e.g.: `roost-mongo@0.1.0`
            if (url) {
                return download(target, url, tmpDir, options);
            }

            log.warn(`No tarball url for ${target}`);
        })
        .then(() => ({
            downloader: 'npm',
            dir: tmpDir,
            packageDir: tmpDir,
        }))
        // Merge the downloaded repository package.json with the one from the registry
        // See mergePackageJson() to know why we do this
        .tap((downloaded) => (
            mergePackageJson(packageJson, downloaded.packageDir)
            .then((downloadedPackageJson) => { downloaded.packageJson = downloadedPackageJson; })
        ));
    };
}

module.exports = npm;
