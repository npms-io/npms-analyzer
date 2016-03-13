'use strict';

const fs = require('fs');
const got = require('got');
const log = require('npmlog');
const untar = require('./util/untar');
const gotRetries = require('../util/gotRetries');

const logPrefix = 'download/npm';

function download(url, target, tmpDir) {
    const tarballFile = `${tmpDir}/tarball.tar`;

    log.verbose(logPrefix, `Will download tarball of ${target}..`, { url });

    // Download tarball
    return new Promise((resolve, reject) => {
        got.stream(url, { timeout: 15000, retries: gotRetries })
        .on('error', reject)
        .pipe(fs.createWriteStream(tarballFile))
        .on('error', reject)
        .on('finish', resolve);
    })
    // Extract tarball
    .then(() => {
        log.verbose(logPrefix, `Successfully downloaded ${target} tarball, will now extract ..`, { tarballFile });
        return untar(tarballFile);
    })
    // Check if the repository does not exist
    .catch((err) => err.statusCode === 404, (err) => {
        log.warn(logPrefix, `Download of ${target} tarball failed with ${err.statusCode}`, { err });
    })
    .catch((err) => {
        log.error(logPrefix, `Download of ${target} tarball failed`, { err });
        throw err;
    });
}

function npm(packageJson) {
    return (tmpDir) => {
        const url = packageJson.dist && packageJson.dist.tarball;
        const target = `${packageJson.name}@${packageJson.version}`;

        // Check if there's a tarball.. yes that's right, there are some modules that don't have tarballs,
        // e.g.: roost-mongo@0.1.0
        if (!url) {
            log.warn(logPrefix, `No tarball url for ${target}`);
            return Promise.resolve();
        }

        return download(url, target, tmpDir)
        .return();
    };
}

module.exports = npm;
