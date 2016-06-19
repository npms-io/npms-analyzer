'use strict';

const moment = require('moment');
const find = require('lodash/find');
const normalizeValue = require('./util/normalizeValue');

/**
 * Evaluates the releases frequency.
 *
 * @param {object} collected The collected information
 *
 * @return {number} The releases frequency evaluation (from 0 to 1)
 */
function evaluateReleasesFrequency(collected) {
    const releases = collected.metadata.releases;

    const range30 = find(releases, (range) => moment.utc(range.to).diff(range.from, 'd') === 30);
    const range180 = find(releases, (range) => moment.utc(range.to).diff(range.from, 'd') === 180);
    const range365 = find(releases, (range) => moment.utc(range.to).diff(range.from, 'd') === 365);
    const range730 = find(releases, (range) => moment.utc(range.to).diff(range.from, 'd') === 730);

    if (!range30 || !range180 || !range365 || !range730) {
        throw new Error('Could not find entry in releases');
    }

    const mean30 = range30.count / (30 / 90);
    const mean180 = range180.count / (180 / 90);
    const mean365 = range365.count / (365 / 90);
    const mean730 = range365.count / (730 / 90);

    const quarterMean = mean30 * 0.25 +
                        mean180 * 0.45 +
                        mean365 * 0.2 +
                        mean730 * 0.1;

    return normalizeValue(quarterMean, [
        { value: 0, norm: 0 },
        { value: 0.5, norm: 0.5 },
        { value: 1, norm: 0.75 },
        { value: 2, norm: 1 },
    ]);
}

/**
 * Evaluates the commits frequency.
 *
 * @param {object} collected The collected information
 *
 * @return {number} The commits frequency evaluation (from 0 to 1)
 */
function evaluateCommitsFrequency(collected) {
    const commits = collected.github && collected.github.commits;

    if (!commits) {
        return 0;
    }

    const range30 = find(commits, (range) => moment.utc(range.to).diff(range.from, 'd') === 30);
    const range180 = find(commits, (range) => moment.utc(range.to).diff(range.from, 'd') === 180);
    const range365 = find(commits, (range) => moment.utc(range.to).diff(range.from, 'd') === 365);

    if (!range30 || !range180 || !range365) {
        throw new Error('Could not find entry in commits');
    }

    const mean30 = range30.count / (30 / 30);
    const mean180 = range180.count / (180 / 30);
    const mean365 = range365.count / (365 / 30);

    const monthlyMean = mean30 * 0.35 +
                        mean180 * 0.45 +
                        mean365 * 0.2;

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
 * @param {object} collected The collected information
 *
 * @return {number} The open issues health evaluation (from 0 to 1)
 */
function evaluateOpenIssues(collected) {
    const issues = collected.github && collected.github.issues;

    // If unable to get issues, evaluation is 0
    if (!issues) {
        return 0;
    }

    // If issues are disabled, return 0.5..
    // We can't really evaluate something we don't know; if this value causes troubles find a better strategy
    if (issues.isDisabled) {
        return collected.github.forkOf ? 0.7 : 0.5;  // Forks have issues disabled by default, don't be so harsh
    }

    // If the repository has 0 issues, evaluation is 0.7
    if (!issues.count) {
        return 0.7;
    }

    const openIssuesRatio = issues.openCount / issues.count;

    return normalizeValue(openIssuesRatio, [
        { value: 0.2, norm: 1 },
        { value: 0.5, norm: 0.5 },
        { value: 1, norm: 0 },
    ]);
}

/**
 * Evaluates the issues distribution evaluation.
 *
 * @param {object} collected The collected information
 *
 * @return {number} The issues distribution evaluation (from 0 to 1)
 */
function evaluateIssuesDistribution(collected) {
    const issues = collected.github && collected.github.issues;

    // If unable to get issues, evaluation is 0
    if (!issues) {
        return 0;
    }

    // If issues are disabled, return 0.5..
    // We can't really evaluate something we don't know; if this value causes troubles find a better strategy
    if (issues.isDisabled) {
        return collected.github.forkOf ? 0.7 : 0.5;  // Forks have issues disabled by default, don't be so harsh
    }

    const ranges = Object.keys(issues.distribution).map(Number);
    const totalCount = ranges.reduce((sum, range) => sum + issues.distribution[range], 0);

    // If the repository has 0 issues, evaluation is 0.7
    if (!totalCount) {
        return 0.7;
    }

    const weights = ranges.map((range) => {
        const weight = issues.distribution[range] / totalCount;
        const conditioning = normalizeValue(range / 24 / 60 / 60, [
            { value: 29, norm: 1 },
            { value: 365, norm: 5 }, // An issue open for more than 1 year, weights 5x more than a normal one
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
 * Evaluates the module maintenance.
 *
 * @param {object} collected The collected information
 *
 * @return {object} The evaluation result
 */
function maintenance(collected) {
    return {
        releasesFrequency: evaluateReleasesFrequency(collected),
        commitsFrequency: evaluateCommitsFrequency(collected),
        openIssues: evaluateOpenIssues(collected),
        issuesDistribution: evaluateIssuesDistribution(collected),
    };
}

module.exports = maintenance;
