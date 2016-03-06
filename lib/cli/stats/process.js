'use strict';

const log = require('npmlog');
const humanizeDuration = require('humanize-duration');

function statProcess() {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    const pid = process.pid;

    setInterval(() => {
        const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const uptime = humanizeDuration(process.uptime() * 1000, { largest: 1 });

        log.stat('process', `pid: ${pid}; memory: ${memoryUsage} MB; uptime: ${uptime}`);
    }, 15000)
    .unref();
}

module.exports = statProcess;
