'use strict';

const log = require('npmlog');

function statProgress(npmNano, npmsNano) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    const intervalId = setInterval(() => {
        Promise.props({
            npmInfo: npmNano.infoAsync(),
            npmsInfo: npmsNano.infoAsync(),
            npmDesignDocs: npmNano.listAsync({ startkey: '_design/', endkey: '_design0', stale: 'update_after' }),
            npmsDesignDocs: npmsNano.listAsync({ startkey: '_design/', endkey: '_design0', stale: 'update_after' }),
        })
        .then((res) => {
            const npmCount = res.npmInfo.doc_count - res.npmDesignDocs.rows.length;
            const npmsCount = res.npmsInfo.doc_count - res.npmsDesignDocs.rows.length - 1;  // dec last followed seq

            // Subtract 1 from npms because of the last followed doc
            const analysis = `${(npmsCount / npmCount * 100).toFixed(4)}%`;

            log.stat('progress', 'Progress stat', { analysis });
        }, (err) => {
            log.error('progress', 'Progress stat failed', { err });
        })
        .catch((err) => log.error('progress', 'Failed to stat progress', { err }));
    }, 15000)
    .unref();

    return () => {
        clearInterval(intervalId);
    };
}

module.exports = statProgress;
