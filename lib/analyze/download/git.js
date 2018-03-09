'use strict';

const urlLib = require('url');
const exec = require('../util/exec');
const hostedGitInfo = require('../util/hostedGitInfo');
const findPackageDir = require('./util/findPackageDir');
const mergePackageJson = require('./util/mergePackageJson');
const assertFilesCount = require('./util/assertFilesCount');

const log = logger.child({ module: 'download/git' });

/**
 * Downloads the package using git.
 *
 * @param {string} url     The repository clone URL
 * @param {string} ref     The ref to download (null to download the default branch)
 * @param {string} tmpDir  The temporary dir path to download to
 * @param {object} options The options inferred from github() options
 *
 * @return {Promise} The promise that resolves with the downloaded ref
 */
function download(url, ref, tmpDir, options) {
    let downloadedRef = ref;

    log.debug(`Will now clone ${url}`);

    // Clone repository
    return exec(exec.escape`git clone -q ${url} .`, { cwd: tmpDir })
    // Checkout the ref if any
    .then(() => ref && exec(exec.escape`git checkout -q ${ref}`, { cwd: tmpDir }))
    // Wait a maximum of X time
    .timeout(options.maxTime)
    // Clear out the ref if any error occurred
    .catch((err) => {
        downloadedRef = null;
        throw err;
    })
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
    .catch((err) => /not found|authentication failed/i.test(err.stderr), (err) => {
        log.info({ err }, `Repository ${url} does not exist or is private`);
    })
    .catch((err) => /unable to access/i.test(err.stderr), (err) => {
        log.info({ err }, `Repository ${url} seems to be invalid`);
    })
    // Check if ref no longer exists
    //   did not match any file -> if branch or tag does not exist
    //   reference is not a tree -> if sha does not exist
    .catch((err) => /did not match any file|reference is not a tree/i.test(err.stderr), (err) => {
        log.info({ err }, `Failed to checkout ref ${ref} for ${url}, using default branch..`);
    })
    // Finally return the ref
    .then(() => downloadedRef);
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
 * Checks if this package should be downloaded using git.
 *
 * If it does, the promise results with a function that will download the package.
 * If it does not, the promise will resolve to null.
 *
 * @param {object} packageJson The latest package.json data (normalized)
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
        maxTime: 600000,     // Max allowed download time (10m)
        maxFiles: 32000,     // Max allowed files to download
    }, options);

    return (tmpDir) => {
        const url = getCloneUrl(gitInfo);
        const ref = packageJson.gitHead || null;

        return download(url, ref, tmpDir, options)
        .then((gitRef) => ({
            downloader: 'git',
            dir: tmpDir,
            gitRef,
        }))
        // Assert that the number of downloaded files is not too big to be processed
        .tap(() => assertFilesCount(tmpDir, options.maxFiles))
        // Find package dir within the repository
        // The package is usually in the root for regular repositories, but not for mono-repositories
        .tap((downloaded) => {
            return findPackageDir(packageJson, tmpDir)
            .then((packageDir) => { downloaded.packageDir = packageDir; });
        })
        // Merge the downloaded repository package.json with the one from the registry
        // See mergePackageJson() to know why we do this
        .tap((downloaded) => {
            return mergePackageJson(packageJson, downloaded.packageDir)
            .then((downloadedPackageJson) => { downloaded.packageJson = downloadedPackageJson; });
        })
        // Remove package-lock.json file if any.
        // People often forgot to update the package-lock, which is not published, and messes up
        // with collectors, such as `nodesecurity`.
        .tap((downloaded) => {
            return exec(exec.escape`rm -rf ${downloaded.packageDir}/package-lock.json`);
        });
    };
}

module.exports = git;
