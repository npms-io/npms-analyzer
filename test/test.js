/* eslint global-require:0 */

'use strict';

const fs = require('fs');
const log = require('npmlog');

require('../lib/configure');
log.level = 'silent';

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
