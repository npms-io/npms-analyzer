'use strict';

const folderFileSize = Promise.promisify(require('get-folder-size'));

/**
 * Gets the file size of a path.
 * Works with files and directories.
 *
 * On certain errors, the promise will resolve to `-1`.
 *
 * @param {string} path The path
 *
 * @return {Promise} A promise that fulfills when done
 */
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
