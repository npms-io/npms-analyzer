'use strict';

const log = require('npmlog');
const got = require('got');
const moment = require('moment');
const ghIssuesStats = require('gh-issues-stats');
const tokenDealer = require('token-dealer');
const deepCompact = require('deep-compact');
const promiseRetry = require('promise-retry');
const uniqBy = require('lodash/uniqBy');
const pick = require('lodash/pick');
const promisePropsSettled = require('./util/promisePropsSettled');
const pointsToRanges = require('./util/pointsToRanges');
const hostedGitInfo = require('../util/hostedGitInfo');
const gotRetries = require('../util/gotRetries');

const logPrefix = 'collect/github';

/**
 * Extract commits based on the /stats/commit_activity response.
 *
 * @param {object} commitActivity The commit activity response
 *
 * @return {array} The commits
 */
function extractCommits(commitActivity) {
    // Aggregate the commit activity into ranges
    const points = commitActivity.map((entry) => {
        return { date: moment.unix(entry.week).utc(), count: entry.total };
    });
    const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints([7, 30, 90, 180, 365]));

    // Finally map to a prettier array based on the ranges
    return ranges.map((range) => {
        return {
            from: range.from,
            to: range.to,
            count: range.points.reduce((sum, point) => sum + point.count, 0),
        };
    });
}

/**
 * Utility function to do a request to the GitHub API.
 *
 * @param {string} resource The resource path
 * @param {object} options  The options inferred from github() options
 *
 * @return {Promise} The promise for GitHub response
 */
function githubRequest(resource, options) {
    const url = `https://api.github.com${resource}`;

    return promiseRetry((retry) => {
        // Use token dealer to circumvent rate limit issues
        return tokenDealer(options.tokens, (token, exhaust) => {
            const handleRateLimit = (response, err) => {
                if (response.headers['x-ratelimit-remaining'] === '0') {
                    const isRateLimitError = err && err.statusCode === 403 && /rate limit/i.test(response.body.message);

                    log.warn(logPrefix, `Token ${token.substr(0, 10)}.. exhausted`);
                    exhaust(Number(response.headers['x-ratelimit-reset']) * 1000, isRateLimitError);
                }
            };

            return got(url, {
                json: true,
                timeout: 15000,
                headers: token ? { Authorization: `token ${token}` } : null,
                retries: gotRetries,
            })
            .then((response) => {
                token && handleRateLimit(response);
                return response;
            }, (err) => {
                token && err.response && handleRateLimit(err.response, err);
                throw err;
            });
        }, {
            group: 'github',
            wait: options.waitRateLimit,
        })
        .then((response) => {
            // If response is 202, it means that there's no cached result so we must wait a bit and try again
            if (response.statusCode === 202) {
                log.verbose(logPrefix, `Got 202 response for ${url} (not cached)`);
                retry(Object.assign(new Error(`Empty response for ${url}`), { code: 'NO_CACHED_RESPONSE' }));
            }

            // If response is 204, it means that there's no content.. e.g.: there's no commits yet
            if (response.statusCode === 204) {
                return null;
            }

            return response.body;
        });
    }, { minTimeout: 2500, retries: 5 })
    // If after all the retries there's still no content, return an empty array
    .catch({ code: 'NO_CACHED_RESPONSE' }, (err) => {
        log.warn(logPrefix, err.message, { err });
        return [];
    })
    // Check if the repository does not exist
    //   404 - not found; 400 - invalid repo name, 403 - dmca takedown
    .catch((err) => err.statusCode === 404 || err.statusCode === 400 || err.statusCode === 403, (err) => {
        log.info(logPrefix, `GitHub request to ${url} failed with ${err.statusCode}`, { err });
        return null;
    })
    .catch((err) => {
        log.error(logPrefix, `GitHub request to ${url} failed`, { err });
        throw err;
    });
}

/**
 * Fetches statistical information for a repository.
 *
 * @param {string} repository The {user}/{project}
 * @param {object} options    The options inferred from github() options
 *
 * @return {Promise} The promise for the stats
 */
function fetchIssuesStats(repository, options) {
    return ghIssuesStats(repository, {
        tokens: options.tokens,
        concurrency: 5,
        got: { retries: gotRetries },
        tokenDealer: { wait: options.waitRateLimit, lru: tokenDealer.defaultLru },
    })
    .then((stats) => {
        // Sum up the issues with the pull requests
        return {
            count: stats.issues.count + stats.pullRequests.count,
            openCount: stats.issues.openCount + stats.pullRequests.openCount,
            distribution: Object.keys(stats.issues.distribution).reduce((accumulated, range) => {
                accumulated[range] = stats.issues.distribution[range] + stats.pullRequests.distribution[range];

                return accumulated;
            }, {}),
        };
    })
    // Check if the repository does not exist
    //   404 - not found; 400 - invalid repo name, 403 - dmca takedown
    .catch((err) => err.statusCode === 404 || err.statusCode === 400 || err.statusCode === 403, (err) => {
        log.info(logPrefix, `Fetch of issues stats for ${repository} failed with ${err.statusCode}`, { err });
        return null;
    })
    .catch((err) => {
        log.error(logPrefix, `Fetch of issues stats for ${repository} failed`, { err });
        throw err;
    });
}

// ----------------------------------------------------------------------------

/**
 * Runs the github analyzer.
 * If the repository is not hosted in GitHub, the promise resolves to `null`.
 *
 * @param {object} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {object} [options]   The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise that fulfills when done
 */
function github(data, packageJson, options) {
    let repository = packageJson.repository;

    if (!repository) {
        log.verbose(logPrefix, `No repository field present for ${packageJson.name}, ignoring..`);
        return Promise.resolve(null);
    }

    const gitInfo = hostedGitInfo(repository.url);

    if (!gitInfo || gitInfo.type !== 'github') {
        log.verbose(logPrefix, `Repository for ${packageJson.name} is not hosted on GitHub, ignoring..`, { repository });
        return Promise.resolve(null);
    }

    options = Object.assign({
        tokens: null,          // The GitHub API tokens to use
        waitRateLimit: false,  // True to wait if rate limit for all tokens were exceeded
    }, options);

    repository = `${gitInfo.user}/${gitInfo.project}`;
    const ref = packageJson.gitHead || 'master';

    return promisePropsSettled({
        info: githubRequest(`/repos/${repository}`, options),
        contributors: githubRequest(`/repos/${repository}/stats/contributors`, options),
        commitActivity: githubRequest(`/repos/${repository}/stats/commit_activity`, options),
        statuses: githubRequest(`/repos/${repository}/commits/${ref}/statuses`, options),
        issueStats: fetchIssuesStats(repository, options),
    })
    .then((data) => {
        const dataKeys = Object.keys(data);
        const missingData = dataKeys.filter((key) => !data[key]);

        if (missingData.length) {
            if (missingData.length === dataKeys.length) {
                log.info(logPrefix, `The GitHub repository ${repository} no longer exists, is invalid or blocked`);
            } else {
                log.info(logPrefix, `It seems that the GitHub repository ${repository} is empty`);
            }

            return null;
        }

        return deepCompact({
            homepage: data.info.homepage,
            forkOf: (data.info.fork && data.info.parent && data.info.parent.full_name) || null,

            starsCount: data.info.stargazers_count,
            forksCount: data.info.forks_count,
            subscribersCount: data.info.subscribers_count,

            issues: Object.assign(data.issueStats, { isDisabled: !data.info.has_issues }),

            // Contributors (top 100)
            contributors: data.contributors
            .map((contributor) => {
                const author = contributor.author;

                // Empty entries will be stripped by deepCompact
                return author && { username: contributor.author.login, commitsCount: contributor.total };
            })
            .reverse(),

            // Commit activity
            commits: extractCommits(data.commitActivity),

            // Statuses
            statuses: uniqBy(data.statuses, (status) => status.context)
            .map((status) => pick(status, 'context', 'state')),
        });
    })
    .tap(() => log.verbose(logPrefix, `The GitHub collector for ${packageJson.name} completed successfully`));
}

module.exports = github;
