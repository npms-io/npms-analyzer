'use strict';

const Promise = require('bluebird');
const log = require('npmlog');
const got = require('got');
const moment = require('moment');
const assign = require('lodash/assign');
const sum = require('lodash/sum');
const size = require('lodash/size');
const pointsToRanges = require('../util/pointsToRanges');

const downloadsBreakpoints = [1, 7, 30, 90, 365];

/**
 * Fetches the download count from https://api.npmsjs.org/downloads
 *
 * @see https://github.com/npm/download-counts
 *
 * @param {string} name    The module name
 * @param {object} options The options inferred from the npms() options
 *
 * @return {Promise} The promise for the downloads object
 */
function fetchDownloads(name, options) {
    const requestRange = {
        from: moment.utc().subtract(1, 'd').startOf('day').subtract(365, 'd').format('YYYY-MM-DD'),
        to: moment.utc().subtract(1, 'd').startOf('day').format('YYYY-MM-DD'),
    };

    return got(`https://api.npmjs.org/downloads/range/${requestRange.from}:${requestRange.to}/${name}`, {
        json: true,
        retries: 0,
        timeout: options.timeout,
    })
    .then((res) => res.body.downloads)
    .then((downloads) => {
        // Aggregate the data into ranges
        const points = downloads.map((entry) => { return { date: moment.utc(entry.day), count: entry.downloads }; });
        const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints(downloadsBreakpoints));

        // Finally map to a prettier array based on the ranges, calculating the mean and count for each range
        return ranges.map((range) => {
            const downloadsCount = sum(range.points.map((point) => point.count));

            return {
                from: range.from,
                to: range.to,
                count: downloadsCount,
                countPerDay: downloadsCount / range.days,
            };
        });
    });
}

/**
 * Fetches the dependents count.
 *
 * @param {string} name    The module name
 * @param {Nano}   npmNano The client nano instance for npm
 *
 * @return {Promise} The promise for the dependents count
 */
function fetchDependentsCount(name, npmNano) {
    return npmNano.viewAsync('app', 'dependedUpon', {
        startkey: [name],
        endkey: [name, {}],
        limit: 1,
        stale: 'update_after',
        reduce: true,
    })
    .then((res) => {
        return !res.rows.length ? 0 : res.rows[0].value;
    }, (err) => {
        log.error('npm', 'Error fetching dependents count', { err });
        throw err;
    });
}

/**
 * Fetches the stars count.
 *
 * @param {object} data The module data
 *
 * @return {Promise} The promise for the stars count
 */
function fetchStarsCount(data) {
    // The users that starred are stored in the module data itself under the `users` property
    // We could get the document from the npm couchdb, but is unnecessary
    return Promise.try(() => {
        return data.users ? size(data.users) : 0;
    });
}

/**
 * Runs the npm analyzer.
 *
 * @param {object} data      The module data
 * @param {Nano}   npmNano   The client nano instance for npm
 * @param {object} [options] The options; read bellow to get to know each available option
 *
 * @return {Promise} The promise that fulfills when done
 */
function npm(data, npmNano, options) {
    options = assign({
        npmjsTimeout: 10000,   // Default timeout for the api.npmjs.org requests
    }, options);

    return Promise.props({
        downloads: fetchDownloads(data.name, { timeout: options.npmjsTimeout }),
        dependentsCount: fetchDependentsCount(data.name, npmNano),
        starsCount: fetchStarsCount(data.name, npmNano),
    });
}

module.exports = npm;
