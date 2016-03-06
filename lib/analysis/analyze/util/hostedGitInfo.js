'use strict';

const log = require('npmlog');
const hostedGitInfoFromUrl = require('hosted-git-info').fromUrl;

const logPrefix = 'util/hosted-git-info';

/**
 * Wrapper around hostedGitInfo.fromUrl that returns null on exceptions.
 * See: https://github.com/npm/hosted-git-info/issues/15
 *
 * @param {string} repositoryUrl The repository URL
 *
 * @return {object} The git info object or null
 */
function hostedGitInfo(repositoryUrl) {
    try {
        return hostedGitInfoFromUrl(repositoryUrl);
    } catch (err) {
        log.warn(logPrefix, `Error while parsing ${repositoryUrl}, returning null..`, { err });
        return null;
    }
}

/**
 * Normalizes trailing / in known repositories.
 * See: https://github.com/npm/hosted-git-info/issues/14
 *
 * @param {string} repositoryUrl The repository URL
 *
 * @return {string} The normalized repository URL
 */
function normalizeTrailingSlashes(repositoryUrl) {
    // Normalize trailing slashes in repository
    if (/(github\.com|bitbucket\.org|gitlab\.com).+\/$/i.test(repositoryUrl)) {
        log.warn(logPrefix, `Normalizing ${repositoryUrl} trailing slashes..`);
        repositoryUrl = repositoryUrl.replace(/\/+$/, '');
    }

    return repositoryUrl;
}

module.exports = hostedGitInfo;
module.exports.normalizeTrailingSlashes = normalizeTrailingSlashes;
