'use strict';

const stat = Promise.promisify(require('fs').stat);
const glob = Promise.promisify(require('glob'));

const log = logger.child({ module: 'util/file-size' });

/**
 * Gets the size of a regular file(s).
 *
 * @param {String|Array} path - The path(s).
 *
 * @returns {Promise} A promise that fulfills when done.
 */
function fileSize(path) {
    const paths = Array.isArray(path) ? path : [path];

    return Promise.map(paths, (path) => (
        stat(path)
        .then((stat) => stat.isFile() ? stat.size : 0)
        // Return 0 if path does not exist
        .catch({ code: 'ENOENT' }, () => 0)
        // Return 0 if too many symlinks are being followed, e.g.: `condensation`
        .catch({ code: 'ELOOP' }, (err) => {
            log.warn({ err }, `ELOOP while getting file size of ${path}, returning 0..`);

            return 0;
        })
        // Ignore errors of packages that have large nested paths.. e.g.: `cordova-plugin-forcetouch`
        .catch({ code: 'ENAMETOOLONG' }, (err) => {
            /* istanbul ignore next */
            log.warn({ err }, `ENAMETOOLONG while getting file size of ${path}, returning 0..`);
            /* istanbul ignore next */

            return 0;
        })
    ), { concurrency: 50 })
    .then((sizes) => sizes.reduce((sum, size) => sum + size, 0));
}

/**
 * Gets the size of a directory.
 *
 * @param {String} dir - The directory path.
 *
 * @returns {Promise} A promise that fulfills when done.
 */
function fileSizeDir(dir) {
    return glob('**/*', {
        cwd: dir,
        nodir: true,
        dot: true,
        silent: true, // Do not print warnings
        strict: false, // Do not crash on the first error
    })
    .then((paths) => paths.map((path) => `${dir}/${path}`))
    .then((paths) => fileSize(paths));
}

module.exports = fileSize;
module.exports.dir = fileSizeDir;
