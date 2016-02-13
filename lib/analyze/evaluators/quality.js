'use strict';

const url = require('url');
const semver = require('semver');
const get = require('lodash/get');

/**
 * Checks if the module has a custom website, that is, other than the typical repository one.
 *
 * @param {object} info The info object
 *
 * @return {boolean} True if it has, false otherwise
 */
function hasCustomWebsite(info) {
    const parsedRepository = url.parse(get(info.metadata, 'repository.url') || '');
    const parsedHomepage = url.parse(get(info, 'github.homepage') || info.metadata.homepage || '');

    return !!(parsedRepository.host && parsedHomepage.host && parsedRepository.host !== parsedHomepage.host);
}

// ----------------------------------------------------------------------------

// TODO: include stuff from the source info

/**
 * Computes the quality score.
 *
 * @param {object} info The info object
 *
 * @return {object} The computed result, containing a `score` property and additional information
 */
function quality(info) {
    const checks = {
        hasLicense: !!info.metadata.license,
        hasReadme: !!info.metadata.readme,
        hasTests: info.metadata.hasTestScript,
        hasCustomWebsite: hasCustomWebsite(info),
        isStable: semver.gte(info.metadata.releases.latest.version, '1.0.0', true),  // `true` active loose parsing
        isDeprecated: !!info.metadata.deprecated,
    };

    const scores = {
        basic: Number(checks.hasTests) * 0.6 +
               Number(checks.hasLicense) * 0.35 +
               Number(checks.hasCustomWebsite) * 0.05,
    };

    // Adjust the calculated score based on some really crucial checks
    let weightConditioning = 1;

    if (!checks.hasReadme) {
        weightConditioning *= 0.1;
    }
    if (checks.isDeprecated) {
        weightConditioning *= 0.2;
    }
    if (!checks.isStable) {
        weightConditioning *= 0.85;
    }

    return {
        score: scores.basic * weightConditioning,
        detail: scores,
        extra: {
            checks,
            weightConditioning,
        },
    };
}

module.exports = quality;
