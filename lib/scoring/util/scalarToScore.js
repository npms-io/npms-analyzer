'use strict';

const findLastIndex = require('lodash/findLastIndex');

function scalarToScore(value, steps) {
    const isScoreIncreasing = steps[1].score > steps[0].score;
    const index = findLastIndex(steps, (step) => step.value <= value);

    // Out of bounds?
    if (index === -1) {
        return isScoreIncreasing ? 0 : 1;
    }
    if (index >= steps.length - 1) {
        return isScoreIncreasing ? 1 : 0;
    }

    const stepLow = steps[index];
    const stepHigh = steps[index + 1];

    // LOG_NORM2 formula
    return stepLow.score + (stepHigh.score - stepLow.score) *
           (value - stepLow.value) / (stepHigh.value - stepLow.value);
}

module.exports = scalarToScore;
