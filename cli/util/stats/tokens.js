'use strict';

const tokenDealer = require('token-dealer');
const log = require('npmlog');
const values = require('lodash/values');
const minBy = require('lodash/minBy');

/**
 * Monitors the tokens managed by token-dealer of a given group.
 *
 * @param {array}  tokens  The array of tokens
 * @param {string} [group] The token's group (e.g.: github)
 */
function statTokens(tokens, group) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return;
    }

    setInterval(() => {
        const tokensUsage = values(tokenDealer.getTokensUsage(tokens, { group }));
        const usableTokensUsage = tokensUsage.filter((entry) => !entry.exhausted);

        if (usableTokensUsage.length) {
            log.stat('tokens', `${usableTokensUsage.length} out of ${tokensUsage.length} tokens are usable (${group})`);
            return;
        }
        if (tokensUsage.length < 1) {
            log.stat('tokens', `We have no tokens (${group})`);
            return;
        }

        const nextResettingToken = minBy(tokensUsage, 'reset');
        const remainingMins = Math.ceil((nextResettingToken.reset - Date.now()) / 1000 / 60);

        log.stat('tokens', `All tokens are exhausted, next one will reset in ${remainingMins} minutes (${group})`);
    }, 15000)
    .unref();
}

module.exports = statTokens;
