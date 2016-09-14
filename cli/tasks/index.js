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

    .command('process-module', 'Processes a single module, analyzing and scoring it', require('./process-module'))
    .command('enqueue-view', 'Enqueues all modules contained in a npms view', require('./enqueue-view'))
    .command('enqueue-missing', 'Finds modules that were not analyzed and enqueues them', require('./enqueue-missing'))
    .command('clean-extraneous', 'Finds modules that are analyzed but no longer exist in npm', require('./clean-extraneous'))
    .command('re-metadata', 'Iterates over all analyzed modules, running the metadata collector again', require('./re-metadata'))
    .command('re-evaluate', 'Iterates over all analyzed modules, evaluating them again', require('./re-evaluate'))
    .command('optimize-db', 'Optimizes the CouchDB database, compacting itself and its views', require('./optimize-db.js'));
};
