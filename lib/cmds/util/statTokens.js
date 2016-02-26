'use strict';

const tokenDealer = require('token-dealer');
const log = require('npmlog');

function statTokens(tokens, group, interval) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    const intervalId = setInterval(() => {
        const usage = tokenDealer.getTokensUsage(tokens, { group });

        log.stat('tokens', `Tokens usage for ${group}`, usage);
    }, interval || 15000)
    .unref();

    return () => {
        clearInterval(intervalId);
    };
}

module.exports = statTokens;
