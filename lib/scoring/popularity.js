'use strict';

const moment = require('moment');
const findIndex = require('lodash/findIndex');
const find = require('lodash/find');
const get = require('lodash/get');
const scalarToScore = require('./util/scalarToScore');

function calculateDownloadsCountScore(downloads) {
    const index = findIndex(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 90);

    if (index === -1) {
        throw new Error('Could not find days entry in downloads');
    }

    const count90 = downloads[index].count;
    const count30 = count90 / 3;

    return scalarToScore(count30, [
        { value: 10000, score: 0.6 },
        { value: 100000, score: 0.8 },
        { value: 500000, score: 0.9 },
        { value: 1000000, score: 0.95 },
        { value: 2000000, score: 1 },
    ]);
}

function calculateDownloadsAccelerationScore(downloads) {
    const downloads30 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 30);
    const downloads90 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 90);
    const downloads180 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 180);
    const downloads365 = find(downloads, (range) => moment.utc(range.to).diff(range.from, 'd') === 365);

    if (!downloads30 || !downloads90 || !downloads180 || !downloads365) {
        throw new Error('Could not find days entry in downloads');
    }

    const mean30 = downloads30.count / 30;
    const mean90 = downloads90.count / 90;
    const mean180 = downloads180.count / 180;
    const mean365 = downloads365.count / 365;

    const acceleration = (mean30 - mean90) * 0.25 +
                         (mean90 - mean180) * 0.25 +
                         (mean180 - mean365) * 0.5;

    return scalarToScore(acceleration, [
        { value: 1, score: 0.1 },
        { value: 2500, score: 0.7 },
        { value: 5000, score: 0.9 },
        { value: 10000, score: 1 },
    ]);
}

function popularity(analysis) {
    const scores = {
        starsCount: scalarToScore(get(analysis.github, 'starsCount', 0) + analysis.npm.starsCount, [
            { value: 5, score: 0.2 },
            { value: 10, score: 0.5 },
            { value: 50, score: 0.7 },
            { value: 150, score: 0.8 },
            { value: 1000, score: 0.9 },
            { value: 10000, score: 1 },
        ]),
        forksCount: scalarToScore(get(analysis.github, 'forksCount', 0), [
            { value: 10, score: 0.4 },
            { value: 100, score: 0.7 },
            { value: 500, score: 0.9 },
            { value: 1000, score: 1 },
        ]),
        subscribersCount: scalarToScore(get(analysis.github, 'subscribersCount', 0), [
            { value: 10, score: 0.4 },
            { value: 100, score: 0.7 },
            { value: 500, score: 0.9 },
            { value: 1000, score: 1 },
        ]),
        // TODO: Merge with npm contributors if we ever manage to do git.js analyzer
        contributorsCount: scalarToScore(get(analysis.github, 'contributors', []).length, [
            { value: 5, score: 0.5 },
            { value: 100, score: 1 },
        ]),
        dependentsCount: scalarToScore(analysis.npm.dependentsCount, [
            { value: 10, score: 0.4 },
            { value: 50, score: 0.7 },
            { value: 500, score: 0.9 },
            { value: 5000, score: 1 },
        ]),
        downloadsCount: calculateDownloadsCountScore(analysis.npm.downloads),
        downloadsAcceleration: calculateDownloadsAccelerationScore(analysis.npm.downloads),
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
