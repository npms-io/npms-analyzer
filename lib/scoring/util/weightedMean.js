'use strict';

/**
 * Calculate the weighted mean values.
 *
 * @param {array} weightedValues An array of arrays with value and integer weights (e.g. [[0.5, 5], [0.3, 7]])
 *
 * @return {number} The median
 */
function weightedMean(weightedValues) {
    const totalWeight = weightedValues.reduce((sum, weightedValue) => sum + weightedValue[1], 0);

    return weightedValues.reduce((mean, weightedValue) => mean + weightedValue[0] * weightedValue[1] / totalWeight, 0);
}

module.exports = weightedMean;
