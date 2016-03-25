/* eslint no-bitwise: 0 */

'use strict';

const transientErrors = {
    ETIMEDOUT: true,
    ECONNRESET: true,
    EADDRINUSE: true,
    ESOCKETTIMEDOUT: true,
    ECONNREFUSED: true,
    EPIPE: true,
    ENOTFOUND: true,
    ENETUNREACH: true,
    EAI_AGAIN: true,
};

/**
 * Custom retry function to be passed as `retries` option of got().
 * The default `got` retry does not account for all the network errors, such as `ENOTFOUND`.
 * See: https://github.com/floatdrop/is-retry-allowed/blob/master/index.js
 *
 * @param {number} attempt The attempt number
 * @param {Error}  err      The error
 *
 * @return {number} The retry back-off or 0 to not retry
 */
function gotRetries(attempt, err) {
    if (attempt > 5 || !transientErrors[err.code]) {
        return 0;
    }

    return (1 << attempt) * 1000 + Math.random() * 100;
}

module.exports = gotRetries;
