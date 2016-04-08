'use strict';

const Promise = require('bluebird');
const log = require('npmlog');

/**
 * Wraps stderr/stdout write function to buffer lines.
 * This is necessary to have pretty logging in PM2 due to possible bug: https://github.com/Unitech/pm2/issues/2066
 *
 * @param {function} write The stream write function
 *
 * @return {function} The wrapper write function
 */
function wrapWrite(write) {
    let buffer = '';

    return (str) => {
        buffer += str;

        if (str.indexOf('\n') !== -1) {
            write(buffer);
            buffer = '';
        }
    };
}

// Configure bluebird stuff
// ----------------------------------------------------

// Make bluebird global
global.Promise = Promise;

// Improve debugging by enabling long stack traces.. it has minimal impact in production
Promise.config({ longStackTraces: true, warnings: false });


// Configure npmlog stuff
// ----------------------------------------------------

// Do not record logs; can't use maxRecordSize=0 because of https://github.com/npm/npmlog/issues/30
log.record.push = () => {};

// Re-implement write so that it buffers lines due to a PM2 bug
// If the `NODE_APP_INSTANCE` variable is set, then we assume that PM2 is managing us
if (process.env.NODE_APP_INSTANCE) {
    process.stdout.write = wrapWrite(process.stdout.write);
    process.stderr.write = wrapWrite(process.stderr.write);
}

// Add custom log levels
log.addLevel('stat', log.levels.warn - 100, { fg: 'green', bg: 'black' });

// Log error stacks for `err` properties
log.on('log', (entry) => {
    if (log.levels[entry.level] < log.levels.warn) {
        return;
    }

    const err = entry.messageRaw[1] && entry.messageRaw[1].err;

    if (err && err.stack) {
        const stack = err.stack.replace(err.toString(), '').trim();

        entry.messageRaw.push(err);
        entry.message += `\nStack:\n${stack}\n`;
    }
});
