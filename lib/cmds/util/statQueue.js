'use strict';

const log = require('npmlog');

function statQueue(queue, interval) {
    // Print queue statistical information if loglevel is equal or lower to verbose
    if (log.levels[log.level] > 1000) {
        return () => {};
    }

    const intervalId = setInterval(() => {
        queue.stat()
        .then((stat) => log.verbose('queue', 'Stat info', { stat }), () => {})
        .done();
    }, interval || 5000)
    .unref();

    return () => {
        clearInterval(intervalId);
    };
}

module.exports = statQueue;
