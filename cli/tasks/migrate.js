'use strict';

const couchdbIterator = require('couchdb-iterator');
const couchdbForce = require('couchdb-force');
const camelcaseKeys = require('camelcase-keys');
const bootstrap = require('../util/bootstrap');
const stats = require('../util/stats');

const log = logger.child({ module: 'cli/migrate' });

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 tasks migrate [options]\n\n\
Run the latest migration.')
    .demand(0, 0);
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-migrate';
    logger.level = argv.logLevel || 'info';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpms'])
    .spread((npmsNano) => npmsNano)
    .tap(() => stats.process())
    // Migrate module! to package!
    .tap((npmsNano) => {
        log.info('Starting module! -> package! migration');

        return couchdbIterator(npmsNano, (row) => {
            row.index && row.index % 10000 === 0 && log.info(`Processed ${row.index} rows`);

            const doc = row.doc;

            if (!doc) {
                return;
            }

            const newDoc = Object.assign({}, doc, { _id: doc._id.replace(/^module!/, 'package!') });

            // dependenciesVulnerabilities -> vulnerabilities
            if (newDoc.collected.source && newDoc.collected.source.dependenciesVulnerabilities) {
                newDoc.collected.source.vulnerabilities = newDoc.collected.source.dependenciesVulnerabilities
                .map((vulnerability) => camelcaseKeys(vulnerability, { deep: true }));
                delete newDoc.collected.source.dependenciesVulnerabilities;
            }

            // dependenciesHealth -> health
            if (newDoc.evaluation.quality.dependenciesHealth == null) {
                newDoc.evaluation.quality.health = newDoc.evaluation.quality.dependenciesHealth;
                delete newDoc.evaluation.quality.dependenciesHealth;
            }

            return couchdbForce.insert(npmsNano, newDoc)
            .then(() => npmsNano.destroyAsync(doc._id, doc._rev))
            .then(() => log.debug(`Migrated ${doc._id}..`));
        }, {
            startkey: 'module!',
            endkey: 'module!\ufff0',
            concurrency: 25,
            limit: 2500,
            includeDocs: true,
        })
        .then((count) => log.info(`Completed, processed a total of ${count} rows`));
    })
    // Migrate observer!module to observer!package
    .tap((npmsNano) => {
        log.info('Starting observer!module! -> observer!package! migration');

        return couchdbIterator(npmsNano, (row) => {
            row.index && row.index % 10000 === 0 && log.info(`Processed ${row.index} rows`);

            const doc = row.doc;

            if (!doc) {
                return;
            }

            const newDoc = Object.assign({}, doc, { _id: doc._id.replace(/^observer!module!/, 'observer!package!') });

            return couchdbForce.insert(npmsNano, newDoc)
            .then(() => npmsNano.destroyAsync(doc._id, doc._rev))
            .then(() => log.debug(`Migrated ${doc._id}..`));
        }, {
            startkey: 'observer!module!',
            endkey: 'observer!module!\ufff0',
            concurrency: 25,
            limit: 2500,
            includeDocs: true,
        })
        .then((count) => log.info(`Completed, processed a total of ${count} rows`));
    })
    // Migrate design doc
    .tap((npmsNano) => {
        log.info('Migrating design doc..');

        return couchdbForce.insert(npmsNano, require('../../config/couchdb/npms-analyzer.json'))  // eslint-disable-line global-require
        .then(() => log.info('Migrated design doc'));
    })
    .then(() => process.exit())
    .done();
};
