'use strict';

const Promise = require('bluebird');
const pino = require('pino');
const pinoErrSerializer = require('pino-err-serializer');
const forIn = require('lodash/forIn');
const Big = require('bignumber.js');

// Configure bluebird
// ----------------------------------------------------

// Make bluebird global
global.Promise = Promise;

// Improve debugging by enabling long stack traces.. it has minimal impact in production
Promise.config({ longStackTraces: true, warnings: false });


// Configure BigNumber
// ----------------------------------------------------

// Set BigNumber decimal places for a faster scoring
Big.config({ DECIMAL_PLACES: 16, POW_PRECISION: 100, ERRORS: false });


// Configure global logger (pino)
// ----------------------------------------------------

const logger = global.logger = pino({ name: 'npms-analyzer', serializers: { err: pinoErrSerializer } });
const loggerPrototype = Object.getPrototypeOf(logger);

// Make sure that changing the level, affects all children
logger.children = {};
logger.child = (bindings) => {
    const child = loggerPrototype.child.call(logger, bindings);

    if (!bindings.module) {
        throw new Error('Expected logger.child to have a module property');
    }

    logger.children[bindings.module] = child;
    child.child = () => { throw new Error('Unable to use child() on a non-root logger'); };

    return child;
};

Object.defineProperty(logger, 'level', {
    get: loggerPrototype._getLevel,
    set: (level) => {
        loggerPrototype._setLevel.call(logger, level);
        forIn(logger.children, (child) => { child.level = level; });
    },
});
