'use strict';

const argv = require('yargs').argv;
const nano = require('nano');
const Promise = require('bluebird');
const prettyjson = require('prettyjson');
const analyze = require('../analysis/analyze');

// Split out tokens into an array
const githubTokens = process.env.GITHUB_TOKENS && process.env.GITHUB_TOKENS.split(/\s*,\s*/);

// Prepare DB stuff
const npmNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPM_ADDR, { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPMS_ADDR, { requestDefaults: { timeout: 15000 } }));

// Analyze each module in sequence
const moduleNames = argv._.slice(1);

Promise.each(moduleNames, (moduleName) => {
    return analyze(moduleName, npmNano, npmsNano, {
        githubTokens,
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
