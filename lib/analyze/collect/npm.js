'use strict';

const got = require('got');
const moment = require('moment');
const size = require('lodash/size');
const pointsToRanges = require('./util/pointsToRanges');
const promisePropsSettled = require('./util/promisePropsSettled');
const gotRetry = require('../util/gotRetry');

const log = logger.child({ module: 'collect/npm' });

/**
 * Fetches the download count from https://api.npmsjs.org/downloads
 *
 * @see https://github.com/npm/download-counts
 *
 * @param {string} name The package name
 *
 * @return {Promise} The promise for the downloads object
 */
function fetchDownloads(name) {
    const requestRange = {
        from: moment.utc().subtract(1, 'd').startOf('day').subtract(365, 'd').format('YYYY-MM-DD'),
        to: moment.utc().subtract(1, 'd').startOf('day').format('YYYY-MM-DD'),
    };
    const url = `https://api.npmjs.org/downloads/range/${requestRange.from}:${requestRange.to}/${encodeURIComponent(name)}`;

    return got(url, {
        json: true,
        timeout: 15000,
        retry: gotRetry,
    })
    .then((res) => res.body.downloads)
    // Check if there is no stats yet
    .catch({ statusCode: 404 }, () => [])
    .then((downloads) => {
        // Aggregate the data into ranges
        const points = downloads.map((entry) => { return { date: moment.utc(entry.day), count: entry.downloads }; });
        const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints([1, 7, 30, 90, 180, 365]));

        // Finally map to a prettier array based on the ranges, calculating the mean and count for each range
        return ranges.map((range) => {
            const downloadsCount = range.points.reduce((sum, point) => sum + point.count, 0);

            return {
                from: range.from,
                to: range.to,
                count: downloadsCount,
            };
        });
    })
    .catch((err) => {
        log.error({ err, url }, `Failed to fetch ${name} downloads`);
        throw err;
    });
}

/**
 * Fetches the dependents count.
 *
 * @param {string} name    The package name
 * @param {Nano}   npmNano The client nano instance for npm
 *
 * @return {Promise} The promise for the dependents count
 */
function fetchDependentsCount(name, npmNano) {
    return npmNano.viewAsync('app', 'dependedUpon', {
        startkey: [name],
        endkey: [name, '\ufff0'],
        limit: 1,
        reduce: true,
        stale: 'update_after',
    })
    .then((response) => !response.rows.length ? 0 : response.rows[0].value)
    .catch((err) => {
        /* istanbul ignore next */
        log.error({ err }, `Failed to fetch ${name} dependents count from CouchDB`);
        /* istanbul ignore next */
        throw err;
    });
}

/**
 * Extract the stars count.
 *
 * @param {object} data The package data
 *
 * @return {number} The number of stars
 */
function extractStarsCount(data) {
    // The users that starred are stored in the package data itself under the `users` property
    return size(data.users);
}

// ----------------------------------------------------------------------------

/**
 * Runs the npm analyzer.
 *
 * @param {object} data        The package data
 * @param {object} packageJson The latest package.json data (normalized)
 * @param {Nano}   npmNano     The client nano instance for npm
 *
 * @return {Promise} The promise that fulfills when done
 */
function npm(data, packageJson, npmNano) {
    return promisePropsSettled({
        downloads: fetchDownloads(packageJson.name, { timeout: 15000 }),
        dependentsCount: fetchDependentsCount(packageJson.name, npmNano),
        starsCount: extractStarsCount(data),
    })
    .tap(() => log.debug(`The npm collector for ${packageJson.name} completed successfully`));
}

module.exports = npm;
