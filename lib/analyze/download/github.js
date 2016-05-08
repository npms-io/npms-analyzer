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

/**
 * Downloads the module from GitHub.
 *
 * @param {string} shorthand The <org>/<repo>
 * @param {string} ref       The ref to download (null to download the default branch)
 * @param {string} tmpDir    The temporary dir path to download to
 * @param {object} options   The options inferred from github() options
 *
 * @return {Promise} The promise that fulfills when done
 */
function download(shorthand, ref, tmpDir, options) {
    const url = `https://api.github.com/repos/${shorthand}/tarball/${ref || ''}`;
    const tarballFile = `${tmpDir}/tarball.tar.gz`;

    log.trace(`Will download tarball of ${shorthand}@${ref || 'default'}..`);

    // Download tarball
    // Use token dealer to circumvent rate limit issues
    return tokenDealer(options.tokens, (token, exhaust) => {
        return new Promise((resolve, reject) => {
            let request;
            const handleRateLimit = (response, err) => {
                if (response.headers['x-ratelimit-remaining'] === '0') {
                    const isRateLimitError = err && err.statusCode === 403;

                    log.warn(`Token ${token.substr(0, 10)}.. exhausted`);
                    exhaust(Number(response.headers['x-ratelimit-reset']) * 1000, isRateLimitError);
                }
            };

            got.stream(url, {
                timeout: 15000,
                headers: token ? { Authorization: `token ${token}` } : null,
                retries: gotRetries,
            })
            .on('request', (request_) => { request = request_; })
            .on('response', (response) => {
                // Handle rate limit stuff
                token && handleRateLimit(response);

                // Check if the file is too big..
                const contentLength = Number(response.headers['content-length']) || 0;

                if (contentLength > options.maxSize) {
                    request.abort();
                    reject(Object.assign(new Error(`Tarball is too large (~${Math.round(contentLength / 1024 / 1024)}MB)`), {
                        unrecoverable: true,
                    }));
                }
            })
            .on('error', (err, details, response) => {
                // Handle rate limit stuff
                try {
                    token && response && handleRateLimit(response, err);
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
    })
    // Extract tarball
    .then(() => {
        log.debug({ tarballFile }, `Successfully downloaded ${shorthand} tarball, will now extract ..`);
        return untar(tarballFile);
    })
    // If we got a 404 either the repository or the specified ref does not exist (devs usually forget to push or do push -f)
    // If a specific ref was requested, attempt to download the default branch
    .catch((err) => err.statusCode === 404 && ref, () => {
        log.info(`Download of ${shorthand}@${ref} tarball failed with 404, trying default branch..`);
        return download(shorthand, null, tmpDir, options);
    })
    // Check if the repository does not exist
    //   404 - not found; 400 - invalid repo name, 403 - dmca takedown
    .catch((err) => err.statusCode === 404 || err.statusCode === 400 || err.statusCode === 403, (err) => {
        log.info({ err }, `Download of ${shorthand} tarball failed with ${err.statusCode}`);
        return exec(exec.escape`rm -rf ${tarballFile}`);
    })
    .catch((err) => {
        log.error({ err }, `Download of ${shorthand} tarball failed`);
        throw err;
    });
}

// ------------------------------------------------------------------

/**
 * Checks if this module should be downloaded from GitHub.
 *
 * If it does, the promise results with a function that will download the module.
 * If it does not, the promise will resolve to null.
 *
 * @param {object} packageJson The module package.json
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
    }, options);

    return (tmpDir) => {
        const shorthand = `${gitInfo.user}/${gitInfo.project}`;
        const refOverride = options.refOverrides && options.refOverrides[packageJson.name];
        const ref = refOverride || packageJson.gitHead;

        return download(shorthand, ref, tmpDir, options)
        .then(() => mergePackageJson(packageJson, tmpDir, { preferDownloaded: !!refOverride }))
        .then((downloadedPackageJson) => ({ downloader: 'github', dir: tmpDir, packageJson: downloadedPackageJson }));
    };
}

module.exports = github;
