'use strict';

const folderFileSize = Promise.promisify(require('get-folder-size'));

function getFileSize(path) {
    return folderFileSize(path)
    .catch((err) => {
        if (err.code === 'ENOENT') {
            return 0;
        }

        // Ignore large paths inside.. this was happening in some modules, e.g.: cordova-plugin-forcetouch
        if (err.code === 'ENAMETOOLONG') {
            return -1;
        }

        throw err;
    });
}

module.exports = getFileSize;
