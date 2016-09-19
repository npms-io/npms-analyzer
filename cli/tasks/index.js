/* eslint global-require:0 */

'use strict';

const assert = require('assert');

module.exports = (yargs) => {
    return yargs
    .strict()
    .usage('Group of task commands, choose one of the available commands.\n\nUsage: $0 tasks <command> [options]')
    .demand(1, 'Please supply a valid command')
    .default('log-level', 'info')

    .check((argv) => {
        assert(!argv._[1], `Unknown command: ${argv._[1]}`);
        return true;
    })

    .command('process-package', 'Processes a single package, analyzing and scoring it', require('./process-package'))
    .command('enqueue-view', 'Enqueues all packages contained in a npms view', require('./enqueue-view'))
    .command('enqueue-missing', 'Finds packages that were not analyzed and enqueues them', require('./enqueue-missing'))
    .command('clean-extraneous', 'Finds packages that are analyzed but no longer exist in npm', require('./clean-extraneous'))
    .command('re-metadata', 'Iterates over all analyzed packages, running the metadata collector again', require('./re-metadata'))
    .command('re-evaluate', 'Iterates over all analyzed packages, evaluating them again', require('./re-evaluate'))
    .command('optimize-db', 'Optimizes the CouchDB database, compacting itself and its views', require('./optimize-db.js'))
    .command('migrate', 'Run the latest migration', require('./migrate.js'));
};
