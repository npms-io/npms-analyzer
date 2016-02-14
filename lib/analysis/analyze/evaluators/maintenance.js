'use strict';

const moment = require('moment');
const find = require('lodash/find');
const normalizeValue = require('./util/normalizeValue');

/**
 * Evaluates the recent commits score.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The recent commits evaluation (from 0 to 1)
 */
function evaluateRecentCommits(info) {
    const commits = info.github && info.github.commits;

    if (!commits) {
        return 0;
    }

    const range = find(commits, (range) => range.count > 0);
    const daysSinceLastCommit = range ? moment.utc(range.to).diff(range.from, 'd') : 365;

    return normalizeValue(daysSinceLastCommit, [
        { value: 30, norm: 1 },
        { value: 90, norm: 0.9 },
        { value: 180, norm: 0.5 },
        { value: 365, norm: 0 },
    ]);
}

/**
 * Evaluates the commits frequency.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The commits frequency evaluation (from 0 to 1)
 */
function evaluateCommitsFrequency(info) {
    const commits = info.github && info.github.commits;

    if (!commits) {
        return 0;
    }

    const range30 = find(commits, (range) => moment.utc(range.to).diff(range.from, 'd') === 30);
    const range180 = find(commits, (range) => moment.utc(range.to).diff(range.from, 'd') === 180);
    const range365 = find(commits, (range) => moment.utc(range.to).diff(range.from, 'd') === 365);

    if (!range30 || !range180 || !range365) {
        throw new Error('Could not find days entry in downloads');
    }

    const mean30 = range30.count / (30 / 30);
    const mean180 = range180.count / (180 / 30);
    const mean365 = range365.count / (365 / 30);

    const monthlyMean = mean30 * 0.6 +
                        mean180 * 0.3 +
                        mean365 * 0.1;

    return normalizeValue(monthlyMean, [
        { value: 0, norm: 0 },
        { value: 1, norm: 0.7 },
        { value: 5, norm: 0.9 },
        { value: 10, norm: 1 },
    ]);
}

/**
 * Evaluates the open issues health.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The open issues health evaluation (from 0 to 1)
 */
function evaluateOpenIssues(info) {
    const issues = info.github && info.github.issues;

    if (!issues || issues.isDisabled) {
        return 0;
    }

    const openIssuesRatio = issues.count ? issues.openCount / issues.count : 0;

    return normalizeValue(openIssuesRatio, [
        { value: 0, norm: 1 },
        { value: 0.2, norm: 1 },
        { value: 0.5, norm: 0.5 },
        { value: 1, norm: 0 },
    ]);
}

/**
 * Evaluates the issues distribution evaluation.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The issues distribution evaluation (from 0 to 1)
 */
function evaluateIssuesDistribution(info) {
    const issues = info.github && info.github.issues;

    if (!issues || issues.isDisabled) {
        return 0;
    }

    const ranges = Object.keys(issues.distribution).map(Number);
    const totalCount = ranges.reduce((sum, range) => sum + issues.distribution[range], 0);

    if (!totalCount) {
        return 1;
    }

    const weights = ranges.map((range) => {
        const weight = issues.distribution[range] / totalCount;
        const conditioning = normalizeValue(range / 24 / 60 / 60, [
            { value: 29, norm: 1 },
            { value: 365, norm: 5 }, // An issue open for 1 year, weights 5x more than a normal one
        ]);

        return weight * conditioning;
    });

    const mean = ranges.reduce((sum, range, index) => sum + range * weights[index]) / (ranges.length || 1);
    const issuesOpenMeanDays = mean / 60 / 60 / 24;

    return normalizeValue(issuesOpenMeanDays, [
        { value: 5, norm: 1 },
        { value: 30, norm: 0.7 },
        { value: 90, norm: 0 },
    ]);
}

// ----------------------------------------------------------------------------

/**
 * Evaluates the module's maintenance.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {object} The evaluation result
 */
function maintenance(info) {
    return {
        recentCommits: evaluateRecentCommits(info),
        commitsFrequency: evaluateCommitsFrequency(info),
        openIssues: evaluateOpenIssues(info),
        issuesDistribution: evaluateIssuesDistribution(info),
    };
}

module.exports = maintenance;
