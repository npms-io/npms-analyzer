'use strict';

const stat = Promise.promisify(require('fs').stat);
const glob = Promise.promisify(require('glob'));

const log = logger.child({ module: 'util/file-size' });

/**
 * Gets the size of a regular file(s).
 *
 * @param {string|array} path The path(s)
 *
 * @return {Promise} A promise that fulfills when done
 */
function fileSize(path) {
    const paths = Array.isArray(path) ? path : [path];

    return Promise.map(paths, (path) => {
        return stat(path)
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
        });
    }, { concurrency: 50 })
    .then((sizes) => sizes.reduce((sum, size) => sum + size, 0));
}

/**
 * Gets the size of a directory.
 *
 * @param {string} dir The directory path
 *
 * @return {Promise} A promise that fulfills when done
 */
function fileSizeDir(dir) {
    return glob(`${dir}/**/*`, {
        nodir: true,
        dot: true,
        silent: true,   // Do not print warnings
        strict: false,  // Do not crash on the first error
    })
    .then((paths) => fileSize(paths));
}

module.exports = fileSize;
module.exports.dir = fileSizeDir;
