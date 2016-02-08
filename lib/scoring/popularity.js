'use strict';

const moment = require('moment');
const findIndex = require('lodash/findIndex');
const find = require('lodash/find');
const normalizeValue = require('./util/normalizeValue');

/**
 * Calculates the downloads count score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateDownloadsCountScore(analysis) {
    const downloads = analysis.npm.downloads;
    const index = findIndex(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 90);

    if (index === -1) {
        throw new Error('Could not find days entry in downloads');
    }

    const count90 = downloads[index].count;
    const count30 = count90 / 3;

    return normalizeValue(count30, [
        { value: 0, norm: 0 },
        { value: 10000, norm: 0.6 },
        { value: 100000, norm: 0.8 },
        { value: 500000, norm: 0.9 },
        { value: 1000000, norm: 0.95 },
        { value: 2000000, norm: 1 },
    ]);
}

/**
 * Calculates the downloads acceleration score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateDownloadsAccelerationScore(analysis) {
    const downloads = analysis.npm.downloads;

    const range30 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 30);
    const range90 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 90);
    const range180 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 180);
    const range365 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 365);

    if (!range30 || !range90 || !range180 || !range365) {
        throw new Error('Could not find days entry in downloads');
    }

    const mean30 = range30.count / 30;
    const mean90 = range90.count / 90;
    const mean180 = range180.count / 180;
    const mean365 = range365.count / 365;

    const acceleration = (mean30 - mean90) * 0.25 +
                         (mean90 - mean180) * 0.25 +
                         (mean180 - mean365) * 0.5;

    return normalizeValue(acceleration, [
        { value: 0, norm: 0 },
        { value: 2500, norm: 0.7 },
        { value: 5000, norm: 0.9 },
        { value: 10000, norm: 1 },
    ]);
}

/**
 * Calculates the stars count score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateStarsCountScore(analysis) {
    return normalizeValue((analysis.github ? analysis.github.starsCount : 0) + analysis.npm.starsCount, [
        { value: 0, norm: 0 },
        { value: 5, norm: 0.2 },
        { value: 10, norm: 0.5 },
        { value: 50, norm: 0.7 },
        { value: 150, norm: 0.8 },
        { value: 1000, norm: 0.9 },
        { value: 10000, norm: 1 },
    ]);
}

/**
 * Calculates the forks count score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateForksCountScore(analysis) {
    return normalizeValue(analysis.github ? analysis.github.forksCount : 0, [
        { value: 0, norm: 0 },
        { value: 10, norm: 0.4 },
        { value: 100, norm: 0.7 },
        { value: 500, norm: 0.9 },
        { value: 1000, norm: 1 },
    ]);
}

/**
 * Calculates the contributors score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateContributorsCountScore(analysis) {
    return normalizeValue(analysis.github ? analysis.github.contributors.length : 0, [
        { value: 0, norm: 0 },
        { value: 5, norm: 0.5 },
        { value: 100, norm: 1 },
    ]);
}

/**
 * Calculates the subscribers count score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateSubscribersCountScore(analysis) {
    // TODO: Merge with npm contributors if we ever manage to do git.js analyzer
    return normalizeValue(analysis.github ? analysis.github.subscribersCount : 0, [
        { value: 0, norm: 0 },
        { value: 10, norm: 0.4 },
        { value: 100, norm: 0.7 },
        { value: 500, norm: 0.9 },
        { value: 1000, norm: 1 },
    ]);
}

/**
 * Calculates the dependents count score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {number} The score
 */
function calculateDependentsCountScore(analysis) {
    return normalizeValue(analysis.npm.dependentsCount, [
        { value: 0, norm: 0 },
        { value: 10, norm: 0.4 },
        { value: 50, norm: 0.7 },
        { value: 500, norm: 0.9 },
        { value: 5000, norm: 1 },
    ]);
}

// ----------------------------------------------------------------------------

/**
 * Computes the popularity score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {object} The computed result, containing a `score` property and additional information
 */
function popularity(analysis) {
    const scores = {
        starsCount: calculateStarsCountScore(analysis),
        forksCount: calculateForksCountScore(analysis),
        subscribersCount: calculateSubscribersCountScore(analysis),
        contributorsCount: calculateContributorsCountScore(analysis),
        dependentsCount: calculateDependentsCountScore(analysis),
        downloadsCount: calculateDownloadsCountScore(analysis),
        downloadsAcceleration: calculateDownloadsAccelerationScore(analysis),
    };

    return {
        score: (scores.starsCount * 0.2) +
               (scores.forksCount * 0.05) +
               (scores.subscribersCount * 0.05) +
               (scores.contributorsCount * 0.15) +
               (scores.dependentsCount * 0.2) +
               (scores.downloadsCount * 0.25) +
               (scores.downloadsAcceleration * 0.1),
        detail: scores,
    };
}

module.exports = popularity;
