'use strict';

const findLastIndex = require('lodash/findLastIndex');

/**
 * Normalizes a value according to the specified steps, using log norm2 formula.
 *
 * @param {number} value The scalar value
 * @param {array}  steps The array of step objects, each one containing a `value` and `norm` properties
 *
 * @return {number} The normalized value
 */
function normalizeValue(value, steps) {
    const index = findLastIndex(steps, (step) => step.value <= value);

    // Out of bounds?
    if (index === -1) {
        return steps[0].norm;
    }
    if (index >= steps.length - 1) {
        return steps[steps.length - 1].norm;
    }

    const stepLow = steps[index];
    const stepHigh = steps[index + 1];

    // LOG_NORM2 formula
    return stepLow.norm + (stepHigh.norm - stepLow.norm) *
           (value - stepLow.value) / (stepHigh.value - stepLow.value);
}

module.exports = normalizeValue;
