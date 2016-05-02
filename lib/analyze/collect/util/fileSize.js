'use strict';

const folderFileSize = Promise.promisify(require('get-folder-size'));

const log = logger.child({ module: 'util/get-file-size' });

/**
 * Gets the file size of a path.
 *
 * Works with files and directories. On certain errors, the promise will resolve to `-1`.
 *
 * @param {string} path The path
 *
 * @return {Promise} A promise that fulfills when done
 */
function getFileSize(path) {
    return folderFileSize(path)
    // Return 0 if path does not exist
    .catch({ code: 'ENOENT' }, () => 0)
    // Ignore errors of modules that have large nested paths..
    // This was happening in some modules, e.g.: `cordova-plugin-forcetouch`
    .catch({ code: 'ENAMETOOLONG' }, (err) => {
        log.warn({ err }, `ENAMETOOLONG while getting file size of ${path}, returning -1..`);
        return -1;
    });
}

module.exports = getFileSize;
