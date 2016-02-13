'use strict';

const assign = require('lodash/assign');
const evaluators = require('require-directory')(module, './collectors');

function evaluate(info) {
    return {
        /*quality: evaluators.quality(info),
        popularity: evaluators.popularity(info),
        maintenance: evaluators.maintenance(info),*/
    };
}

module.exports = assign(evaluate, evaluators);
