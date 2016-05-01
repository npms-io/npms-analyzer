'use strict';

const urlLib = require('url');
const log = require('npmlog');
const exec = require('../util/exec');
const hostedGitInfo = require('../util/hostedGitInfo');
const mergePackageJson = require('./util/mergePackageJson');

const logPrefix = 'download/git';

/**
 * Downloads the module using git.
 *
 * @param {string} url     The repository clone URL
 * @param {string} ref     The ref to download (null to download the default branch)
 * @param {string} tmpDir  The temporary dir path to download to
 * @param {object} options The options inferred from github() options
 *
 * @return {Promise} The promise that fulfills when done
 */
function download(url, ref, tmpDir, options) {
    log.verbose(logPrefix, `Will now clone ${url}`);

    // Clone repository
    return exec(exec.escape`git clone -q ${url} .`, { cwd: tmpDir })
    // Checkout the ref if any
    .then(() => ref && exec(exec.escape`git checkout -q ${ref}`, { cwd: tmpDir }))
    // Wait a maximum of X time
    .timeout(options.maxTime)
    // Finally remove the .git folder if it exists
    .finally(() => exec(exec.escape`rm -rf ${tmpDir}/.git`))
    // Repository does not exist, is invalid, or we have no permission?
    //   https://foo:bar@github.com/something/thatwillneverexist.git  -> authentication failed
    //   https://foo:bar@github.com/some/privaterepo.git  -> authentication failed
    //   https://foo:bar@github.com/org/foo+foo.git -> not found
    //   https://foo:bar@github.com/org/foo%foo.git -> unable to access (400)
    //   https://foo:bar@bitbucket.org/something/thatwillneverexist.git -> not found
    //   https://foo:bar@bitbucket.org/some/privaterepo.git  -> authentication failed
    //   https://foo:bar@bitbucket.org/org/foo+foo.git -> not found
    //   https://foo:bar@bitbucket.org/org/foo%foo.git -> unable to access (400)
    //   https://foo:bar@gitlab.com/something/thatwillneverexist.git -> authenticated failed
    //   https://foo:bar@gitlab.com/some/privaterepo.git  -> authentication failed
    //   https://foo:bar@gitlab.com/org/foo+foo.git -> unable to access (500)
    //   https://foo:bar@gitlab.com/org/foo%foo.git -> unable to access (400)
    .catch((err) => /(not found|authentication failed)/i.test(err.stderr), (err) => {
        log.info(logPrefix, `Repository ${url} does not exist or is private`, { err });
    })
    .catch((err) => /unable to access/i.test(err.stderr), (err) => {
        log.info(logPrefix, `Repository ${url} seems to be invalid`, { err });
    })
    // Check if ref no longer exists
    //   did not match any file -> if branch or tag does not exist
    //   reference is not a tree -> if sha does not exist
    .catch((err) => /(did not match any file|reference is not a tree)/i.test(err.stderr), (err) => {
        log.info(logPrefix, `Failed to checkout ref ${ref} for ${url}, using default branch..`, { err });
    });
}

/**
 * Gets the clone URL from `gitInfo` (https).
 *
 * @param {object} gitInfo The git info object
 *
 * @return {string} The https clone URL
 */
function getCloneUrl(gitInfo) {
    let url;

    // Use https:// protocol to avoid having to setup ssh keys in GitHub, Bitbucket and GitLab
    // Also, foo@bar is added as username & password to prevent git clone from prompting for credentials
    // Even if foo@bar does not exist or is invalid, public repositories are still cloned correctly
    url = gitInfo.https().substr(4);
    url = Object.assign(urlLib.parse(url), { auth: 'foo:bar' });
    url = urlLib.format(url);

    return url;
}

// ------------------------------------------------------------------

/**
 * Checks if this module should be downloaded using git.
 *
 * If it does, the promise results with a function that will download the module.
 * If it does not, the promise will resolve to null.
 *
 * @param {object} packageJson The module package.json
 * @param {object} [options]   The options; read below to get to know each available option
 *
 * @return {Function} The download function or null
 */
function git(packageJson, options) {
    const repository = packageJson.repository;

    if (!repository) {
        return null;
    }

    const gitInfo = hostedGitInfo(repository.url);

    if (!gitInfo) {
        return null;
    }

    options = Object.assign({
        refOverrides: null,  // An hash of ref overrides to be used
        maxTime: 600000,     // Max allowed download time (10m)
    }, options);

    return (tmpDir) => {
        const url = getCloneUrl(gitInfo);
        const refOverride = options.refOverrides && options.refOverrides[packageJson.name];
        const ref = refOverride || packageJson.gitHead;

        return download(url, ref, tmpDir, options)
        .then(() => mergePackageJson(packageJson, tmpDir, { preferDownloaded: !!refOverride }))
        .then((downloadedPackageJson) => ({ downloader: 'git', dir: tmpDir, packageJson: downloadedPackageJson }));
    };
}

module.exports = git;
