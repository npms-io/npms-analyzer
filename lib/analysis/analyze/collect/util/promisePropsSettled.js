'use strict';

const mapValues = require('lodash/mapValues');

function promisePropsSettled(object) {
    object = mapValues(object, (promise) => Promise.resolve(promise).reflect());

    return Promise.props(object)
    .then((results) => {
        return mapValues(results, (inspection) => {
            if (inspection.isRejected()) {
                throw inspection.reason();
            }

            return inspection.value();
        });
    });
}

module.exports = promisePropsSettled;
