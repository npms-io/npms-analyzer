'use strict';

const Promise = require('bluebird');
const folderFileSize = Promise.promisify(require('get-folder-size'));

function getFileSize(path) {
    return folderFileSize(path)
    .catch((err) => {
        if (err.code === 'ENOENT') {
            return 0;
        }

        throw err;
    });
}

module.exports = getFileSize;
