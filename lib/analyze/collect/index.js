'use strict';

const pickBy = require('lodash/pickBy');
const isEmpty = require('lodash/isEmpty');
const collectors = require('require-directory')(module);
const promisePropsSettled = require('./util/promisePropsSettled');
const hostedGitInfo = require('../util/hostedGitInfo');

const log = logger.child({ module: 'collect' });

/**
 * Checks if the publisher of a module owns the downloaded repository.
 *
 * Unfortunately many people try to trick the system by pointing their repositories to popular repositories,
 * such as `jQuery`.
 *
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} downloaded  The downloaded info (`dir`, `packageJson`, ...)
 * @param {Nano}   npmNano     The npm nano client instance
 *
 * @return {Promise} A promise that resolves to true if publisher is the owner, false if in doubt.
 */
function checkRepositoryOwnership(packageJson, downloaded, npmNano) {
    // If name is equal, then the publisher is the owner.. no further checks required
    if (packageJson.name === downloaded.packageJson.name) {
        return Promise.resolve(true);
    }

    if (isEmpty(downloaded.packageJson)) {
        log.info({ packageJson, downloadedPackageJson: downloaded.packageJson }, `Downloaded package.json of ${packageJson.name} is empty`);
        return Promise.resolve(false);
    }

    // Be benevolent for forks where people change package.json stuff but forget to commit (e.g.: serverify)
    // This is ok to do, since the downloaded repository is always the one from `packageJson.repository`
    const gitInfo = hostedGitInfo((packageJson.repository && packageJson.repository.url) || '');
    const downloadedGitInfo = hostedGitInfo((downloaded.packageJson.repository && downloaded.packageJson.repository.url) || '');

    if (gitInfo && downloadedGitInfo && downloadedGitInfo && gitInfo.shortcut() !== downloadedGitInfo.shortcut()) {
        log.info({ packageJson, downloadedPackageJson: downloaded.packageJson }, `Package ${packageJson.name} seems to be a bad fork`);
        return Promise.resolve(true);
    }

    // Do a final check against the maintainers of the downloaded module so that valid use cases
    // such as `bower` and `bower-canary` returns true
    return npmNano.getAsync(downloaded.packageJson.name)
    .then((data) => {
        const publisher = packageJson._npmUser;

        if (!publisher) {
            return false;
        }

        const maintainers = Array.isArray(data.maintainers) ? data.maintainers : [];

        return maintainers.findIndex((maintainer) => maintainer.name === publisher.name || maintainer.email === publisher.email) !== -1;
    })
    .tap((isMaintainer) => {
        !isMaintainer && log.info(`Publisher of package ${packageJson.name} does not own the repository`,
            { packageJson, downloadedPackageJson: downloaded.packageJson });
    })
    .catch({ error: 'not_found' }, () => false);
}

// ----------------------------------------------------------------------------

/**
 * Runs all the collectors.
 *
 * @param {string} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} downloaded  The downloaded info (`dir`, `packageJson`)
 * @param {Nano}   npmNano     The npm nano client instance
 * @param {object} [options]   The options; read below to get to know each available option
 *
 * @return {Promise} The promise that fulfills when done
 */
function collect(data, packageJson, downloaded, npmNano, options) {
    options = Object.assign({
        githubTokens: null,   // The GitHub API tokens to use
        waitRateLimit: false, // True to wait if rate limit for all tokens were exceeded
    }, options);

    return checkRepositoryOwnership(packageJson, downloaded, npmNano)
    .then((isOwner) => {
        return promisePropsSettled({
            metadata: collectors.metadata(data, packageJson, downloaded, npmNano),
            npm: collectors.npm(data, packageJson, npmNano),
            github: isOwner && collectors.github(packageJson,
                    { tokens: options.githubTokens, waitRateLimit: options.waitRateLimit, ref: downloaded.ref }),
            source: isOwner && collectors.source(data, packageJson, downloaded,
                    { npmRegistry: `${npmNano.config.url}/${npmNano.config.db}` }),
        })
        .then((object) => pickBy(object));
    });
}

module.exports = collect;
