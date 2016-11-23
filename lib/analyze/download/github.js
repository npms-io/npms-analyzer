'use strict';

const fs = require('fs');
const tokenDealer = require('token-dealer');
const got = require('got');
const untar = require('./util/untar');
const hostedGitInfo = require('../util/hostedGitInfo');
const gotRetries = require('../util/gotRetries');
const exec = require('../util/exec');
const mergePackageJson = require('./util/mergePackageJson');

const log = logger.child({ module: 'download/github' });
const unavailableStatusCodes = [404, 400, 403, 451];  // 404 - not found; 400 - invalid repo name; 403/451 - dmca takedown

/**
 * Downloads the package from GitHub.
 *
 * @param {string} shorthand The <org>/<repo>
 * @param {string} ref       The ref to download (null to download the default branch)
 * @param {string} tmpDir    The temporary dir path to download to
 * @param {object} options   The options inferred from github() options
 *
 * @return {Promise} The promise that resolves with the downloaded ref
 */
function download(shorthand, ref, tmpDir, options) {
    const url = `https://api.github.com/repos/${shorthand}/tarball/${ref || ''}`;
    const tarballFile = `${tmpDir}/tarball.tar.gz`;
    let downloadedRef = ref;

    log.trace(`Will download tarball of ${shorthand}@${ref || 'default'}..`);

    // Download tarball
    // Use token dealer to circumvent rate limit issues
    return tokenDealer(options.tokens, (token, exhaust) => {
        return new Promise((resolve, reject) => {
            let request;
            const handleRateLimit = (response, err) => {
                if (response.headers['x-ratelimit-remaining'] === '0') {
                    const isRateLimitError = err && err.statusCode === 403;

                    exhaust(Number(response.headers['x-ratelimit-reset']) * 1000, isRateLimitError);
                }
            };

            got.stream(url, {
                timeout: 15000,
                headers: Object.assign({ accept: 'application/vnd.github.v3+json' }, token ? { authorization: `token ${token}` } : null),
                retries: gotRetries,
            })
            .on('request', (request_) => { request = request_; })
            .on('response', (response) => {
                // Handle rate limit stuff
                handleRateLimit(response);

                // Check if the file is too big..
                const contentLength = Number(response.headers['content-length']);

                if (contentLength > options.maxSize) {
                    request.abort();
                    reject(Object.assign(new Error(`${shorthand} tarball is too large (~${Math.round(contentLength / 1024 / 1024)}MB)`), {
                        unrecoverable: true,
                    }));
                }
            })
            .on('error', (err, details, response) => {
                // Handle rate limit stuff
                try {
                    response && handleRateLimit(response, err);
                } catch (exhaustedErr) {
                    err = exhaustedErr || err;
                }

                reject(err);
            })
            .pipe(fs.createWriteStream(tarballFile))
            .on('error', reject)
            .on('finish', resolve);
        });
    }, {
        group: 'github',
        wait: options.waitRateLimit,
        onExhausted: (token) => log.warn(`Token ${token ? token.substr(0, 10) : '<empty>'}.. exhausted`),
    })
    // Extract tarball
    .then(() => {
        log.debug({ tarballFile }, `Successfully downloaded ${shorthand} tarball, will now extract ..`);
        return untar(tarballFile, { maxFiles: options.maxFiles });
    })
    // Clear out the ref if any error occurred; also delete downloaded archive if any
    .catch((err) => {
        downloadedRef = null;

        return exec(exec.escape`rm -rf ${tarballFile}`)
        .finally(() => { throw err; });
    })
    // If we got a 404 either the repository or the specified ref does not exist (devs usually forget to push or do push -f)
    // If a specific ref was requested, attempt to download the default branch
    .catch((err) => err.statusCode === 404 && ref, () => {
        log.info(`Download of ${shorthand}@${ref} tarball failed with 404, trying default branch..`);
        return download(shorthand, null, tmpDir, options);
    })
    // Check if the repository is unavailable
    .catch((err) => unavailableStatusCodes.indexOf(err.statusCode) !== -1, (err) => {
        log.info({ err }, `Download of ${shorthand} tarball failed with ${err.statusCode}`);
    })
    .catch((err) => {
        log.error({ err }, `Download of ${shorthand} tarball failed`);
        throw err;
    })
    // Finally return the ref
    .then(() => downloadedRef);
}

// ------------------------------------------------------------------

/**
 * Checks if this package should be downloaded from GitHub.
 *
 * If it does, the promise results with a function that will download the package.
 * If it does not, the promise will resolve to null.
 *
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} [options]   The options; read below to get to know each available option
 *
 * @return {Function} The download function or null
 */
function github(packageJson, options) {
    const repository = packageJson.repository;

    if (!repository) {
        return null;
    }

    const gitInfo = hostedGitInfo(repository.url);

    if (!gitInfo || gitInfo.type !== 'github') {
        return null;
    }

    options = Object.assign({
        tokens: null,          // The GitHub API tokens to use
        refOverrides: null,    // An hash of ref overrides to be used
        waitRateLimit: false,  // True to wait if rate limit for all tokens were exceeded
        maxSize: 262144000,    // Max allowed download size (250MB)
        maxFiles: 32000,       // Max allowed files to download (extract)
    }, options);

    const refOverride = options.refOverrides ? options.refOverrides[packageJson.name] : undefined;

    // Any ref set to "null" means to bypass the downloader
    if (refOverride === null) {
        return null;
    }

    return (tmpDir) => {
        const shorthand = `${gitInfo.user}/${gitInfo.project}`;
        const ref = refOverride || packageJson.gitHead || null;

        return download(shorthand, ref, tmpDir, options)
        .then((downloadedRef) => Promise.all([downloadedRef, mergePackageJson(packageJson, tmpDir, { preferDownloaded: !!refOverride })]))
        .spread((downloadedRef, mergedPackageJson) => ({
            downloader: 'github',
            dir: tmpDir,
            packageJson: mergedPackageJson,
            gitRef: downloadedRef,
        }));
    };
}

module.exports = github;
