'use strict';

const readFile = Promise.promisify(require('fs').readFile);

const log = logger.child({ module: 'util/file-contents' });

/**
 * Gets the file contents of a file.
 *
 * @param {String} path - The path.
 *
 * @returns {Promise} A promise that fulfills when done.
 */
function fileContents(path) {
    return readFile(path)
    .then((buffer) => buffer.toString())
    // Return 0 if path does not exist
    .catch({ code: 'ENOENT' }, () => null)
    // Return 0 if path is directory
    .catch({ code: 'EISDIR' }, () => null)
    // Return 0 if too many symlinks are being followed, e.g.: `condensation`
    .catch({ code: 'ELOOP' }, (err) => {
        log.warn({ err }, `ELOOP while getting file size of ${path}, returning 0..`);

        return null;
    })
    // Ignore errors of packages that have large nested paths.. e.g.: `cordova-plugin-forcetouch`
    .catch({ code: 'ENAMETOOLONG' }, (err) => {
        /* istanbul ignore next */
        log.warn({ err }, `ENAMETOOLONG while getting file size of ${path}, returning 0..`);
        /* istanbul ignore next */

        return null;
    });
}

module.exports = fileContents;
