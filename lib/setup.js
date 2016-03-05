'use strict';

const Promise = require('bluebird');
const log = require('npmlog');
const argv = require('yargs').argv;

// Configure bluebird
global.Promise = Promise;
Promise.config({ longStackTraces: process.env.NODE_ENV !== 'production', warnings: false });

// Configure logger
log.addLevel('stat', log.levels.warn + 100, { fg: 'green', bg: 'black' });
log.level = argv.logLevel || 'warn';
log.on('log', (entry) => {
    if (log.levels[entry.level] < log.levels.error) {
        return;
    }

    const err = entry.messageRaw[1] && entry.messageRaw[1].err;

    if (err && err.stack) {
        const stack = err.stack.replace(err.toString(), '').trim();

        entry.messageRaw.push(err);
        entry.message += `\nStack:\n${stack}\n`;
    }
});
