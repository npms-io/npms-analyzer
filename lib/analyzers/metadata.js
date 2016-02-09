'use strict';

const log = require('npmlog');
const Promise = require('bluebird');
const moment = require('moment');
const spdx = require('spdx');
const spdxCorrect = require('spdx-correct');
const prependHttp = require('prepend-http');
const deepCompact = require('deep-compact');
const get = require('lodash/get');
const pointsToRanges = require('./util/pointsToRanges');

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
    const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints([30, 90, 180, 365, 730]));

    // Build the releases frequency array based on the releases ranges
    return ranges.map((range) => {
        return { from: range.from, to: range.to, count: range.points.length };
    });
}

/**
 * Extracts the license from the module's data.
 * Attempts to normalize deprecated usages to valid SPDX license.
 *
 * @param {object} data        The module data
 * @param {object} packageJson The latest package.json object
 *
 * @return {string} The license.
 */
function extractLicense(data, packageJson) {
    let license = data.license || packageJson.licenses;

    // Short-circuit for modules without a license
    if (license == null) {
        log.silly('metadata', `No license for module ${data.name} is set`);
        return null;
    }

    // Some old packages used objects or an array of objects to specify licenses
    // We do some minimal parsing to transform those into SPDX license expressions
    if (Array.isArray(license)) {
        license = license.reduce((str, entry) => {
            str += (str ? ' OR ' : '') + entry.type;
            return str;
        }, '');
    } else if (typeof license === 'object') {
        license = license.type;
    }

    // Ensure that the license is a non-empty string
    if (typeof license !== 'string' || !license) {
        log.silly('metadata', `Invalid license for module ${data.name} was found`,
            { name: data.name, license: data.license });
        return null;
    }

    // UNLICENSED = not licensed
    if (/^UNLICENSED$/i.test(license)) {
        log.verbose('metadata', `Module ${data.name} is unlicensed`);
        return null;
    }

    if (!spdx.valid(license)) {
        const correctedLicense = spdxCorrect(license);

        if (correctedLicense) {
            log.verbose('metadata', `Module ${data.name} license was corrected from ${license} to ${correctedLicense}`);
            license = correctedLicense;
        } else {
            log.verbose('metadata', `License for module ${data.name} is not a valid SPDX indentifier`,
                { name: data.name, license: data.license });
            license = null;
        }
    }

    return license;
}

// ----------------------------------------------------------------------------

/**
 * Runs the metadata analyzer.
 *
 * @param {object} data The module data
 *
 * @return {Promise} The promise that fulfills when done
 */
function metadata(data) {
    return Promise.try(() => {
        const versions = Object.keys(data.versions);
        const packageJson = data.versions[versions[versions.length - 1]];

        return deepCompact({
            name: data.name,
            description: data.description,
            keywords: data.keywords,
            readme: data.readmeFilename && data.readme,

            author: data.author,
            maintainers: data.maintainers,
            contributors: data.contributors,

            repository: data.repository,
            homepage: data.homepage,
            homepage: packageJson.homepage && prependHttp(packageJson.homepage),
            license: extractLicense(data, packageJson),

            releases: {
                latest: { version: versions[versions.length - 1], date: data.time.modified },
                first: { version: versions[0], date: data.time.created },
                frequency: extractReleasesFrequency(data),
            },

            deprecated: packageJson.deprecated,
            hasTestScript: (get(packageJson, 'scripts.test') || '').indexOf('no test specified') === -1,
        });
    });
}

module.exports = metadata;
