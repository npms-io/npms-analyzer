'use strict';

const pino = require('pino');
const humanizeDuration = require('humanize-duration');

const log = logger.child({ module: 'stats/process' });

/**
 * Continuously monitor the process, printing metrics such as the memory and uptime.
 */
function statProcess() {
    // Do nothing if loglevel is higher than info
    if (log.levelVal > pino.levels.values.info) {
        return;
    }

    const pid = process.pid;

    setInterval(() => {
        const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const uptime = humanizeDuration(Math.round(process.uptime()) * 1000, { largest: 1 });

        log.info(`pid: ${pid}; memory: ${memoryUsage} MB; uptime: ${uptime}`);
    }, 15000)
    .unref();
}

module.exports = statProcess;
