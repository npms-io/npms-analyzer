'use strict';

const hostedGitInfoFromUrl = require('hosted-git-info').fromUrl;

const log = logger.child({ module: 'util/hosted-git-info' });

/**
 * Wrapper around hostedGitInfo.fromUrl that returns null on exceptions.
 * See: https://github.com/npm/hosted-git-info/issues/15
 *
 * @param {string} repositoryUrl The repository URL
 *
 * @return {object} The git info object or undefined
 */
function hostedGitInfo(repositoryUrl) {
    try {
        return hostedGitInfoFromUrl(repositoryUrl);
    } catch (err) {
        log.warn({ err }, `Error while parsing ${repositoryUrl}, returning null..`);
    }
}

module.exports = hostedGitInfo;
