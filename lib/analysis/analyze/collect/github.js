'use strict';

const log = require('npmlog');
const Promise = require('bluebird');
const got = require('got');
const hostedGitInfo = require('hosted-git-info');
const promiseRetry = require('promise-retry');
const moment = require('moment');
const deepCompact = require('deep-compact');
const tokenDealer = require('token-dealer');
const uniqBy = require('lodash/uniqBy');
const pick = require('lodash/pick');
const pull = require('lodash/pull');
const promisePropsSettled = require('./util/promisePropsSettled');
const pointsToRanges = require('./util/pointsToRanges');
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
            const handleResponse = (response, err) => {
                if (response.headers['x-ratelimit-remaining'] === '0') {
                    log.warn(logPrefix, `Token ${token.substr(0, 10)}.. exhausted`);
                    exhaust(Number(response.headers['x-ratelimit-reset']) * 1000, err && err.statusCode === 403);
                }
            };

            return got(url, {
                json: true,
                timeout: 15000,
                headers: token ? { Authorization: `token ${token}` } : null,
                retries: gotRetries,
            })
            .then((response) => {
                handleResponse(response);
                return response;
            }, (err) => {
                err.response && handleResponse(err.response, err);
                throw err;
            });
        }, {
            group: 'github',
            wait: (token, duration) => {
                if (!options.waitRateLimit) {
                    return false;
                }

                duration = Math.ceil(duration / 1000 / 60);
                log.stat(logPrefix, `All tokens are exhausted, next one will become available in ${duration} minutes`);
                return true;
            },
        })
        .then((response) => {
            // If response is 202, it means that there's no cached result so we must
            // wait a bit and try again
            if (response.statusCode === 202) {
                log.verbose(logPrefix, `Got 202 response for ${url} (not cached)`);
                retry(new Error(`Got 202 response for ${url} (not cached)`));
            }

            return response.body;
        }, (err) => {
            // If status is 404, simply return null
            if (err.statusCode === 404) {
                log.warn(logPrefix, `GitHub request to ${url} failed with 404`, { err });
                return null;
            }

            log.error(logPrefix, `GitHub request to ${url} failed`, { err });
            throw err;
        });
    }, { minTimeout: 2500, retries: 5 });
}

/**
 * Utility function to do a request to the Issue Stats API.
 *
 * @param {string} resource The resource path
 *
 * @return {Promise} The promise for GitHub response
 */
function issueStatsRequest(resource) {
    const url = `http://issuestats.com${resource}?format=json`;

    return promiseRetry((retry) => {
        return got(url, { timeout: 15000, retries: gotRetries })
        .then((response) => {
            let issueStats;

            // Need to manually parse the JSON because we need to test for 404 responses
            // See: https://github.com/hstove/issue_stats/issues/38
            try {
                issueStats = JSON.parse(response.body);
            } catch (err) {
                if (/couldn't find that page/i.test(response.body)) {
                    log.verbose(logPrefix, `Issue Stats request to ${url} failed because the page does not exist`);
                    return null;
                }

                // If the page is invalid, try again.. it usually works next time
                err = Object.assign(new Error('Issue Stats response is not valid JSON'),
                    { url, response: `${response.body.substr(0, 2500)}..` });

                log.warn(logPrefix, `Issue Stats response to ${url} is not valid JSON`, { err });
                retry(err);
            }

            // Check if the results are valid or if we need to wait a bit and try again
            if (issueStats.issues_count == null) {
                log.verbose(logPrefix, `Issue Stats response for ${url} does not have valid information yet`);
                retry(new Error(`Issue Stats response for ${url} does not have valid information yet`));
            }

            return issueStats;
        }, (err) => {
            // If status is 404, simply return null
            if (err.statusCode === 404) {
                log.warn(logPrefix, `Issue Stats request to ${url} failed with 404`, { err });
                return null;
            }

            log.error(logPrefix, `Issue Stats request to ${url} failed`, { err });
            throw err;
        });
    }, { minTimeout: 2500, retries: 5 });
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
    const repository = packageJson.repository;

    if (!repository) {
        log.verbose(logPrefix, `No repository field present for ${data.name}, ignoring..`);
        return Promise.resolve(null);
    }

    const gitInfo = hostedGitInfo.fromUrl(repository.url);

    if (!gitInfo || gitInfo.type !== 'github') {
        log.verbose(logPrefix, `Repository for ${data.name} is not hosted on GitHub, ignoring..`, { repository });
        return Promise.resolve(null);
    }

    options = Object.assign({
        tokens: null,          // The GitHub API token to use
        waitRateLimit: false,  // True to wait if handle rate limit for all tokens were exceeded
    }, options);

    const shorthand = `${gitInfo.user}/${gitInfo.project}`;
    const ref = packageJson.gitHead || 'master';

    return promisePropsSettled({
        info: githubRequest(`/repos/${shorthand}`, options),
        contributors: githubRequest(`/repos/${shorthand}/stats/contributors`, options),
        commitActivity: githubRequest(`/repos/${shorthand}/stats/commit_activity`, options),
        statuses: githubRequest(`/repos/${shorthand}/commits/${ref}/statuses`, options),
        issueStats: issueStatsRequest(`/github/${shorthand}`, options),
    })
    .then((data) => {
        const missingData = pull(Object.keys(data).filter((key) => !data[key]), 'issueStats');

        if (missingData.length) {
            log.warn(logPrefix, 'There\'s missing data, returning null..', { missingData });
            return null;
        }

        return deepCompact({
            homepage: data.info.homepage,

            starsCount: data.info.stargazers_count,
            forksCount: data.info.forks_count,
            subscribersCount: data.info.subscribers_count,

            // <3 http://issuestats.com/
            issues: {
                isDisabled: !data.info.has_issues,
                count: data.issueStats && data.issueStats.issues_count,
                openCount: data.issueStats && data.issueStats.open_issues_count,
                distribution: data.issueStats && data.issueStats.basic_distribution,
            },

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
    });
}

module.exports = github;
