'use strict';

const path = require('path');
const Promise = require('bluebird');
const unlink = Promise.promisify(require('fs').unlink);
const exec = require('../../util/exec');

function untar(file) {
    const destDir = path.dirname(file);

    return exec(`tar -xf ${file} -C ${destDir} --strip-components=1`)
    .then(() => unlink(file))
    .then(() => exec(`chmod -R 0777 ${destDir}`));
}

module.exports = untar;
