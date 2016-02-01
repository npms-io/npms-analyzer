'use strict';

const log = require('npmlog');
const Promise = require('bluebird');
const got = require('got');
const hostedGitInfo = require('hosted-git-info');
const promiseRetry = require('promise-retry');
const assign = require('lodash/assign');
const fromPairs = require('lodash/fromPairs');
const mean = require('lodash/mean');

// TODO: Add build status?

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
                log.verbose('github', 'GitHub response not cached');
                retry(new Error('GitHub response not cached'));
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
 * Runs the github analyzer, adding a `github` entry into `data.analysis`.
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
        githubRequest(`/repos/${info.user}/${info.project}/stats/participation`, options),
        issueStatsRequest(`/github/${info.user}/${info.project}`, options),
    ])
    .spread((info, contributors, participations, issueStats) => {
        data.analysis = data.analysis || {};
        data.analysis.github = {
            createdAt: info.created_at,
            starsCount: info.stargazers_count,
            watchersCount: info.watchers_count,
            subscribersCount: info.subscribers_count,
            forksCount: info.forks_count,

            // <3 issuesstats.com
            issues: {
                totalCount: issueStats.issues_count,
                openCount: issueStats.open_issues_count,
                closeTime: issueStats.issue_close_time,
                prCloseTime: issueStats.pr_close_time,
            },

            // Hash where keys are contributors and values their commits count
            contributors: fromPairs(contributors.map((contributor) => {
                return [contributor.author.login, contributor.total];
            })),

            // Mean of commits peer week, where recent weeks have more weight
            activity: mean(participations.all.slice(0, 26)) * 0.15 +
                      mean(participations.all.slice(26, 39)) * 0.35 +
                      mean(participations.all.slice(39)) * 0.5,
        };
    });
}

module.exports = github;
