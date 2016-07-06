'use strict';

const pino = require('pino');
const tokenDealer = require('token-dealer');
const values = require('lodash/values');
const minBy = require('lodash/minBy');

const log = logger.child({ module: 'stats/tokens' });

/**
 * Monitors the API tokens managed by token-dealer of a given group.
 *
 * @param {array}  tokens  The array of tokens
 * @param {string} [group] The token's group (e.g.: github)
 */
function statTokens(tokens, group) {
    // Do nothing if loglevel is higher than info
    if (log.levelVal > pino.levels.values.info) {
        return;
    }

    setInterval(() => {
        const tokensUsage = values(tokenDealer.getTokensUsage(tokens, { group }));
        const usableTokensUsage = tokensUsage.filter((entry) => !entry.exhausted);

        if (usableTokensUsage.length) {
            log.info(`${usableTokensUsage.length} out of ${tokensUsage.length} tokens are usable (${group})`);
            return;
        }
        if (tokensUsage.length < 1) {
            log.info(`We have no tokens (${group})`);
            return;
        }

        const nextResettingToken = minBy(tokensUsage, 'reset');
        const remainingMins = Math.ceil((nextResettingToken.reset - Date.now()) / 1000 / 60);

        log.info(`All tokens are exhausted, next one will reset in ${remainingMins} minutes (${group})`);
    }, 15000)
    .unref();
}

module.exports = statTokens;
