#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const yargs = require('yargs');
const dotenv = require('dotenv');
const log = require('npmlog');

let parsedCmd;

/**
 * Little utility function to setup common yargs stuff.
 *
 * @param {yargs}  yargs The yargs instance
 * @param {string} cmd   The command name
 *
 * @return {yargs} Chaining!
 */
function setupYargs(yargs, cmd) {
    yargs
    .wrap(Math.min(120, yargs.terminalWidth()))
    .help('help').alias('help', 'h');

    if (cmd) {
        parsedCmd = cmd;

        yargs
        .usage(`Usage: ./$0 ${cmd} [options]`)
        .option('log-level', {
            type: 'string',
            default: 'warn',
            alias: 'll',
            describe: 'The log level to use (error, warn, info, verbose, etc.)',
        })
        .option('env-file', {
            type: 'string',
            default: '.env',
            alias: 'e',
            describe: 'The .env file to use',
        });
    } else {
        yargs.usage('Usage: ./$0 <cmd> [options]');
    }

    return yargs;
}

// CLI definition
const argv = setupYargs(yargs)
.demand(1, 1)
.command('observe', 'Starts observing module changes and pushes them into a queue', (yargs) => {
    setupYargs(yargs, 'observe')
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
})
.command('consume', 'Consumes modules from the queue, analyzing them', (yargs) => {
    setupYargs(yargs, 'consume')
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
})
.argv;

if (!parsedCmd) {
    yargs.showHelp();
    process.stdout.write('Unknown command\n');
    process.exit(1);
}

// ----------------------------------------------------------------------------

// Configure logger
log.level = argv.logLevel;

// Process .env file
try {
    fs.accessSync(argv.envFile);
} catch (err) {
    if (err.code === 'ENOENT') {
        log.error('', `${path.resolve(argv.envFile)} does not exist`);
        process.exit(1);
    }

    throw err;
}

dotenv.config({ silent: true, path: argv.envFile });

// Run actual command
require(`./cmds/${parsedCmd}`);
