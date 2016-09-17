'use strict';

const pickBy = require('lodash/pickBy');
const intersectionWith = require('lodash/intersectionWith');
const isEmpty = require('lodash/isEmpty');
const collectors = require('require-directory')(module, './', { recurse: false });
const promisePropsSettled = require('./util/promisePropsSettled');

const log = logger.child({ module: 'collect' });

/**
 * Checks if a package matches the downloaded repository.
 *
 * Unfortunately many people try to trick the system by pointing their repositories to popular repositories,
 * such as `jQuery`.
 *
 * @param {string} data        The package data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} downloaded  The downloaded info (`dir`, `packageJson`, ...)
 * @param {Nano}   npmNano     The npm nano client instance
 *
 * @return {Promise} A promise that resolves to true if publisher is the owner, false if in doubt.
 */
function checkRepositoryOwnership(data, packageJson, downloaded, npmNano) {
    // If name is equal, then the publisher is the owner.. no further checks required
    if (packageJson.name === downloaded.packageJson.name) {
        return Promise.resolve(true);
    }

    const repositoryUrl = packageJson.repository && packageJson.repository.url;
    const downloadedRepositoryUrl = downloaded.packageJson.repository && downloaded.packageJson.repository.url;

    // Check if both have no repository
    if (!repositoryUrl && !downloadedRepositoryUrl) {
        return Promise.resolve(true);
    }

    // Check if download actually failed (e.g.: does not exist)
    if (isEmpty(downloaded.packageJson)) {
        return Promise.resolve(false);
    }

    // Do a final check against the maintainers of the downloaded package
    return npmNano.getAsync(downloaded.packageJson.name)
    .then((downloadedData) => {
        return intersectionWith(data.maintainers, downloadedData.maintainers, (maintainer, downloadedMaintainer) => {
            return maintainer.name === downloadedMaintainer.name || maintainer.email === downloadedMaintainer.email;
        }).length > 0;
    })
    .tap((isMaintainer) => {
        !isMaintainer && log.info({ packageJson, downloaded },
            `Publisher of package ${packageJson.name} does not own the repository`);
    })
    .catch({ error: 'not_found' }, () => false);
}

// ----------------------------------------------------------------------------

/**
 * Runs all the collectors.
 *
 * @param {string} data        The package data
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

    return checkRepositoryOwnership(data, packageJson, downloaded, npmNano)
    .then((isRepositoryOwner) => {
        const isSourceOwner = downloaded.downloader === 'npm' || isRepositoryOwner;

        return promisePropsSettled({
            metadata: collectors.metadata(data, packageJson),
            npm: collectors.npm(data, packageJson, npmNano),
            github: isRepositoryOwner && collectors.github(packageJson, downloaded,
                    { tokens: options.githubTokens, waitRateLimit: options.waitRateLimit }),
            source: isSourceOwner && collectors.source(data, packageJson, downloaded,
                    { npmRegistry: `${npmNano.config.url}/${npmNano.config.db}` }),
        })
        .then((collected) => pickBy(collected));
    });
}

module.exports = collect;
module.exports.collectors = collectors;
