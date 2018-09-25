'use strict';

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
const gotRetry = require('../util/gotRetry');

const unavailableStatusCodes = [404, 400, 403, 451]; // 404 - not found; 400 - invalid repo name; 403/451 - dmca takedown
const log = logger.child({ module: 'collect/github' });

/**
 * Extract commits frequency based on the /stats/commit_activity response.
 *
 * @param {Object} commitActivity - The commit activity response.
 *
 * @returns {Array} The commits.
 */
function extractCommits(commitActivity) {
    // Aggregate the commit activity into ranges
    const points = commitActivity.map((entry) => ({ date: moment.unix(entry.week).utc(), count: entry.total }));
    const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints([7, 30, 90, 180, 365]));

    // Finally map to a prettier array based on the ranges
    return ranges.map((range) => ({
        from: range.from,
        to: range.to,
        count: range.points.reduce((sum, point) => sum + point.count, 0),
    }));
}

/**
 * Utility function to do a request to the GitHub API.
 *
 * @param {String} resource - The resource path.
 * @param {Object} options  - The options inferred from github() options.
 *
 * @returns {Promise} The promise for GitHub response.
 */
function githubRequest(resource, options) {
    const url = `https://api.github.com${resource}`;

    return promiseRetry((retry) => (
        // Use token dealer to circumvent rate limit issues
        tokenDealer(options.tokens, (token, exhaust) => {
            const handleRateLimit = (response, err) => {
                if (response.headers['x-ratelimit-remaining'] === '0') {
                    const isRateLimitError = err && err.statusCode === 403 && /rate limit/i.test(response.body.message);

                    exhaust(Number(response.headers['x-ratelimit-reset']) * 1000, isRateLimitError);
                }
            };

            return got(url, {
                json: true,
                timeout: 30000,
                headers: Object.assign({ accept: 'application/vnd.github.v3+json' }, token ? { authorization: `token ${token}` } : null),
                retry: gotRetry,
            })
            .then((response) => {
                handleRateLimit(response);

                return response;
            }, (err) => {
                err.response && handleRateLimit(err.response, err);
                throw err;
            });
        }, {
            group: 'github',
            wait: options.waitRateLimit,
            onExhausted: (token, reset) => log.error(`Token ${token ? token.substr(0, 10) : '<empty>'}.. exhausted`, { reset }),
        })
        .then((response) => {
            // If response is 202, it means that there's no cached result so we must wait a bit and try again
            if (response.statusCode === 202) {
                log.debug(`Got 202 response for ${url} (not cached), retrying..`);
                retry(Object.assign(new Error(`Empty response for ${url}`), { code: 'NO_CACHED_RESPONSE' }));
            }

            // If response is 204, it means that there's no content.. e.g.: there's no commits yet
            if (response.statusCode === 204) {
                return null;
            }

            return response.body;
        })
    ), { minTimeout: 2500, retries: 5 })
    // If after all the retries there's still no content, return an empty array
    .catch({ code: 'NO_CACHED_RESPONSE' }, (err) => {
        log.warn({ err }, err.message);

        return [];
    })
    // Check if the repository is unavailable
    .catch((err) => unavailableStatusCodes.indexOf(err.statusCode) !== -1, (err) => {
        log.info({ err }, `GitHub request to ${url} failed with ${err.statusCode}`);

        return null;
    })
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err }, `GitHub request to ${url} failed`);
        /* istanbul ignore next */
        throw err;
    });
}

/**
 * Fetches statistical information for a repository.
 *
 * @param {String} repository - The {user}/{project}.
 * @param {Object} options    - The options inferred from github() options.
 *
 * @returns {Promise} The promise for the stats.
 */
function fetchIssuesStats(repository, options) {
    return ghIssuesStats(repository, {
        tokens: options.tokens,
        concurrency: 5,
        got: { retry: gotRetry },
        tokenDealer: {
            wait: options.waitRateLimit,
            lru: tokenDealer.defaultLru,
            onExhausted: (token, reset) => log.error(`Token ${token ? token.substr(0, 10) : '<empty>'}.. exhausted`, { reset }),
        },
    })
    // Sum up the issues with the pull requests
    .then((stats) => ({
        count: stats.issues.count + stats.pullRequests.count,
        openCount: stats.issues.openCount + stats.pullRequests.openCount,
        distribution: Object.keys(stats.issues.distribution).reduce((accumulated, range) => {
            accumulated[range] = stats.issues.distribution[range] + stats.pullRequests.distribution[range];

            return accumulated;
        }, {}),
    }))
    // Check if the repository is unavailable
    .catch((err) => unavailableStatusCodes.indexOf(err.statusCode) !== -1, (err) => {
        log.warn({ err }, `Fetch of issues stats for ${repository} failed with ${err.statusCode}`);

        return null;
    })
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err }, `Fetch of issues stats for ${repository} failed`);
        /* istanbul ignore next */
        throw err;
    });
}

// ----------------------------------------------------------------------------

/**
 * Runs the github analyzer.
 * If the repository is not hosted in GitHub, the promise resolves to `null`.
 *
 * @param {Object} packageJson - The latest package.json data (normalized).
 * @param {Object} downloaded  - The downloaded info (`dir`, `packageJson`, ...).
 * @param {Object} [options]   - The options; read below to get to know each available option.
 *
 * @returns {Promise} The promise that fulfills when done.
 */
function github(packageJson, downloaded, options) {
    let repository = packageJson.repository;

    if (!repository) {
        log.debug(`No repository field present for ${packageJson.name}, ignoring..`);

        return Promise.resolve(null);
    }

    const gitInfo = hostedGitInfo(repository.url);

    if (!gitInfo || gitInfo.type !== 'github') {
        log.debug({ repository }, `Repository for ${packageJson.name} is not hosted on GitHub, ignoring..`);

        return Promise.resolve(null);
    }

    options = Object.assign({
        tokens: null, // The GitHub API tokens to use
        waitRateLimit: false, // True to wait if rate limit for all tokens were exceeded,
    }, options);

    repository = `${gitInfo.user}/${gitInfo.project}`;

    return promisePropsSettled({
        info: githubRequest(`/repos/${repository}`, options),
        contributors: githubRequest(`/repos/${repository}/stats/contributors`, options),
        commitActivity: githubRequest(`/repos/${repository}/stats/commit_activity`, options),
        statuses: githubRequest(`/repos/${repository}/commits/${downloaded.gitRef || 'master'}/statuses`, options),
        issueStats: fetchIssuesStats(repository, options),
    })
    .then((props) => {
        const propKeys = Object.keys(props);
        const missingProps = propKeys.filter((key) => !props[key]);

        if (missingProps.length) {
            if (missingProps.length === propKeys.length) {
                log.info(`The GitHub repository ${repository} is unavailable`);
            } else {
                log.info(`It seems that the GitHub repository ${repository} is empty`);
            }

            return null;
        }

        return deepCompact({
            homepage: props.info.homepage,
            forkOf: (props.info.fork && props.info.parent && props.info.parent.full_name) || null,

            starsCount: props.info.stargazers_count,
            forksCount: props.info.forks_count,
            subscribersCount: props.info.subscribers_count,

            issues: Object.assign(props.issueStats, { isDisabled: !props.info.has_issues }),

            // Contributors (top 100)
            contributors: props.contributors
            .map((contributor) => {
                const author = contributor.author;

                // Empty entries will be stripped by deepCompact
                return author && { username: contributor.author.login, commitsCount: contributor.total };
            })
            .reverse(),

            // Commit activity
            commits: extractCommits(props.commitActivity),

            // Statuses
            statuses: uniqBy(props.statuses, (status) => status.context)
            .map((status) => pick(status, 'context', 'state')),
        });
    })
    .tap(() => log.debug(`The github collector for ${packageJson.name} completed successfully`));
}

module.exports = github;
