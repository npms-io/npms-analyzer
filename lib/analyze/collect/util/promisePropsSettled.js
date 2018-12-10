'use strict';

const mapValues = require('lodash/mapValues');

/**
 * Promise utility similar to bluebird's .props() but only fulfills when all promises are fulfilled,
 * even rejections.
 *
 * @param {Object} object - The object that contain the promises.
 *
 * @returns {Promise} A promise that only fulfills after all the promises have fulfilled.
 */
function promisePropsSettled(object) {
    object = mapValues(object, (promise) => Promise.resolve(promise).reflect());

    return Promise.props(object)
    .then((results) => (
        mapValues(results, (inspection) => {
            if (inspection.isRejected()) {
                throw inspection.reason();
            }

            return inspection.value();
        })
    ));
}

module.exports = promisePropsSettled;
