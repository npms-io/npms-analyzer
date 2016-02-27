'use strict';

const log = require('npmlog');
const Promise = require('bluebird');
const moment = require('moment');
const spdx = require('spdx');
const spdxCorrect = require('spdx-correct');
const deepCompact = require('deep-compact');
const get = require('lodash/get');
const pointsToRanges = require('./util/pointsToRanges');

const logPrefix = 'collect/metadata';

/**
 * Extracts the module releases frequency.
 *
 * @param {object} data The module data
 *
 * @return {array} An array of ranges with the release count for each entry
 */
function extractReleasesFrequency(data) {
    // Aggregate the releases into ranges
    const time = data.time;

    if (!time) {
        return [];
    }

    const points = Object.keys(time).map((version) => { return { date: moment.utc(time[version]), version }; });
    const ranges = pointsToRanges(points, pointsToRanges.bucketsFromBreakpoints([30, 90, 180, 365, 730]));

    // Build the releases frequency array based on the releases ranges
    return ranges.map((range) => {
        return { from: range.from, to: range.to, count: range.points.length };
    });
}

/**
 * Normalizes a single license value to a SPDX identifier.
 *
 * @param {string}        name    The module name
 * @param {string|object} license The license value, which can be a string or an object (deprecated)
 *
 * @return {string} The normalized license, which is a SPDX identifier
 */
function normalizeLicense(name, license) {
    // Handle { type: 'MIT', url: 'http://..' }
    if (license && license.type) {
        license = license.type;
    }

    // Ensure that the license is a non-empty string
    if (typeof license !== 'string' || !license) {
        log.silly(logPrefix, `Invalid license for module ${name} was found`, { license });
        return null;
    }

    // Try to correct licenses that are not valid SPDX identifiers
    if (!spdx.valid(license)) {
        const correctedLicense = spdxCorrect(license);

        if (correctedLicense) {
            log.verbose(logPrefix, `Module ${name} license was corrected from ${license} to ${correctedLicense}`);
            license = correctedLicense;
        } else {
            log.verbose(logPrefix, `License for module ${name} is not a valid SPDX indentifier`, { license });
            license = null;
        }
    }

    return license;
}

/**
 * Extracts the license from the module's data.
 * Attempts to normalize any license to valid SPDX identifiers.
 *
 * @param {object} data        The module data
 * @param {object} packageJson The latest package.json object
 *
 * @return {string} The license.
 */
function extractLicense(data, packageJson) {
    const originalLicense = packageJson.license || packageJson.licenses;
    let license = originalLicense;

    // Short-circuit for modules without a license
    if (license == null) {
        log.silly(logPrefix, `No license for module ${data.name} is set`);
        return null;
    }

    // Some old packages used objects or an array of objects to specify licenses
    // We do some effort to normalize them into SPDX license expressions
    if (Array.isArray(license)) {
        license = license
        .map((license) => normalizeLicense(data.name, license))
        .reduce((str, license) => str + (str ? ' OR ' : '') + license, '');
    } else {
        license = normalizeLicense(data.name, license);
    }

    return license;
}

// ----------------------------------------------------------------------------

/**
 * Runs the metadata analyzer.
 *
 * @param {object} data        The module data
 * @param {object} packageJson The latest package.json data (normalized)
 *
 * @return {Promise} The promise that fulfills when done
 */
function metadata(data, packageJson) {
    return Promise.try(() => {
        const versions = Object.keys(data.versions);

        return deepCompact({
            name: packageJson.name,
            description: packageJson.description,
            keywords: packageJson.keywords,
            readme: (data.readme && data.readme.indexOf('No README data') === -1) ? data.readme : null,

            author: packageJson.author,
            contributors: packageJson.contributors,
            maintainers: (packageJson.maintainers || data.maintainers),

            repository: packageJson.repository,
            homepage: packageJson.homepage,
            license: extractLicense(data, packageJson),

            dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies,
            peerDependencies: packageJson.peerDependencies,
            bundledDependencies: packageJson.bundledDependencies || packageJson.bundleDependencies,
            optionalDependencies: packageJson.optionalDependencies,

            releases: {
                latest: {
                    version: versions[versions.length - 1] || '0.0.1',
                    date: data.time && data.time.modified,
                },
                first: {
                    version: versions[0] || '0.0.1',
                    date: data.time && data.time.created,
                },
                frequency: extractReleasesFrequency(data),
            },

            deprecated: packageJson.deprecated,
            hasTestScript: get(packageJson, 'scripts.test', '').indexOf('no test specified') === -1,
        });
    });
}

module.exports = metadata;
