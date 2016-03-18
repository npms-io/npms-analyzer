'use strict';

/**
 * Calculate the weighted median values
 *
 * @param {array} weightedValues An array of arrays with value and integer weights (e.g. [[0.5, 5], [0.3, 7]])
 *
 * @return {Number} The median
 */
function weightedMedian(weightedValues) {
    let result = null;
    let i = 0;
    const half = Math.ceil(weightedValues.reduce((previous, weightedValue) => previous + weightedValue[1], 0) / 2);

    weightedValues.sort((a, b) => a[0] - b[0]);

    weightedValues.every((weightedValue) => {
        if (result !== null) {
            result = (result + weightedValue[0]) / 2.0;
            return false;
        }

        i += weightedValue[1];

        if (i >= half) {
            result = weightedValue[0];
        }

        return i <= half;
    });

    return result;
}

module.exports = weightedMedian;
