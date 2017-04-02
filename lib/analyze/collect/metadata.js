'use strict';

const moment = require('moment');
const spdx = require('spdx');
const spdxCorrect = require('spdx-correct');
const deepCompact = require('deep-compact');
const isLinkWorking = require('is-link-working');
const get = require('lodash/get');
const find = require('lodash/find');
const pickBy = require('lodash/pickBy');
const mapValues = require('lodash/mapValues');
const size = require('lodash/size');
const hostedGitInfo = require('../util/hostedGitInfo');
const pointsToRanges = require('./util/pointsToRanges');
const promisePropsSettled = require('./util/promisePropsSettled');

const log = logger.child({ module: 'collect/metadata' });

/**
 * Extracts the releases frequency.
 *
 * @param {object} data The package data
 *
 * @return {array} An array of ranges with the release count for each entry
 */
function extractReleases(data) {
    // Aggregate the releases into ranges
    const time = data.time || {};
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
 * @param {string}        name    The package name
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
        log.trace({ license }, `Invalid license for package ${name} was found`);
        return null;
    }

    // Try to correct licenses that are not valid SPDX identifiers
    if (!spdx.valid(license)) {
        const correctedLicense = spdxCorrect(license);

        if (correctedLicense) {
            log.debug(`Package ${name} license was corrected from ${license} to ${correctedLicense}`);
            license = correctedLicense;
        } else {
            log.debug({ license }, `License for package ${name} is not a valid SPDX indentifier`);
            license = null;
        }
    }

    return license;
}

/**
 * Extracts the license from the package data.
 * Attempts to normalize any license to valid SPDX identifiers.
 *
 * @param {object} packageJson The latest package.json object (normalized)
 *
 * @return {string} The license or null if unable to extract it
 */
function extractLicense(packageJson) {
    const originalLicense = packageJson.license || packageJson.licenses;
    let license = originalLicense;

    // Short-circuit for packages without a license
    if (license == null) {
        log.trace(`No license for package ${packageJson.name} is set`);
        return null;
    }

    // Some old packages used objects or an array of objects to specify licenses
    // We do some effort to normalize them into SPDX license expressions
    if (Array.isArray(license)) {
        license = license
        .map((license) => normalizeLicense(packageJson.name, license))
        .reduce((str, license) => str + (str ? ' OR ' : '') + license, '');
    } else {
        license = normalizeLicense(packageJson.name, license);
    }

    return license;
}

/**
 * Extracts useful links of the package (homepage, repository, etc).
 *
 * @param {object} packageJson The latest package.json object (normalized)
 *
 * @return {object} The links
 */
function extractLinks(packageJson) {
    const gitInfo = hostedGitInfo(packageJson.repository && packageJson.repository.url);

    const links = pickBy({
        npm: `https://www.npmjs.com/package/${encodeURIComponent(packageJson.name)}`,
        homepage: packageJson.homepage,
        repository: gitInfo && gitInfo.browse(),
        bugs: (packageJson.bugs && packageJson.bugs.url) || (gitInfo && gitInfo.bugs()),
    });

    // Filter only good links, removing broken ones
    // Avoid checking the npm link because we are sure it works..
    const linksBeingChecked = [];
    const isLinkWorkingCache = { [links.npm]: true };
    const areLinksWorking = mapValues(links, (link) => {
        const normalizedLink = link.split('#')[0];  // Remove trailing # (e.g.: #readme)

        if (!isLinkWorkingCache[normalizedLink]) {
            isLinkWorkingCache[normalizedLink] = isLinkWorking(normalizedLink);
            linksBeingChecked.push(normalizedLink);
        }

        return isLinkWorkingCache[normalizedLink];
    });

    log.debug({ linksBeingChecked }, 'Checking for broken links');

    return Promise.props(areLinksWorking)
    .then((result) => {
        let finalLinks = mapValues(links, (link, name) => result[name] ? link : null);

        // If the homepage is broken, fallback to the repository docs
        if (!finalLinks.homepage && finalLinks.repository) {
            finalLinks.homepage = gitInfo.docs();
        }

        finalLinks = pickBy(finalLinks);

        // Log the broken links
        const brokenLinks = pickBy(links, (link, name) => !result[name]);
        const brokenLinksCount = size(brokenLinks);

        brokenLinksCount && log.info({ links, brokenLinks, finalLinks },
            `Detected ${brokenLinksCount} broken links on ${packageJson.name}`);

        return finalLinks;
    });
}

/**
 * Extracts the author of the the package.
 * Tries to match against the maintainers to guess its `npm` username.
 *
 * @param {object} packageJson The latest package.json object (normalized)
 * @param {array}  maintainers The package maintainers
 *
 * @return {object} The author (name + [username] + [email] + [url]) or null if unable to extract it
 */
function extractAuthor(packageJson, maintainers) {
    if (!packageJson.author) {
        return null;
    }

    const author = Object.assign({}, packageJson.author);
    const maintainer = maintainers && find(maintainers, (maintainer) => maintainer.email === packageJson.author.email);

    if (maintainer) {
        author.username = maintainer.name;
    }

    return author;
}

/**
 * Extracts the person who published the package.
 * For older packages, it might be unavailable so a best-effort to guess it is made.
 *
 * @param {object} packageJson The latest package.json object (normalized)
 * @param {array}  maintainers The package maintainers
 *
 * @return {object} The publisher (username + email) or null if unable to extract it
 */
function extractPublisher(packageJson, maintainers) {
    let npmUser;

    // Assume the _npmUser if exists
    npmUser = packageJson._npmUser;

    // Fallback to find the author within the maintainers
    // If it doesn't exist, fallback to the first maintainer
    if (!npmUser && maintainers) {
        npmUser = packageJson.author && find(maintainers, (maintainer) => maintainer.email === packageJson.author.email);
        npmUser = npmUser || maintainers[0];
    }

    return npmUser ? { username: npmUser.name, email: npmUser.email } : null;
}

/**
 * Extract the scope from the package name.
 *
 * @param {object} packageJson The latest package.json data (normalized)
 *
 * @return {string} The scope, or "unscoped" if no scope is found.
 */
function extractScope(packageJson) {
    const match = packageJson.name.match(/^@([^/]+)\/.+$/);

    return match ? match[1] : 'unscoped';
}

/**
 * Extracts the package maintainers.
 *
 * This solves various issues with data consistency:
 * - Some packages have the maintainers in the data, others in the package.json.
 * - The top-level maintainers were empty but the package.json ones were correct, e.g.: `graphql-shorthand-parser`.
 * - The maintainers was not an array but a string e.g.: `connect-composer-stats.`
 *
 * @param {object} data        The package data
 * @param {object} packageJson The latest package.json data (normalized)
 *
 * @return {array} The maintainers or null if unable to extract them
 */
function extractMaintainers(data, packageJson) {
    if (Array.isArray(data.maintainers) && data.maintainers.length) {
        return data.maintainers;
    }

    if (Array.isArray(packageJson.maintainers) && packageJson.maintainers.length) {
        return packageJson.maintainers;
    }

    log.warn({ packageJsonMaintainers: packageJson.maintainers, dataMaintainers: data.maintainers },
        `Failed to extract maintainers of ${packageJson.name}`);

    return null;
}

// ----------------------------------------------------------------------------

/**
 * Generates an empty metadata objet.
 *
 * @param  {name} name The package name
 *
 * @return {object} The empty collected data
 */
function empty(name) {
    return {
        name,
        version: '0.0.0',
        links: {
            npm: `https://www.npmjs.com/package/${encodeURIComponent(name)}`,
        },
    };
}

/**
 * Runs the metadata analyzer.
 *
 * @param {object} data        The package data
 * @param {object} packageJson The latest package.json data (normalized)
 *
 * @return {Promise} The promise that fulfills when done
 */
function metadata(data, packageJson) {
    return promisePropsSettled({
        links: extractLinks(packageJson),
    })
    .then((props) => {
        const maintainers = extractMaintainers(data, packageJson);

        return deepCompact({
            name: packageJson.name,
            scope: extractScope(packageJson),
            version: packageJson.version,
            description: packageJson.description,
            keywords: packageJson.keywords,
            date: data.time && (data.time[packageJson.version] || data.time.modified),

            author: extractAuthor(packageJson, maintainers),
            publisher: extractPublisher(packageJson, maintainers),
            maintainers: maintainers && maintainers.map((maintainer) => {
                return { username: maintainer.name, email: maintainer.email };
            }),
            contributors: packageJson.contributors,

            repository: packageJson.repository,
            links: props.links,
            license: extractLicense(packageJson),

            dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies,
            peerDependencies: packageJson.peerDependencies,
            bundledDependencies: packageJson.bundledDependencies || packageJson.bundleDependencies,
            optionalDependencies: packageJson.optionalDependencies,

            releases: extractReleases(data),

            deprecated: packageJson.deprecated,
            hasTestScript: get(packageJson, 'scripts.test', 'no test specified').indexOf('no test specified') === -1 ? true : null,
            hasSelectiveFiles: Array.isArray(packageJson.files) && packageJson.files.length > 0 ? true : null,

            // Need to use typeof because there's some old packages in which the README is an object, e.g.: `flatsite`
            readme: (typeof data.readme === 'string' && data.readme.indexOf('No README data') === -1) ?
                data.readme : null,
        });
    })
    .tap(() => log.debug(`The metadata collector for ${packageJson.name} completed successfully`));
}

module.exports = metadata;
module.exports.empty = empty;
