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
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The carefulness evaluation (from 0 to 1)
 */
function evaluateCarefulness(info) {
    const isDeprecated = !!info.metadata.deprecated;
    const isStable = semver.gte(info.metadata.releases.latest.version, '1.0.0', true);  // `true` = loose semver

    const licenseEvaluation = Number(!!info.metadata.license);
    const readmeEvaluation = normalizeValue(info.source.files.readmeSize, [
        { value: 0, norm: 0 },
        { value: 400, norm: 1 },
    ]);
    const hiddenEvaluation = (Number(info.source.files.gitignore) +
                              Number(info.source.files.npmignore) +
                              Number(info.source.files.gitattributes) / 3);
    const lintersEvaluation = Number(!!info.source.linters);

    const finalWeightConditioning = isDeprecated ? 0.3 : (!isStable ? 0.7 : 1);

    // TODO: Include info.source.size?

    return (licenseEvaluation * 0.35 +
            readmeEvaluation * 0.40 +
            lintersEvaluation * 0.15 +
            hiddenEvaluation * 0.1) * finalWeightConditioning;
}

/**
 * Evaluates the module tests.
 * Takes into the consideration the tests size, coverage % and build status.
 *
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The tests evaluation (from 0 to 1)
 */
function evaluateTests(info) {
    const testsEvaluation = !info.metadata.hasTestScript ? 0 : normalizeValue(info.source.files.testsSize, [
        { value: 0, norm: 0 },
        { value: 400, norm: 1 },
    ]);
    const coverageEvaluation = info.source.coverage || 0;
    const statusEvaluation = ((info.github && info.github.statuses) || [])
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
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The dependencies health evaluation (from -Infinity to 0)
 */
function evaluateDependenciesHealth(info) {
    const outdatedCount = info.source.outdatedDependencies ? Object.keys(info.source.outdatedDependencies).length : 0;
    const vulnerabilitiesCount = info.dependenciesVulnerabilities ? info.dependenciesVulnerabilities.length : 0;
    const dependenciesCount = Object.keys(info.metadata.dependencies || []).length;

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
 * @param {object} info The info object returned from the collectors
 *
 * @return {number} The branding evaluation (from 0 to 1)
 */
function evaluateBranding(info) {
    const parsedRepository = url.parse(get(info.metadata, 'repository.url') || '');
    const parsedHomepage = url.parse(get(info, 'github.homepage') || info.metadata.homepage || '');
    const hasCustomWebsite = !!(parsedRepository.host && parsedHomepage.host &&
                                parsedRepository.host !== parsedHomepage.host);
    const badgesCount = info.source.badges ? info.source.badges.length : 0;

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
 * @param {object} info The info object returned from the collectors
 *
 * @return {object} The evaluation result
 */
function quality(info) {
    return {
        carefulness: evaluateCarefulness(info),
        tests: evaluateTests(info),
        dependenciesHealth: evaluateDependenciesHealth(info),
        branding: evaluateBranding(info),
    };
}

module.exports = quality;
