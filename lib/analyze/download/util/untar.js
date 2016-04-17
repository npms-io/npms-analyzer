'use strict';

const path = require('path');
const log = require('npmlog');
const unlink = Promise.promisify(require('fs').unlink);
const exec = require('../../util/exec');

const logPrefix = 'util/untar';

/**
 * Small utility to untar a file.
 * Malformed tar errors are ignored.
 *
 * @param {string} file The file path
 *
 * @return {Promise} A promise that fulfills when done
 */
function untar(file) {
    const destDir = path.dirname(file);

    // Ignore "unknown extended header XX" because there might be a lot of them, e.g.: pickles2-contents-editor
    // This only happens when using gnu tar, see: http://lee.greens.io/blog/2014/05/06/fix-tar-errors-on-os-x/
    // e.g.: http://registry.npmjs.org/pickles2-contents-editor/-/pickles2-contents-editor-2.0.0-alpha.1.tgz
    return exec(exec.escape`
set -o pipefail;
tar -xf ${file} -C ${destDir} --strip-components=1 2>&1 |
(grep -v "unknown extended header" 1>&2; exit 0)
`)
    // Ignore invalid tar files.. sometimes services respond with JSON
    // e.g.: http://registry.npmjs.org/n-pubsub/-/n-pubsub-1.0.0.tgz
    .catch((err) => /(unrecognized archive format|does not look like a tar archive)/i.test(err.stderr), (err) => {
        log.warn(logPrefix, 'Malformed archive file, ignoring..', { file, err });
    })
    .then(() => unlink(file))
    .then(() => exec(exec.escape`chmod -R 0777 ${destDir}`));
}

module.exports = untar;
