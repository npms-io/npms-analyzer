'use strict';

require('./lib/configure');

const couchdbIterator = require('couchdb-iterator');
const hostedGitInfo = require('./lib/analyze/util/hostedGitInfo');
const got = require('got');

couchdbIterator('http://localhost:5984/npms', 'tmp/foo', (row) => {
    const info = hostedGitInfo(row.value);

    if (!info) {
        console.log('invalid:', row.value);
        return;
    }

    console.log(`request: ${row.key} ${info.project}/${info.user}`);

    return got(`https://api.github.com/repos/${info.project}/${info.user}/stats/commit_activity`, {
        json: true,
        timeout: 15000,
        headers: { Authorization: 'token 164ae1dd853bda89cbaccb4423fe9abfd0409a14' },
    })
    .catch((err) => {
        if (err.statusCode === 403) {
            console.log('found:', row.key);
            console.log(err);
            process.exit();
        }
        console.log('error: ', `${info.project}/${info.user}`, err.message);
    });
}, {
    concurrency: 5,
    startkey: 'module!stormstack\ufff0',
});

