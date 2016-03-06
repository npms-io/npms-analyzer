'use strict';

const tokenDealer = require('token-dealer');
const log = require('npmlog');
const values = require('lodash/values');

function statTokens(tokens, group) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    setInterval(() => {
        const tokensUsage = values(tokenDealer.getTokensUsage(tokens, { group }));
        const usableTokensUsage = tokensUsage.filter((entry) => !entry.exhausted);

        if (usableTokensUsage.length) {
            return log.stat('tokens', `${usableTokensUsage.length} out of ${tokensUsage.length} are usable (${group})`);
        }

        const closerTokenUsage = tokensUsage.reduce((closer, entry) => entry.reset < closer.reset ? entry : closer);
        const remainingMins = Math.ceil((closerTokenUsage.reset - Date.now()) / 1000 / 60);

        log.stat('tokens', `All tokens are exhausted, next one will reset in ${remainingMins} minutes (${group})`);
    }, 15000)
    .unref();
}

module.exports = statTokens;
