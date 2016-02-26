'use strict';

const Promise = require('bluebird');
const fs = require('fs');

function isFile(path) {
    return new Promise((resolve, reject) => {
        fs.stat(path, (err, stats) => {
            if (!err) {
                resolve(stats.isFile());
            } else if (err.code === 'ENOENT') {
                resolve(false);
            } else {
                reject(err);
            }
        });
    });
}

module.exports = isFile;
