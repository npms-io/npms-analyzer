'use strict';

const path = require('path');
const log = require('npmlog');
const unlink = Promise.promisify(require('fs').unlink);
const exec = require('../../util/exec');

function untar(file) {
    const destDir = path.dirname(file);

    return exec(`tar -xf ${file} -C ${destDir} --strip-components=1`)
    // Ignore invalid tar files.. sometimes services respond with JSON
    // e.g. http://registry.npmjs.org/n-pubsub/-/n-pubsub-1.0.0.tgz
    .catch((err) => {
        if (!/unrecognized archive format/i.test(err)) {
            throw err;
        }

        log.warn('untar', 'Malformed archive file, ignoring..', { file });
    })
    .then(() => unlink(file))
    .then(() => exec(`chmod -R 0777 ${destDir}`));
}

module.exports = untar;
