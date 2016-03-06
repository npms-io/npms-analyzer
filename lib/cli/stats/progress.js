'use strict';

const log = require('npmlog');

// TODO: Add status for replication and other stuff?

function statProgress(npmNano, npmsNano) {
    // Do nothing if loglevel is higher than stat
    if (log.levels[log.level] < log.level.stat) {
        return () => {};
    }

    // Request the design docs so that they are decremented from the number of docs
    // We only do this once, to avoid querying this "view" in each interval
    const designDocs = {
        npm: npmNano.listAsync({ startkey: '_design/', endkey: '_design0' }),
        npms: npmsNano.listAsync({ startkey: '_design/', endkey: '_design0' }),
    };

    let pending = false;

    setInterval(() => {
        if (pending) {
            log.stat('progress', 'Progress stat is taking too long to be retrieved..');
            return;
        }

        pending = true;

        Promise.props({
            info: Promise.props({
                npm: npmNano.infoAsync(),
                npms: npmsNano.infoAsync(),
            }),
            designDocs: Promise.props(designDocs),
        })
        .finally(() => { pending = false; })
        .then((res) => {
            const npmCount = res.info.npm.doc_count - res.designDocs.npm.rows.length;
            const npmsCount = res.info.npms.doc_count - res.designDocs.npms.rows.length - 1;  // dec last followed seq

            // Subtract 1 from npms because of the last followed doc
            const analysis = `${(npmsCount / npmCount * 100).toFixed(4)}%`;

            log.stat('progress', 'Progress stat', { analysis });
        }, (err) => {
            log.error('progress', 'Progress stat failed', { err });
        })
        .catch((err) => log.error('progress', 'Failed to stat progress', { err }));
    }, 15000)
    .unref();
}

module.exports = statProgress;
