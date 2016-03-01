'use strict';

const tokenDealer = require('token-dealer');
const log = require('npmlog');
const forIn = require('lodash/forIn');

function statTokens(tokens, group) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    const intervalId = setInterval(() => {
        const usage = tokenDealer.getTokensUsage(tokens, { group });

        // Fill in additional useful info
        forIn(usage, (usage) => {
            if (usage.exhausted) {
                const isoDate = (new Date(usage.reset)).toISOString();
                const remainingMinutes = Math.ceil((usage.reset - Date.now()) / 1000 / 60);

                usage.info = `will reset at ${isoDate} (~${remainingMinutes} minutes)`;
            } else {
                usage.info = 'ok';
            }
        });

        log.stat('tokens', `Tokens usage for ${group}`, usage);
    }, 15000)
    .unref();

    return () => {
        clearInterval(intervalId);
    };
}

module.exports = statTokens;
