/* eslint no-nested-ternary: 0 */

'use strict';

const url = require('url');
const log = require('npmlog');
const semver = require('semver');
const get = require('lodash/get');
const values = require('lodash/values');
const normalizeValue = require('./util/normalizeValue');

/**
 * Evaluates the author's carefulness with the module.
 * It evaluates the basics of a module, such as the README, license, stability, etc.
 *
 * @param {object} collected The collected information
 *
 * @return {number} The carefulness evaluation (from 0 to 1)
 */
function evaluateCarefulness(collected) {
    const isDeprecated = !!collected.metadata.deprecated;
    const isStable = semver.gte(collected.metadata.releases.latest.version, '1.0.0', true);  // `true` = loose semver

    const licenseEvaluation = Number(!!collected.metadata.license);
    const readmeEvaluation = normalizeValue(collected.source.files.readmeSize, [
        { value: 0, norm: 0 },
        { value: 400, norm: 1 },
    ]);
    const ignoreEvaluation = Number(collected.source.files.hasNpmIgnore);
    const lintersEvaluation = Number(!!collected.source.linters);

    const finalWeightConditioning = isDeprecated ? 0.3 : (!isStable ? 0.7 : 1);

    // TODO: include collected.source.size?

    return (licenseEvaluation * 0.35 +
            readmeEvaluation * 0.40 +
            lintersEvaluation * 0.15 +
            ignoreEvaluation * 0.1) * finalWeightConditioning;
}

/**
 * Evaluates the module tests.
 * Takes into the consideration the tests size, coverage % and build status.
 *
 * @param {object} collected The collected information
 *
 * @return {number} The tests evaluation (from 0 to 1)
 */
function evaluateTests(collected) {
    const testsEvaluation = !collected.metadata.hasTestScript ? 0 : normalizeValue(collected.source.files.testsSize, [
        { value: 0, norm: 0 },
        { value: 400, norm: 1 },
    ]);
    const coverageEvaluation = collected.source.coverage || 0;
    const statusEvaluation = ((collected.github && collected.github.statuses) || [])
    .reduce((sum, status, index, arr) => {
        switch (status.state) {
        case 'success':
            return sum + 1 / arr.length;
        case 'pending':
            return sum + 0.3 / arr.length;
        case 'error':
        case 'failure':
            return sum;
        default:
            log.warn('quality', `Unknown github status state: ${status}`);
            return sum;
        }
    }, 0);

    return testsEvaluation * 0.6 +
           statusEvaluation * 0.25 +
           coverageEvaluation * 0.15;
}

/**
 * Evaluates the module dependencies health.
 * Takes into consideration the outdated dependencies, vulnerable dependencies and unlocked
 * dependencies (ones with * or >= 0.0.0).
 *
 * @param {object} collected The collected information
 *
 * @return {number} The dependencies health evaluation (from 0 to 1)
 */
function evaluateDependenciesHealth(collected) {
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
    const vulnerabilitiesCount = collected.source.dependenciesVulnerabilities ?
        collected.source.dependenciesVulnerabilities.length :
        (collected.source.dependenciesVulnerabilities === false ? dependenciesCount : 0);

    // Calculate unlocked count - modules that have loose locking of versions, e.g.: '*' or >= 1.6.0
    // Note that if the module is has npm-shrinkwrap.json, then it actually has its versions locked down
    const unlockedCount = collected.source.files.hasShrinkwrap ? 0 :
        values(dependencies).reduce((count, value) => {
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

    return (outdatedEvaluation * 0.5 +
           vulnerabilitiesEvaluation * 0.5) * finalWeightConditioning;
}

/**
 * Evaluates the module branding.
 * Takes into consideration if the module has a custom website and its badges.
 *
 * @param {object} collected The collected information
 *
 * @return {number} The branding evaluation (from 0 to 1)
 */
function evaluateBranding(collected) {
    const parsedRepository = url.parse(get(collected.metadata, 'repository.url', ''));
    const parsedHomepage = url.parse(get(collected, 'github.homepage', collected.metadata.homepage || ''));
    const hasCustomWebsite = !!(parsedRepository.host && parsedHomepage.host &&
                                parsedRepository.host !== parsedHomepage.host);
    const badgesCount = collected.source.badges ? collected.source.badges.length : 0;

    const websiteEvaluation = Number(hasCustomWebsite);
    const badgesEvaluation = normalizeValue(badgesCount, [
        { value: 0, norm: 0 },
        { value: 4, norm: 1 },
    ]);

    return websiteEvaluation * 0.4 +
           badgesEvaluation * 0.6;
}

// ----------------------------------------------------------------------------

/**
 * Evaluates the module's quality.
 *
 * @param {object} collected The collected information
 *
 * @return {object} The evaluation result
 */
function quality(collected) {
    return {
        carefulness: evaluateCarefulness(collected),
        tests: evaluateTests(collected),
        dependenciesHealth: evaluateDependenciesHealth(collected),
        branding: evaluateBranding(collected),
    };
}

module.exports = quality;
