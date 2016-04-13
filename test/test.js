/* eslint global-require:0 */

'use strict';

require('../lib/configure');

const fs = require('fs');
const nock = require('nock');
const sepia = require('./util/sepia');

// Configure nock & sepia
beforeEach(() => {
    sepia.disable();
    nock.cleanAll();
});

// Auto-load tests
const walk = (dir) => fs.readdirSync(dir).forEach((file) => {
    const filePath = [dir, file].join('/');

    if (fs.statSync(filePath).isDirectory()) {
        describe(file, () => walk(filePath));
    } else {
        require(filePath);
    }
});

walk(`${__dirname}/spec`);
