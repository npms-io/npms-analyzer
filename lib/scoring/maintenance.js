'use strict';

const moment = require('moment');
const find = require('lodash/find');
const normalizeValue = require('./util/normalizeValue');

/**
 * Calculates the recent commits score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateRecentCommitsScore(analysis) {
    const commits = analysis.github && analysis.github.commits;

    if (!commits) {
        return 0;
    }

    const latestCommitRange = find(commits, (range) => range.count > 0);
    const diffDays = latestCommitRange ? moment.utc(latestCommitRange.to).diff(latestCommitRange.from, 'd') : 365;

    return normalizeValue(diffDays, [
        { value: 30, norm: 1 },
        { value: 90, norm: 0.9 },
        { value: 180, norm: 0.7 },
        { value: 365, norm: 0 },
    ]);
}

/**
 * Calculates the commits frequency score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateCommitsFrequencyScore(analysis) {
    const commits = analysis.github && analysis.github.commits;

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

    const frequency = mean30 * 0.6 +
                      mean180 * 0.3 +
                      mean365 * 0.1;

    return normalizeValue(frequency, [
        { value: 0, norm: 0 },
        { value: 1, norm: 0.6 },
        { value: 3, norm: 0.9 },
        { value: 20, norm: 1 },
    ]);
}

/**
 * Calculates the issues count score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateIssuesCountScore(analysis) {
    const issues = analysis.github && analysis.github.issues;

    if (!issues) {
        return 0;
    }

    const openIssuesPercentage = issues.openCount / issues.count;

    return normalizeValue(openIssuesPercentage, [
        { value: 0.1, norm: 1 },
        { value: 0.3, norm: 0.6 },
        { value: 0.5, norm: 0 },
    ]);
}

/**
 * Calculates the issues distribution score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateIssuesDistributionScore(analysis) {
    const issues = analysis.github && analysis.github.issues;

    if (!issues) {
        return 0;
    }

    const ranges = Object.keys(issues.distribution).map(Number);

    if (!ranges.length) {
        return 0;
    }

    const totalCount = ranges.reduce((sum, range) => sum + issues.distribution[range], 0);
    const weights = ranges.map((range) => {
        const weight = issues.distribution[range] / totalCount;
        const conditioning = normalizeValue(range / 24 / 60 / 60, [
            { value: 29, norm: 1 },
            { value: 365, norm: 5 }, // An issue open for 1 year, weights 5x more than a normal one
        ]);

        return weight * conditioning;
    });

    const mean = ranges.reduce((sum, range, index) => sum + range * weights[index]) / ranges.length;
    const dailyMean = mean / 60 / 60 / 24;

    return normalizeValue(dailyMean, [
        { value: 2, norm: 1 },
        { value: 5, norm: 0.95 },
        { value: 10, norm: 0.85 },
        { value: 30, norm: 0.65 },
        { value: 90, norm: 0.25 },
        { value: 180, norm: 0 },
    ]);
}

// ----------------------------------------------------------------------------

/**
 * Computes the maintenance score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {object} The computed result, containing a `score` property and additional information
 */
function maintenance(analysis) {
    const scores = {
        recentCommits: calculateRecentCommitsScore(analysis),
        commitsFrequency: calculateCommitsFrequencyScore(analysis),
        issuesCount: calculateIssuesCountScore(analysis),
        issuesDistribution: calculateIssuesDistributionScore(analysis),
    };

    return {
        score: scores.recentCommits * 0.3 +
               scores.commitsFrequency * 0.3 +
               scores.issuesCount * 0.15 +
               scores.issuesDistribution * 0.25,
        detail: scores,
    };
}

module.exports = maintenance;
