'use strict';

exports.command = 'tasks';
exports.describe = 'Execute a task';

exports.builder = (yargs) =>
    yargs
    .usage('Group of task commands, choose one of the available commands.\n\nUsage: $0 tasks <command> [options]')

    .default('log-level', 'info')

    .commandDir('./tasks')
    .demandCommand(1, 'Please supply a valid command');
