'use strict';

const spdx = require('spdx');
const log = require('npmlog');
const Promise = require('bluebird');
const moment = require('moment');
const pointsToRanges = require('../util/pointsToRanges');

const releasesBreakpoints = [30, 90, 180, 365, 730];

/**
 * Extracts the module releases frequency.
 *
 * @param {object} data The module data
 *
 * @return {object} An object containing information about the first and last releases as well as release frequency
 */
function extractReleasesFrequency(data) {
    // Aggregate the releases into ranges
    const time = data.time;
    const points = Object.keys(time).map((version) => { return { date: moment.utc(time[version]), version }; });
    const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints(releasesBreakpoints));

    // Build the releases frequency array based on the releases ranges
    return ranges.map((range) => {
        return { from: range.from, to: range.to, count: range.points.length };
    });
}

/**
 * Extracts the license from the module's data.
 * Attempts to normalize deprecated usages to valid SPDX license.
 *
 * @param {object} data The module data
 *
 * @return {string} The license.
 */
function extractLicense(data) {
    let parsedLicense = data.license;

    // Some old packages used objects or an array of objects to specify licenses
    // We do some minimal parsing to transform those into valid SPDX license expressions
    if (Array.isArray(parsedLicense)) {
        parsedLicense = parsedLicense.reduce((str, entry) => {
            str += (str ? ' OR ' : '') + entry.type;
            return str;
        }, '');
    } else if (typeof parsedLicense === 'object') {
        parsedLicense = parsedLicense.type;
    }

    // Validate the LICENSE
    if (typeof parsedLicense !== 'string' || !spdx.valid(parsedLicense)) {
        log.warn('metadata', `Invalid SPDX license for module $(data.name)`, { name: data.name,
            license: data.license });
        return null;
    }

    return parsedLicense;
}

/**
 * Runs the metadata analyzer.
 *
 * @param {object} data      The module data
 *
 * @return {Promise} The promise that fulfills when done
 */
function metadata(data) {
    return Promise.try(() => {
        const versions = Object.keys(data.versions);

        return {
            name: data.name,
            description: data.description,
            keywords: data.keywords,
            readme: data.readmeFilename ? data.readme : null,

            author: data.author,
            maintainers: data.maintainers,
            contributors: data.contributors,

            repository: data.repository,
            homepage: data.homepage,
            license: extractLicense(data),

            releases: {
                latest: { version: versions[versions.length - 1], date: data.time.modified },
                first: { version: versions[0], date: data.time.created },
                frequency: extractReleasesFrequency(data),
            },

            deprecated: versions[versions.length - 1].deprecated ? true : null,
        };
    });
}

module.exports = metadata;
