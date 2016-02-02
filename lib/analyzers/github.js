'use strict';

const log = require('npmlog');
const Promise = require('bluebird');
const got = require('got');
const hostedGitInfo = require('hosted-git-info');
const promiseRetry = require('promise-retry');
const moment = require('moment');
const assign = require('lodash/assign');
const sum = require('lodash/sum');
const pointsToRanges = require('../util/pointsToRanges');

// TODO: Add build status?

const commitActivityBreakpoints = [7, 30, 90, 180, 365];

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
    const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints(commitActivityBreakpoints));

    // Finally map to a prettier array based on the ranges
    return ranges.map((range) => {
        return {
            from: range.from,
            to: range.to,
            count: sum(range.points.map((point) => point.count)),
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
    return promiseRetry((retry) => {
        return got(`https://api.github.com${resource}`, {
            retries: 0,
            json: true,
            timeout: options.timeout,
            headers: options.token ? { Authorization: `token ${options.token}` } : null,
        })
        .then((response) => {
            // If response is 202, it means that there's no cached result so we must
            // wait a bit and retry again
            if (response.statusCode === 202) {
                log.verbose('github', 'Got 202 response for ${resource} (not cached)');
                retry(new Error('Got 202 response for ${resource} (not cached)'));
            }

            return response.body;
        }, (err) => {
            log.error('github', `GitHub request to ${resource} failed`, { err });
            throw err;
        });
    }, { minTimeout: 2500 });
}

/**
 * Utility function to do a request to the Issue Stats API.
 *
 * @param {string} resource The resource path
 * @param {object} options  The options inferred from the github() options
 *
 * @return {Promise} The promise for GitHub response
 */
function issueStatsRequest(resource, options) {
    return got(`http://issuestats.com${resource}`, {
        retries: 0,
        json: true,
        timeout: options.timeout,
    })
    .then((response) => response.body, (err) => {
        log.error('github', `Issue Stats request to ${resource} failed`, { err });
        throw err;
    });
}

/**
 * Runs the github analyzer.
 *
 * @param {object} data      The module data
 * @param {object} [options] The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise that fulfills when done
 */
function github(data, options) {
    const repository = data.repository;

    if (!repository) {
        log.verbose('github', `No repository field present for $(data.name)`);
        return Promise.resolve();
    }

    options = assign({
        timeout: 15000,
        token: null,
    }, options);

    const info = hostedGitInfo.fromUrl(repository.url);

    if (!info || info.type !== 'github') {
        log.verbose('github', 'Repository for $(data.name) is not hosted on GitHub, ignoring..', { repository });
        return Promise.resolve();
    }

    return Promise.all([
        githubRequest(`/repos/${info.user}/${info.project}`, options),
        githubRequest(`/repos/${info.user}/${info.project}/stats/contributors`, options),
        githubRequest(`/repos/${info.user}/${info.project}/stats/commit_activity`, options),
        issueStatsRequest(`/github/${info.user}/${info.project}`, options),
    ])
    .spread((info, contributors, commitActivity, issueStats) => {
        return {
            createdAt: info.created_at,
            homepage: info.homepage,

            starsCount: info.stargazers_count,
            watchersCount: info.watchers_count,
            subscribersCount: info.subscribers_count,
            forksCount: info.forks_count,

            // <3 http://issuestats.com/
            issues: {
                disabled: !info.has_issues ? true : null,
                totalCount: issueStats.issues_count,
                openCount: issueStats.open_issues_count,
                closeTime: issueStats.issue_close_time,
                prCloseTime: issueStats.pr_close_time,
            },

            // Hash where keys are contributors and values their commits count
            contributors: contributors.map((contributor) => {
                return { username: contributor.author.login, commitsCount: contributor.total };
            }),

            commits: extractCommits(commitActivity),
        };
    });
}

module.exports = github;
