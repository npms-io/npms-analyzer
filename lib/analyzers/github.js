'use strict';

const Promise = require('bluebird');
const got = require('got');
const assign = require('lodash/assign');
const fromPairs = require('lodash/fromPairs');
const mean = require('lodash/mean');

function githubRequest(resource, options) {
    return got(`https://api.github.com${resource}`, {
        json: true,
        timeout: options.timeout,
        headers: options.token ? { Authorization: `token ${options.token}` } : null,
    })
    .then((response) => response.body);
}

function issueStatsRequest(resource, options) {
    return got(`http://issuestats.com${resource}`, {
        json: true,
        timeout: options.timeout,
    })
    .then((response) => response.body);
}

function github(data, options) {
    options = assign({
        timeout: 15000,
        token: null,
    }, options);

    return Promise.all([
        githubRequest('/repos/IndigoUnited/node-cross-spawn', options),
        githubRequest('/repos/IndigoUnited/node-cross-spawn/stats/contributors', options),
        githubRequest('/repos/IndigoUnited/node-cross-spawn/stats/participation', options),
        issueStatsRequest('/github/IndigoUnited/node-cross-spawn', options),
    ])
    .spread((info, contributors, participations, issueStats) => {
        console.log(participations);
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
