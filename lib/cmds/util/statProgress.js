'use strict';

const log = require('npmlog');

function statProgress(npmNano, npmsNano, interval) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    const intervalId = setInterval(() => {
        Promise.all([
            npmNano.infoAsync(),
            npmsNano.infoAsync(),
        ])
        .spread((npmInfo, npmsInfo) => {
            const analysis = `${(npmsInfo.doc_count / npmInfo.doc_count * 100).toFixed(4)}%`;

            log.stat('progress', 'Progress stat', { analysis });
        }, (err) => {
            log.error('progress', 'Progress stat failed', { err });
        })
        .done();
    }, interval || 15000)
    .unref();

    return () => {
        clearInterval(intervalId);
    };
}

module.exports = statProgress;
