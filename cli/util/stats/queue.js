'use strict';

const log = require('npmlog');

/**
 * Continuously monitor the queue, printing information such as the number of enqueued messages.
 *
 * @param {Queue} queue The queue instance
 */
function statQueue(queue) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return;
    }

    let pending = false;

    setInterval(() => {
        if (pending) {
            log.stat('progress', 'Queue stat is still being retrieved..');
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
        .done();
    }, 15000)
    .unref();
}

module.exports = statQueue;
