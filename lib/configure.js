'use strict';

const Promise = require('bluebird');
const pino = require('pino');
const forIn = require('lodash/forIn');
const wrap = require('lodash/wrap');

// Configure bluebird
// ----------------------------------------------------

// Make bluebird global
global.Promise = Promise;

// Improve debugging by enabling long stack traces.. it has minimal impact in production
Promise.config({ longStackTraces: true, warnings: false });

// Configure global logger (pino)
// ----------------------------------------------------

const logger = global.logger = pino({ name: 'npms-analyzer' }, process.stdout);

logger.children = {};

// Make sure that changing the level, affects all children
/* eslint-disable no-invalid-this */
logger[pino.symbols.setLevelSym] = wrap(logger[pino.symbols.setLevelSym], function (setLevel, level) {
    setLevel.call(this, level);

    if (this === logger) {
        forIn(logger.children, (child) => { child.level = level; });
    }
});
/* eslint-disable no-invalid-this */

// Make some restrictions on the usage of .child()
logger.child = wrap(logger.child, (createChild, bindings) => {
    if (!bindings || !bindings.module) {
        throw new Error('Expected logger.child to have a module property');
    }
    if (logger.children[bindings.module]) {
        throw new Error(`A logger named ${bindings.module} already exists`);
    }

    const child = createChild.call(logger, bindings);

    logger.children[bindings.module] = child;
    child.child = () => { throw new Error('Unable to use child() on a non-root logger'); };

    return child;
});

// Ensure logs are flushed when the process terminates
process.on('exit', () => logger[pino.symbols.streamSym].flushSync());
process.on('uncaughtException', (err) => {
    logger[pino.symbols.streamSym].flushSync();
    throw err;
});
