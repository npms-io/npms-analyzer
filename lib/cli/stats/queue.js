'use strict';

const log = require('npmlog');

function statQueue(queue) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    let pending = false;

    setInterval(() => {
        if (pending) {
            log.stat('progress', 'Queue stat is taking too long to be retrieved..');
            return;
        }

        pending = true;

        queue.stat()
        .finally(() => { pending = false; })
        .then((stat) => {
            log.stat('queue', 'Queue stat', stat);
        }, (err) => {
            log.error('queue', 'Queue stat failed', { err });
        })
        .catch((err) => log.error('progress', 'Failed to stat queue', { err }));
    }, 15000)
    .unref();
}

module.exports = statQueue;
