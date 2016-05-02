'use strict';

const log = logger.child({ module: 'scoring/finalize' });

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
    log.info('Finalizing scoring');

    // Update `npms-read` alias to point to the new index
    return Promise.try(() => {
        const actions = esInfo.aliases.read.map((index) => {
            return { remove: { index, alias: 'npms-read' } };
        });

        actions.push({ add: { index: esInfo.newIndex, alias: 'npms-read' } });

        return esClient.indices.updateAliases({ body: { actions } })
        .then(() => log.debug({ actions }, 'Updated npms-read alias'));
    })
    // Remove old indices
    .then(() => {
        const indices = esInfo.aliases.read;

        return indices.length && esClient.indices.delete({ index: indices })
        .then(() => log.debug({ indices }, 'Removed old indices pointing to npms-read'));
    })
    .return();
}

module.exports = finalize;
