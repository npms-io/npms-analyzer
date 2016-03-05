#!/usr/bin/env node

/* eslint global-require:0, no-unused-expressions:0 */

'use strict';

const assert = require('assert');
const yargs = require('yargs');

// CLI definition
yargs
.strict()
.wrap(Math.min(120, yargs.terminalWidth()))
.help('help').alias('help', 'h')
.usage('Usage: ./$0 <cmd> [options]')
.demand(1, 1)

.option('log-level', {
    type: 'string',
    default: 'warn',
    alias: 'll',
    describe: 'The log level to use (error, warn, info, verbose, etc.)',
    global: true,
})

.command('observe', 'Starts observing module changes and pushes them into a queue', (yargs) => {
    yargs
    .usage('Usage: ./$0 observe [options]')
    .option('default-seq', {
        type: 'number',
        default: 0,
        alias: 'ds',
        describe: 'The default seq to be used on first run',
    })
    .check((argv) => {
        assert(typeof argv.defaultSeq === 'number', 'Invalid argument: --default-seq must be a number');
        return true;
    });
}, () => handleCommand('observe'))
.command('consume', 'Consumes modules from the queue, analyzing them', (yargs) => {
    yargs
    .usage('Usage: ./$0 consume [options]')
    .option('concurrency', {
        type: 'number',
        default: 2,
        alias: 'c',
        describe: 'Number of modules to consume concurrently',
    })
    .check((argv) => {
        assert(typeof argv.concurrency === 'number', 'Invalid argument: --concurrency must be a number');
        return true;
    });
}, () => handleCommand('consume'))
.command('analyze', 'Analyzes a single module', (yargs) => {
    yargs
    .usage('Usage: ./$0 analyze <module>  [options]')
    .demand(2, 2);
}, () => handleCommand('analyze'))
.argv;

// ----------------------------------------------------------------------------

function handleCommand(cmd) {
    require('./lib/setup');   // Setup
    require(`./lib/cli/${cmd}`);  // Run actual command
}
