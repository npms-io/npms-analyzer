'use strict';

const hostedGitInfoFromUrl = require('hosted-git-info').fromUrl;

const log = logger.child({ module: 'util/hosted-git-info' });

/**
 * Wrapper around hostedGitInfo.fromUrl that returns null on exceptions.
 * See: Https://github.com/npm/hosted-git-info/issues/15.
 *
 * @param {String} repositoryUrl - The repository URL.
 *
 * @returns {Object} The git info object or undefined.
 */
function hostedGitInfo(repositoryUrl) {
    try {
        return hostedGitInfoFromUrl(repositoryUrl);
    } catch (err) {
        log.warn({ err }, `Error while parsing ${repositoryUrl}, returning null..`);
    }
}

module.exports = hostedGitInfo;
