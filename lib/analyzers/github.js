'use strict';

const log = require('npmlog');
const Promise = require('bluebird');
const got = require('got');
const hostedGitInfo = require('hosted-git-info');
const promiseRetry = require('promise-retry');
const moment = require('moment');
const assign = require('lodash/assign');
const deepCompact = require('deep-compact');
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
                log.verbose('github', `Got 202 response for ${resource} (not cached)`);
                retry(new Error(`Got 202 response for ${resource} (not cached)`));
            }

            return response.body;
        }, (err) => {
            // If status is 404, simply return null
            if (err.statusCode === 404) {
                log.verbose('github', `GitHub request to ${resource} failed because the resource does not exist`);
                return null;
            }

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
    const url = `http://issuestats.com${resource}?format=json`;

    return got(url, {
        retries: 0,
        timeout: options.timeout,
    })
    // Need to manually parse the JSON because we need to test for 404 responses
    // See: https://github.com/hstove/issue_stats/issues/38
    .then((response) => {
        try {
            return JSON.parse(response.body);
        } catch (err) {
            if (/couldn't find that page/i.test(response.body)) {
                log.verbose('github', `Issue Stats request to ${resource} failed because the page does not exist`);
                return null;
            }

            err = assign(new Error('Issue Stats response is not valid JSON'),
                { url, response: `${response.slice(0, 100)}..` });

            log.error('github', `Issue Stats response to ${resource} is not valid JSON`, { err });
            throw err;
        }
    }, (err) => {
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
        log.verbose('github', `No repository field present for ${data.name}`);
        return Promise.resolve(null);
    }

    options = assign({
        timeout: 15000,
        token: null,
    }, options);

    const git = hostedGitInfo.fromUrl(repository.url);

    if (!git || git.type !== 'github') {
        log.verbose('github', `Repository for ${data.name} is not hosted on GitHub, ignoring..`, { repository });
        return Promise.resolve();
    }

    return Promise.props({
        info: githubRequest(`/repos/${git.user}/${git.project}`, options),
        contributors: githubRequest(`/repos/${git.user}/${git.project}/stats/contributors`, options),
        commitActivity: githubRequest(`/repos/${git.user}/${git.project}/stats/commit_activity`, options),
        issueStats: issueStatsRequest(`/github/${git.user}/${git.project}`, options),
    })
    .then((responses) => {
        const missing = Object.keys(responses).filter((key) => !responses[key]);

        if (missing.length) {
            log.warn('github', `Can't analyze because there's missing information`, { missing });
            return null;
        }

        // TODO: The github contributors response is very limited.. it does not return the user name nor emails :/
        //       Ideally we should use git itself but it requires us to clone the repos: git shortlog -sn
        //       If we ever do this, we should create a git.js analyzer and move contributors & commits there

        return deepCompact({
            homepage: responses.info.homepage,

            starsCount: responses.info.stargazers_count,
            forksCount: responses.info.forks_count,
            subscribersCount: responses.info.subscribers_count,

            // <3 http://issuestats.com/
            issues: {
                disabled: responses.info.has_issues,
                count: responses.issueStats.issues_count,
                openCount: responses.issueStats.open_issues_count,
                closeTime: responses.issueStats.issue_close_time,
                prCloseTime: responses.issueStats.pr_close_time,
            },

            // Contributors (top 100)
            contributors: responses.contributors.map((contributor) => {
                return { username: contributor.author.login, commitsCount: contributor.total };
            }),

            // Commit activity
            commits: extractCommits(responses.commitActivity),
        });
    });
}

module.exports = github;
