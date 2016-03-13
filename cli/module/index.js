/* eslint global-require:0 */

'use strict';

const assert = require('assert');

module.exports = (yargs) => {
    return yargs
    .usage('Group of module related commands, choose one of the available commands.\n\nUsage: ./$0 module <command> <module> [options]')
    .demand(2, 'Please supply a valid command')
    .default('log-level', 'verbose')

    .check((argv) => {
        assert(!argv._[1], `Unknown command: ${argv._[1]}`);
        return true;
    })

    .command('analyze', 'Analyzes a single module', require('./analyze'));
};
