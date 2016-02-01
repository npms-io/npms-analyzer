'use strict';

const Promise = require('bluebird');
const log = require('npmlog');
const got = require('got');
const moment = require('moment');
const assign = require('lodash/assign');
const mean = require('lodash/mean');
const sum = require('lodash/sum');
const findIndex = require('lodash/findIndex');
const size = require('lodash/size');

/**
 * Filters the download ranges from the api.npmjs.org response and filters only
 * the ones that are higher than `minDate`.
 *
 * @param {array}  ranges  The downloads range array
 * @param {string} minDate The minimum date to filter
 *
 * @return {array} The filtered ranges
 */
function filterDownloadsRanges(ranges, minDate) {
    const dayStr = minDate.format('YYYY-MM-DD');
    const index = findIndex(ranges, (entry) => entry.day > dayStr);

    if (index === -1) {
        return [];
    }

    return ranges.slice(index).map((range) => range.downloads);
}

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
    const baseDate = moment().subtract(1, 'd').startOf('day');
    const range = {
        start: baseDate.clone().subtract(1, 'y').format('YYYY-MM-DD'),
        end: baseDate.clone().format('YYYY-MM-DD'),
    };

    return got(`https://api.npmjs.org/downloads/range/${range.start}:${range.end}/${name}`, {
        json: true,
        retries: 0,
        timeout: options.timeout,
    })
    .then((res) => res.body.downloads)
    .then((ranges) => {
        const downloads = {
            lastDayCount: sum(filterDownloadsRanges(ranges, baseDate.clone().subtract(1, 'd'))),
            last7daysCount: sum(filterDownloadsRanges(ranges, baseDate.clone().subtract(7, 'd'))),
            last30daysCount: sum(filterDownloadsRanges(ranges, baseDate.clone().subtract(30, 'd'))),

            last90daysMean: mean(filterDownloadsRanges(ranges, baseDate.clone().subtract(90, 'd'))),
            last365daysMean: mean(filterDownloadsRanges(ranges, baseDate.clone().subtract(365, 'd'))),
        };

        downloads.acceleration = (downloads.last90daysMean - downloads.last365daysMean) / (365 - 90);

        return downloads;
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
 * @param {string} name    The module name
 * @param {Nano}   npmNano The client nano instance for npm
 *
 * @return {Promise} The promise for the stars count
 */
function fetchStarsCount(name, npmNano) {
    return npmNano.getAsync(name)
    .then((doc) => {
        return doc.users ? size(doc.users) : 0;
    }, (err) => {
        log.error('npm', 'Error fetching stars count', { err });
        throw err;
    });
}

/**
 * Runs the npm analyzer, adding a `npm` entry into `data.analysis`.
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

    return Promise.all([
        fetchDownloads(data.name, { timeout: options.npmjsTimeout }),
        fetchDependentsCount(data.name, npmNano),
        fetchStarsCount(data.name, npmNano),
    ])
    .spread((downloads, dependentsCount, starsCount) => {
        data.analysis = data.analysis || {};
        data.analysis.npm = {
            downloads,
            dependentsCount,
            starsCount,
        };
    });
}

module.exports = npm;
