/* eslint global-require:0 */

'use strict';

const path = require('path');
const fs = require('fs');

if (process.cwd() !== path.join(__dirname, '..')) {
    throw new Error('Tests must be run from the project root');
}

// Configure
require('../lib/configure');
logger.level = 'fatal';

// Auto-load tests
const walk = (dir) => fs.readdirSync(dir).forEach((file) => {
    const filePath = `${dir}/${file}`;

    if (fs.statSync(filePath).isDirectory()) {
        describe(file, () => walk(filePath));
    } else {
        require(filePath);
    }
});

walk(`${__dirname}/spec`);
