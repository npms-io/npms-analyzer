'use strict';

const config = require('config');
const argv = require('yargs').argv;
const nano = require('nano');
const prettyjson = require('prettyjson');
const analyze = require('../analysis/analyze');

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(config.get('couchdbNpmAddr'), { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(config.get('couchdbNpmsAddr'), { requestDefaults: { timeout: 15000 } }));

// Analyze each module in sequence
const moduleNames = argv._.slice(1);

Promise.each(moduleNames, (moduleName) => {
    return analyze(moduleName, npmNano, npmsNano, {
        githubTokens: config.get('githubTokens'),
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
