/* eslint no-bitwise: 0 */

'use strict';

const transientErrors = [
    'ETIMEDOUT',
    'ECONNRESET',
    'EADDRINUSE',
    'ESOCKETTIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'ENOTFOUND',
    'ENETUNREACH',
    'EAI_AGAIN',
];

/**
 * Custom retry function to be passed as `retries` option of got().
 * The default `got` retry does not account for all the network errors, such as `ENOTFOUND`.
 * See: Https://github.com/floatdrop/is-retry-allowed/blob/master/index.js.
 *
 * @param {Number} attempt - The attempt number.
 * @param {Error}  err      - The error.
 *
 * @returns {Number} The retry back-off or 0 to not retry.
 */
function retries(attempt, err) {
    if (attempt > 5 || transientErrors.indexOf(err.code) === -1) {
        return 0;
    }

    const noise = (Math.random() * 100);

    return ((1 << attempt) * 1000) + noise;
}

module.exports = { retries };
module.exports.transientErrors = transientErrors;
