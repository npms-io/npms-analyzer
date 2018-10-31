/* eslint no-nested-ternary: 0 */

'use strict';

const url = require('url');
const semver = require('semver');
const get = require('lodash/get');
const normalizeValue = require('normalize-value');

const log = logger.child({ module: 'evaluate/quality' });

/**
 * Evaluates the author's carefulness with the package.
 * It evaluates the basics of a package, such as the README, license, stability, etc.
 *
 * @param {Object} collected - The collected information.
 *
 * @returns {Number} The carefulness evaluation (from 0 to 1).
 */
function evaluateCarefulness(collected) {
    const licenseEvaluation = Number(!!collected.metadata.license);
    const readmeEvaluation = normalizeValue(get(collected, 'source.files.readmeSize', 0), [
        { value: 0, norm: 0 },
        { value: 400, norm: 1 },
    ]);
    const lintersEvaluation = Number(!!get(collected, 'source.linters', null));
    const ignoreEvaluation = Number(get(collected, 'source.files.hasNpmIgnore') || collected.metadata.hasSelectiveFiles || false);
    const changelogEvaluation = Number(get(collected, 'source.files.hasChangelog', false));

    const isDeprecated = !!collected.metadata.deprecated;
    const isStable = semver.gte(collected.metadata.version, '1.0.0', true); // `true` = loose semver
    const finalWeightConditioning = isDeprecated ? 0 : (!isStable ? 0.5 : 1);

    return (
        (licenseEvaluation * 0.33) +
        (readmeEvaluation * 0.38) +
        (lintersEvaluation * 0.13) +
        (ignoreEvaluation * 0.08) +
        (changelogEvaluation * 0.08)
    ) * finalWeightConditioning;
}

/**
 * Evaluates the package tests.
 * Takes into the consideration the tests size, coverage % and build status.
 *
 * @param {Object} collected - The collected information.
 *
 * @returns {Number} The tests evaluation (from 0 to 1).
 */
function evaluateTests(collected) {
    if (!collected.source) {
        return 0;
    }

    const testsEvaluation = normalizeValue(collected.source.files.testsSize, [
        { value: 0, norm: 0 },
        { value: 400, norm: collected.metadata.hasTestScript ? 1 : 0.5 },
    ]);
    const coverageEvaluation = collected.source.coverage || 0;
    const statusEvaluation = ((collected.github && collected.github.statuses) || [])
    .reduce((sum, status, index, arr) => {
        switch (status.state) {
        case 'success':
            return sum + (1 / arr.length);
        case 'pending':
            return sum + (0.3 / arr.length);
        case 'error':
        case 'failure':
            return sum;
        default:
            log.warn(`Unknown github status state: ${status}`);

            return sum;
        }
    }, 0);

    return (testsEvaluation * 0.6) +
           (statusEvaluation * 0.25) +
           (coverageEvaluation * 0.15);
}

/**
 * Evaluates the package health.
 * Takes into consideration vulnerabilities, outdated dependencies and unlocked dependencies (ones with * or >= 0.0.0).
 *
 * @param {Object} collected - The collected information.
 *
 * @returns {Number} The dependencies health evaluation (from 0 to 1).
 */
function evaluateHealth(collected) {
    if (!collected.source) {
        return 0;
    }

    const dependencies = collected.metadata.dependencies || {};
    const dependenciesCount = Object.keys(dependencies).length;

    if (!dependenciesCount) {
        return 1;
    }

    // Calculate outdated count
    const outdatedCount = collected.source.outdatedDependencies ?
        Object.keys(collected.source.outdatedDependencies).length :
        (collected.source.outdatedDependencies === false ? dependenciesCount : 0);

    // Calculate vulnerabilities count
    const vulnerabilitiesCount = collected.source.vulnerabilities ?
        collected.source.vulnerabilities.length :
        (collected.source.vulnerabilities === false ? dependenciesCount : 0);

    // Calculate unlocked count - packages that have loose locking of versions, e.g.: '*' or >= 1.6.0
    // Note that if the package has npm-shrinkwrap.json, then it actually has its versions locked down
    const unlockedCount = collected.source.files.hasShrinkwrap ? 0 :
        Object.values(dependencies).reduce((count, value) => {
            const range = semver.validRange(value, true);

            return range && !semver.gtr('1000000.0.0', range, true) ? count + 1 : count;
        }, 0);

    const outdatedEvaluation = normalizeValue(outdatedCount, [
        { value: 0, norm: 1 },
        { value: Math.max(2, dependenciesCount / 4), norm: 0 },
    ]);
    const vulnerabilitiesEvaluation = normalizeValue(vulnerabilitiesCount, [
        { value: 0, norm: 1 },
        { value: Math.max(2, dependenciesCount / 4), norm: 0 },
    ]);

    const finalWeightConditioning = !unlockedCount ? 1 : 1 / (unlockedCount + 1);

    return (
        (outdatedEvaluation * 0.5) +
        (vulnerabilitiesEvaluation * 0.5)
    ) * finalWeightConditioning;
}

/**
 * Evaluates the package branding.
 * Takes into consideration if the package has badges, custom homepage, etc.
 *
 * @param {Object} collected - The collected information.
 *
 * @returns {Number} The branding evaluation (from 0 to 1).
 */
function evaluateBranding(collected) {
    const parsedRepository = url.parse(get(collected.metadata, 'repository.url', ''));
    const parsedHomepage = url.parse(get(collected.metadata, 'links.homepage', get(collected, 'github.homepage', '')));
    const hasCustomHomepage = !!(parsedRepository.host && parsedHomepage.host &&
                                parsedRepository.host !== parsedHomepage.host);
    const badgesCount = get(collected, 'source.badges.length', 0);

    const homepageEvaluation = Number(hasCustomHomepage);
    const badgesEvaluation = normalizeValue(badgesCount, [
        { value: 0, norm: 0 },
        { value: 4, norm: 1 },
    ]);

    return (homepageEvaluation * 0.4) +
           (badgesEvaluation * 0.6);
}

// ----------------------------------------------------------------------------

/**
 * Evaluates the package quality.
 *
 * @param {Object} collected - The collected information.
 *
 * @returns {Object} The evaluation result.
 */
function quality(collected) {
    return {
        carefulness: evaluateCarefulness(collected),
        tests: evaluateTests(collected),
        health: evaluateHealth(collected),
        branding: evaluateBranding(collected),
    };
}

module.exports = quality;
