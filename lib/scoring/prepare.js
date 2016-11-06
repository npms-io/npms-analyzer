'use strict';

const fs = require('fs');
const JSON5 = require('json5');
const difference = require('lodash/difference');

const esIndexConfig = JSON5.parse(fs.readFileSync(`${__dirname}/../../config/elasticsearch/npms.json5`));
const log = logger.child({ module: 'scoring/prepare' });

/**
 * Prepares the start of a scoring cycle.
 * Collects information about the current indices and aliases, creates a new index for the
 * scores to be written and updates the `npms-new` alias to point to it.
 *
 * @param {Elastic} esClient The Elasticsearch instance
 *
 * @return {Promise} A promise that resolves with the Elasticsearch information
 */
function prepare(esClient) {
    const esInfo = {};

    log.info('Preparing scoring..');

    // Get current indices and aliases
    return Promise.try(() => {
        return Promise.all([
            esClient.cat.indices({ h: ['index'] }),
            esClient.cat.aliases({ h: ['alias', 'index'] }),
        ])
        .spread((indicesCat, aliasesCat) => {
            esInfo.indices = [];
            esInfo.aliases = { current: [], new: [] };

            (indicesCat || '').split(/\s*\n\s*/).forEach((lines) => {
                const split = lines.split(/\s+/);
                const index = split[0];

                /^npms-\d+$/.test(index) && esInfo.indices.push(index);
            });

            (aliasesCat || '').split(/\s*\n\s*/).forEach((lines) => {
                const split = lines.split(/\s+/);
                const alias = split[0];
                const index = split[1];
                const match = alias.match(/^npms-(current|new)$/);

                match && esInfo.aliases[match[1]].push(index);
            });
        })
        .then(() => log.debug({ esInfo }, 'Gathered Elasticsearch info..'));
    })
    // Create a new index in which the scores will be written
    .then(() => {
        esInfo.newIndex = `npms-${Date.now()}`;

        return esClient.indices.create({ index: esInfo.newIndex, body: esIndexConfig })
        .then(() => log.debug({ index: esInfo.newIndex }, 'Created new index'));
    })
    // Update the `npms-new` alias to point to the previously created index
    .then(() => {
        // Remove any `npms-new` alias
        const actions = esInfo.aliases.new.map((index) => {
            return { remove: { index, alias: 'npms-new' } };
        });

        // Add the new `npms-new` alias
        actions.push({ add: { index: esInfo.newIndex, alias: 'npms-new' } });

        return esClient.indices.updateAliases({ body: { actions } })
        .then(() => log.debug({ actions }, 'Updated npms-new alias'));
    })
    // Remove all indices except the ones pointing to `npms-current` (should be only 1)
    .then(() => {
        const indices = difference(esInfo.indices, esInfo.aliases.current);

        return indices.length && esClient.indices.delete({ index: indices })
        .then(() => log.debug({ indices }, 'Removed unnecessary indices'));
    })
    .return(esInfo);
}

module.exports = prepare;
