#!/bin/sh
':' //; exec "$(command -v node)" --max-old-space-size=4192  "$0" "$@"

'use strict';

// require('heapdump');
require('./lib/configure');

const yargs = require('yargs');

yargs
.strict()
.wrap(Math.min(120, yargs.terminalWidth()))
.version()
.alias('version', 'v')
.help()
.alias('help', 'h')
.usage('npms-analyzer command line, choose one of the available commands.\n\nUsage: $0 <command> .. [options]')

.option('log-level', {
    type: 'string',
    alias: 'll',
    choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
    describe: 'The log level to use',
    global: true,
})

.commandDir('./cmd')
.demandCommand(1, 'Please supply a valid command')

.argv;
