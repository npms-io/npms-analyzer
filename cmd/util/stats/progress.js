'use strict';

const pino = require('pino');

const log = logger.child({ module: 'stats/progress' });

// TODO: Add status for replication and other stuff?

/**
 * Continuously monitor the analyzer progress, printing information such as the analysis %.
 *
 * @param {Nano} npmNano  - The npm nano client instance.
 * @param {Nano} npmsNano - The npms nano client instance.
 */
function statProgress(npmNano, npmsNano) {
    // Do nothing if loglevel is higher than info
    if (log.levelVal > pino.levels.values.info) {
        return;
    }

    let pending = false;

    setInterval(() => {
        if (pending) {
            log.info('Progress stat is still being retrieved..');

            return;
        }

        pending = true;

        Promise.props({
            npmDocsCount: npmNano.infoAsync().then((res) => res.doc_count),
            npmDesignDocsCount: npmNano.listAsync({ startkey: '_design/', endkey: '_design0' }).then((res) => res.rows.length),
            npmsPackagesCount: npmsNano.viewAsync('npms-analyzer', 'packages-evaluation', { reduce: true })
            .then((res) => res.rows[0] ? res.rows[0].value : 0),
        })
        .finally(() => { pending = false; })
        .then((result) => {
            const analysis = `${(result.npmsPackagesCount / (result.npmDocsCount - result.npmDesignDocsCount) * 100).toFixed(4)}%`;

            log.info({ analysis }, 'Progress stat');
        }, (err) => {
            log.error({ err }, 'Progress stat failed');
        })
        .done();
    }, 15000)
    .unref();
}

module.exports = statProgress;
