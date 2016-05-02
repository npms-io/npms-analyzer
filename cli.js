#!/usr/bin/env node

/* eslint global-require:0, no-unused-expressions:0 */

'use strict';

require('heapdump');
require('./lib/configure');

const yargs = require('yargs');

yargs
.strict()
.wrap(Math.min(120, yargs.terminalWidth()))
.version().alias('version', 'v')
.help('help').alias('help', 'h')
.usage('npms-analyzer command line, choose one of the available commands.\n\nUsage: ./$0 <command> .. [options]')
.demand(1, 'Please supply a valid command')

.option('log-level', {
    type: 'string',
    default: 'warn',
    alias: 'll',
    describe: 'The log level to use (fatal, error, warn, info, debug, trace)',
    global: true,
})

.command('observe', 'Starts observing module changes and pushes them into the queue', require('./cli/observe'))
.command('consume', 'Consumes modules from the queue, analyzing them', require('./cli/consume'))
.command('scoring', 'Continuously iterate over the analyzed modules, scoring them', require('./cli/scoring'))

.command('tasks', 'Various useful tasks', require('./cli/tasks'))

.argv;
