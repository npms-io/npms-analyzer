'use strict';

const path = require('path');
const which = require('which');
const unlink = Promise.promisify(require('fs').unlink);
const exec = require('../../util/exec');

// Prefer bsdtar over the installed tar.. bsdtar is more benevolent when dealing with certain errors
// See: http://comments.gmane.org/gmane.comp.gnu.mingw.msys/4816
const tarExec = (() => { try { return which.sync('bsdtar'); } catch (err) { return 'tar'; } })();
const malformedRegExp = /unrecognized archive format|does not look like a tar archive|not in gzip format|unknown compression format/i;

/**
 * Asserts that the number of files in the tar archive is below a certain threshold.
 *
 * @param {string} file     The file path
 * @param {number} maxFiles The total number of files
 *
 * @return {Promise} A promise that fulfills when done
 */
function assertFilesCount(file, maxFiles) {
    // Ignore "unknown extended header XX" because there might be a lot of them, e.g.: pickles2-contents-editor
    // This only happens when using gnu tar, see: http://lee.greens.io/blog/2014/05/06/fix-tar-errors-on-os-x/
    // e.g.: http://registry.npmjs.org/pickles2-contents-editor/-/pickles2-contents-editor-2.0.0-alpha.1.tgz
    return exec(exec.escape`
listFiles() {
    ${tarExec} -ztf ${file}
}
filter() {
    (grep -v "unknown extended header"; exit 0)
}

set -o pipefail
{ listFiles 2>&1 1>&3 | filter 1>&2; } 3>&1 | wc -l
`, { shell: '/bin/bash' })
    .spread((stdout) => parseInt(stdout, 10))
    .tap((filesCount) => {
        if (isNaN(filesCount)) {
            throw Object.assign(new Error('Unable to retrieve the number of files within the tarball'),
                { unrecoverable: true, tarballFile: file });
        }

        if (filesCount > maxFiles) {
            throw Object.assign(new Error('Tarball has too many files'), { unrecoverable: true, tarballFile: file });
        }
    });
}

/**
 * Decompresses a tar file to a directory.
 *
 * @param {string} file    The file path
 * @param {string} destDir The destination directory
 *
 * @return {Promise} A promise that fulfills when done
 */
function decompress(file, destDir) {
    // Ignore "unknown extended header XX" because there might be a lot of them, e.g.: pickles2-contents-editor
    // This only happens when using gnu tar, see: http://lee.greens.io/blog/2014/05/06/fix-tar-errors-on-os-x/
    // e.g.: http://registry.npmjs.org/pickles2-contents-editor/-/pickles2-contents-editor-2.0.0-alpha.1.tgz
    return exec(exec.escape`
decompress() {
    ${tarExec} -xf ${file} -C ${destDir} --strip-components=1
}
filter() {
    (grep -v "unknown extended header"; exit 0)
}

set -o pipefail
{ decompress 2>&1 1>&3 | filter 1>&2; } 3>&1
`, { shell: '/bin/bash' })
    .then(() => exec(exec.escape`chmod -R 0777 ${destDir}`));
}

// --------------------------------------------------

/**
 * Small utility to untar a file.
 * Malformed tar errors are ignored.
 *
 * @param {string} file      The file path
 * @param {object} [options] he options; read below to get to know each available option
 *
 * @return {Promise} A promise that fulfills when done
 */
function untar(file, options) {
    options = Object.assign({ maxFiles: 32000 }, options);

    const destDir = path.dirname(file);

    // Check the number of files
    return assertFilesCount(file, options.maxFiles)
    // Proceed with decompressing
    .then(() => decompress(file, destDir))
    // Delete tar file
    .then(() => unlink(file))
    // Ignore invalid tar files.. sometimes services respond with JSON
    // e.g.: http://registry.npmjs.org/n-pubsub/-/n-pubsub-1.0.0.tgz
    // e.g.: testing233 package, that somehow was able to set dist to http://example.com
    .catch((err) => malformedRegExp.test(err.stderr), () => {
        throw Object.assign(new Error('Tarball is malformed'), { tarballFile: file });
    })
    .return(destDir);
}

module.exports = untar;
