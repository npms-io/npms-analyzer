/* eslint no-nested-ternary: 0 */

'use strict';

const url = require('url');
const log = require('npmlog');
const semver = require('semver');
const get = require('lodash/get');
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
    const ignoreEvaluation = Number(collected.source.files.npmignore);
    const lintersEvaluation = Number(!!collected.source.linters);

    const finalWeightConditioning = isDeprecated ? 0.3 : (!isStable ? 0.7 : 1);

    // TODO: Include collected.source.size?
    // TODO: Check if * or >= are being used in dependency ranges..

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
 * Takes into consideration the outdated dependencies as well as vulnerable dependencies.
 *
 * @param {object} collected The collected information
 *
 * @return {number} The dependencies health evaluation (from -Infinity to 0)
 */
function evaluateDependenciesHealth(collected) {
    const outdatedCount = collected.source.outdatedDependencies ?
        Object.keys(collected.source.outdatedDependencies).length : 0;
    const vulnerabilitiesCount = collected.dependenciesVulnerabilities ?
        collected.dependenciesVulnerabilities.length : 0;
    const dependenciesCount = Object.keys(collected.metadata.dependencies || []).length;

    const outdatedEvaluation = normalizeValue(outdatedCount, [
        { value: 0, norm: 1 },
        { value: dependenciesCount / 4, norm: 0 },
    ]);
    const vulnerabilitiesEvaluation = normalizeValue(vulnerabilitiesCount, [
        { value: 0, norm: 1 },
        { value: dependenciesCount / 4, norm: 0 },
    ]);

    return outdatedEvaluation * 0.5 +
           vulnerabilitiesEvaluation * 0.5;
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
    const parsedRepository = url.parse(get(collected.metadata, 'repository.url') || '');
    const parsedHomepage = url.parse(get(collected, 'github.homepage') || collected.metadata.homepage || '');
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
