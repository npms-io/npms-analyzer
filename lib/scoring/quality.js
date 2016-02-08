'use strict';

const url = require('url');
const semver = require('semver');
const get = require('lodash/get');

/**
 * Checks if the module has a custom website, that is, other than the typical repository one.
 *
 * @param {object} analysis The analysis object
 *
 * @return {boolean} True if it has, false otherwise
 */
function hasCustomWebsite(analysis) {
    const parsedRepository = url.parse(get(analysis.metadata, 'repository.url') || '');
    const parsedHomepage = url.parse(get(analysis, 'github.homepage') || analysis.metadata.homepage || '');

    return !!(parsedRepository.host && parsedHomepage.host && parsedRepository.host !== parsedHomepage.host);
}

// ----------------------------------------------------------------------------

// TODO: include the following stuff into the quality once the analyzers give us the info
// - has coverage? whats the coverage %?
// - has continuous integration? is build passing?
// - has outdated dependencies?
// - has security vulnerabilities?
// - has badges?
// - does the project have linters configured?
// - what's the code complexity score?

/**
 * Computes the quality score.
 *
 * @param {object} analysis The analysis object
 *
 * @return {object} The computed result, containing a `score` property and additional information
 */
function quality(analysis) {
    const checks = {
        hasReadme: !!analysis.metadata.readme,
        hasLicense: !!analysis.metadata.license,
        hasTests: analysis.metadata.hasTestScript,
        hasCustomWebsite: hasCustomWebsite(analysis),
        isStable: semver.gte(analysis.metadata.releases.latest.version, '1.0.0'),
        isDeprecated: !!analysis.metadata.deprecated,
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
