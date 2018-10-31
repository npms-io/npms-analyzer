'use strict';

const evaluators = require('require-directory')(module, './', { recurse: false });

/**
 * Runs all the evaluators.
 *
 * @param {Object} collected - The collected information.
 *
 * @returns {Object} The evaluation result.
 */
function evaluate(collected) {
    return {
        quality: evaluators.quality(collected),
        popularity: evaluators.popularity(collected),
        maintenance: evaluators.maintenance(collected),
    };
}

module.exports = evaluate;
