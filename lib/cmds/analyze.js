'use strict';

const argv = require('yargs').argv;
const nano = require('nano');
const prettyjson = require('prettyjson');
const config = require('../../config.json');
const analyze = require('../analysis/analyze');

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(config.couchdbNpmAddr, { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(config.couchdbNpmsAddr, { requestDefaults: { timeout: 15000 } }));

// Analyze each module in sequence
const moduleNames = argv._.slice(1);

Promise.each(moduleNames, (moduleName) => {
    return analyze(moduleName, npmNano, npmsNano, {
        githubTokens: config.githubTokens,
    })
    .then((result) => {
        process.stdout.write(prettyjson.render(result, {
            keysColor: 'cyan',
            dashColor: 'grey',
            stringColor: 'white',
        }));
        process.stdout.write('\n');
    });
})
.done();
