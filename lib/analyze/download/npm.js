'use strict';

const fs = require('fs');
const got = require('got');
const log = require('npmlog');
const untar = require('./util/untar');
const gotRetries = require('../util/gotRetries');
const exec = require('../util/exec');
const overridePackageJson = require('./util/overridePackageJson');

const logPrefix = 'download/npm';

/**
 * Downloads the module from the npm registry.
 *
 * @param {string} target  The <module>@<version> to download
 * @param {string} url     The tarball URL
 * @param {string} tmpDir  The temporary dir path to download to
 * @param {object} options The options inferred from npm() options
 *
 * @return {Promise} The promise that fulfills when done
 */
function download(target, url, tmpDir, options) {
    const tarballFile = `${tmpDir}/tarball.tar.gz`;

    log.verbose(logPrefix, `Will download tarball of ${target}..`, { url });

    // Download tarball
    return new Promise((resolve, reject) => {
        let request;

        got.stream(url, { timeout: 15000, retries: gotRetries })
        .on('error', reject)
        .on('request', (request_) => { request = request_; })
        .on('response', (response) => {
            // Check if the file is too big..
            const contentLength = Number(response.headers['content-length']) || 0;

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
        log.verbose(logPrefix, `Successfully downloaded ${target} tarball, will now extract ..`, { tarballFile });
        return untar(tarballFile);
    })
    // Check if the repository does not exist
    .catch((err) => err.statusCode === 404, (err) => {
        log.warn(logPrefix, `Download of ${target} tarball failed with ${err.statusCode}`, { err });
        return exec(`rm -rf ${tarballFile}`);
    })
    .catch((err) => {
        log.error(logPrefix, `Download of ${target} tarball failed`, { err });
        throw err;
    });
}

// ------------------------------------------------------------------

/**
 * Checks if this module should be downloaded from the npm registry.
 *
 * If it does, the promise results with a function that will download the module.
 * If it does not, the promise will resolve to null.
 *
 * @param {object} packageJson The module package.json
 * @param {object} [options]   The options; read bellow to get to know each available option
 *
 * @return {Function} The download function or null
 */
function npm(packageJson, options) {
    options = Object.assign({
        maxSize: 262144000,  // Max allowed download size (250MB)
    }, options);

    return (tmpDir) => {
        const url = packageJson.dist && packageJson.dist.tarball;
        const target = `${packageJson.name}@${packageJson.version}`;

        return Promise.try(() => {
            // Protect against modules that don't have tarballs, e.g.: `roost-mongo@0.1.0`
            if (url) {
                return download(target, url, tmpDir, options);
            }

            log.warn(logPrefix, `No tarball url for ${target}`);
        })
        .then(() => overridePackageJson(packageJson, tmpDir, { onlyIfBroken: true }))
        .return(tmpDir);
    };
}

module.exports = npm;
