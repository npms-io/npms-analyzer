/* eslint no-bitwise: 0 */

'use strict';

const got = require('got');
const normalize = require('got/source/normalize-arguments');

const log = logger.child({ module: 'util/got-retry' });

const normalizedDefaults = normalize('', {}, got.defaults);

const defaultRetries = normalizedDefaults.retry.retries;

const retries = (iteration, error) => {
    const delay = defaultRetries(iteration, error);

    if (delay > 0) {
        log.warn({ url: error.href, error, iteration }, 'Retrying request..');
    }

    return delay;
};

module.exports = { retries };
