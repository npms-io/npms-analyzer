'use strict';

const argv = require('yargs').argv;
const nano = require('nano');
const Promise = require('bluebird');
const prettyjson = require('prettyjson');
const analyze = require('../lib/analysis/analyze');

const npmNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPM_ADDR, { requestDefaults: { timeout: 15000 } }));
const npmsNano = Promise.promisifyAll(nano(process.env.COUCHDB_NPMS_ADDR, { requestDefaults: { timeout: 15000 } }));

const moduleName = argv._[1];

analyze(moduleName, { npmNano, npmsNano, githubToken: process.env.GITHUB_TOKEN })
.then((result) => {
    process.stdout.write(prettyjson.render(result, {
        keysColor: 'cyan',
        dashColor: 'grey',
        stringColor: 'white',
    }));
    process.stdout.write('\n');

    process.exit();
})
.done();
