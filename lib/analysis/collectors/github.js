'use strict';

const log = require('npmlog');
const Promise = require('bluebird');
const got = require('got');
const hostedGitInfo = require('hosted-git-info');
const promiseRetry = require('promise-retry');
const moment = require('moment');
const deepCompact = require('deep-compact');
const assign = require('lodash/assign');
const uniqBy = require('lodash/uniqBy');
const pick = require('lodash/pick');
const pointsToRanges = require('./util/pointsToRanges');

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
 * @param {object} options  The options inferred from the github() options
 *
 * @return {Promise} The promise for GitHub response
 */
function githubRequest(resource, options) {
    const url = `https://api.github.com${resource}`;

    return promiseRetry((retry) => {
        return got(url, {
            retries: 0,
            json: true,
            timeout: 15000,
            headers: options.token ? { Authorization: `token ${options.token}` } : null,
        })
        .then((response) => {
            // If response is 202, it means that there's no cached result so we must
            // wait a bit and retry again
            if (response.statusCode === 202) {
                log.verbose('github', `Got 202 response for ${url} (not cached)`);
                retry(new Error(`Got 202 response for ${url} (not cached)`));
            }

            return response.body;
        }, (err) => {
            // If status is 404, simply return null
            if (err.statusCode === 404) {
                log.verbose('github', `GitHub request to ${url} failed with 404`, { err });
                return null;
            }

            log.error('github', `GitHub request to ${url} failed`, { err });
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
        return got(url, {
            retries: 0,
            timeout: 15000,
        })
        .then((response) => {
            let issueStats;

            // Need to manually parse the JSON because we need to test for 404 responses
            // See: https://github.com/hstove/issue_stats/issues/38
            try {
                issueStats = JSON.parse(response.body);
            } catch (err) {
                if (/couldn't find that page/i.test(response.body)) {
                    log.verbose('github', `Issue Stats request to ${url} failed because the page does not exist`);
                    return null;
                }

                err = assign(new Error('Issue Stats response is not valid JSON'),
                    { url, response: `${response.slice(0, 100)}..` });

                log.error('github', `Issue Stats response to ${url} is not valid JSON`, { err });
                throw err;
            }

            // Check if the results are valid or if we need to wait a bit and retry again
            if (issueStats.issues_count == null) {
                log.verbose('github', `Issue Stats response for ${url} does not have valid information yet`);
                retry(new Error(`Issue Stats response for ${url} does not have valid information yet`));
            }

            return issueStats;
        }, (err) => {
            // If status is 404, simply return null
            if (err.statusCode === 404) {
                log.verbose('github', `Issue Stats request to ${url} failed with 404`, { err });
                return null;
            }

            log.error('github', `Issue Stats request to ${url} failed`, { err });
            throw err;
        });
    }, { minTimeout: 2500, retries: 5 });
}

// ----------------------------------------------------------------------------

/**
 * Runs the github analyzer.
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
        log.verbose('github', `No repository field present for ${data.name}, ignoring..`);
        return Promise.resolve(null);
    }

    options = assign({
        token: null,
    }, options);

    const gitInfo = hostedGitInfo.fromUrl(repository.url);

    if (!gitInfo || gitInfo.type !== 'github') {
        log.verbose('github', `Repository for ${data.name} is not hosted on GitHub, ignoring..`, { repository });
        return Promise.resolve();
    }

    const ref = packageJson.gitHead || 'master';

    return Promise.props({
        info: githubRequest(`/repos/${gitInfo.user}/${gitInfo.project}`, options),
        contributors: githubRequest(`/repos/${gitInfo.user}/${gitInfo.project}/stats/contributors`, options),
        commitActivity: githubRequest(`/repos/${gitInfo.user}/${gitInfo.project}/stats/commit_activity`, options),
        statuses: githubRequest(`/repos/${gitInfo.user}/${gitInfo.project}/commits/${ref}/statuses`, options),
        issueStats: issueStatsRequest(`/github/${gitInfo.user}/${gitInfo.project}`, options),
    })
    .then((data) => {
        const missingData = Object.keys(data).filter((key) => !data[key]);

        if (missingData.length) {
            log.warn('github', `Can't analyze because there's missing data`, { missingData });
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
                count: data.issueStats.issues_count,
                openCount: data.issueStats.open_issues_count,
                distribution: data.issueStats.basic_distribution,
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
