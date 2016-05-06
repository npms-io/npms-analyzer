'use strict';

const log = logger.child({ module: 'stats/queue' });

/**
 * Continuously monitor the queue, printing information such as the number of enqueued messages.
 *
 * @param {Queue} queue The queue instance
 */
function statQueue(queue) {
    // Do nothing if loglevel is higher than info
    if (log.level === 'fatal' || log.level === 'error' || log.level === 'warn') {
        return;
    }

    let pending = false;

    setInterval(() => {
        if (pending) {
            log.info('Queue stat is still being retrieved..');
            return;
        }

        pending = true;

        queue.stat()
        .finally(() => { pending = false; })
        .then((stat) => {
            log.info({ stat }, 'Queue stat');
        }, (err) => {
            log.error({ err }, 'Queue stat failed');
        })
        .done();
    }, 15000)
    .unref();
}

module.exports = statQueue;
