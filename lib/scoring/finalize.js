'use strict';

const log = require('npmlog');

const logPrefix = 'scoring/finalize';

/**
 * Finalizes the scoring cycle.
 * Updates the `npms-read` alias to point to the new index and removes all the old indices.
 *
 * @param {object}  esInfo   The object with the elasticsearch information (returned by prepare())
 * @param {Elastic} esClient The elasticsearch instance
 *
 * @return {Promise} A promise that fulfills when done
 */
function finalize(esInfo, esClient) {
    log.info(logPrefix, 'Finalizing scoring');

    // Update `npms-read` alias to point to the new index
    return Promise.try(() => {
        const actions = esInfo.aliases.read.map((index) => {
            return { remove: { index, alias: 'npms-read' } };
        });

        actions.push({ add: { index: esInfo.newIndex, alias: 'npms-read' } });

        return esClient.indices.updateAliases({ body: { actions } })
        .then(() => log.verbose(logPrefix, 'Updated npms-read alias', { actions }));
    })
    // Remove old indices
    .then(() => {
        const indices = esInfo.aliases.read;

        return indices.length && esClient.indices.delete({ index: indices })
        .then(() => log.verbose(logPrefix, 'Removed old indices pointing to npms-read', { indices }));
    })
    .return();
}

module.exports = finalize;
