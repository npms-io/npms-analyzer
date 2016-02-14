'use strict';

const moment = require('moment');
const findIndex = require('lodash/findIndex');
const find = require('lodash/find');

/**
 * Evaluates the downloads count.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The monthly downloads mean (from 0 to Infinity)
 */
function evaluateDownloadsCount(info) {
    const downloads = info.npm.downloads;
    const index = findIndex(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 90);

    if (index === -1) {
        throw new Error('Could not find days entry in downloads');
    }

    const count90 = downloads[index].count;
    const count30 = count90 / 3;

    return count30;
}

/**
 * Evaluates the downloads acceleration.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The downloads acceleration (from -Infinity to Infinity)
 */
function evaluateDownloadsAcceleration(info) {
    const downloads = info.npm.downloads;

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

    return (mean30 - mean90) * 0.25 +
           (mean90 - mean180) * 0.25 +
           (mean180 - mean365) * 0.5;
}

/**
 * Evaluates the community interest on the module, using its stars, forks, subscribers and contributors count.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The community interest (from 0 to Infinity)
 */
function evaluateCommunityInterest(info) {
    const starsCount = ((info.github && info.github.starsCount) || 0) + info.npm.starsCount;
    const forksCount = (info.github && info.github.forksCount) || 0;
    const subscribersCount = (info.github && info.github.subscribersCount) || 0;
    const contributorsCount = (info.github && info.github.contributors || []).length;

    return starsCount * 0.6 +
           forksCount * 0.10 +
           subscribersCount * 0.10 +
           contributorsCount * 0.20;
}

// ----------------------------------------------------------------------------

/**
 * Evaluates the module's popularity.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {object} The evaluation result
 */
function popularity(info) {
    return {
        communityInterest: evaluateCommunityInterest(info),
        downloadsCount: evaluateDownloadsCount(info),
        downloadsAcceleration: evaluateDownloadsAcceleration(info),
        dependentsCount: info.npm.dependentsCount,
    };
}

module.exports = popularity;
