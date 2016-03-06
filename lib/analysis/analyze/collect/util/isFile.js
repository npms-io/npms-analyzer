'use strict';

const fs = require('fs');

/**
 * Checks if a path is a file.
 *
 * @param {string} path The file path
 *
 * @return {Promise} A promise that fulfills when done
 */
function isFile(path) {
    return new Promise((resolve, reject) => {
        fs.stat(path, (err, stats) => {
            if (!err) {
                resolve(stats.isFile());
            } else if (err.code === 'ENOENT') {
                resolve(false);
            } else {
                reject(err);
            }
        });
    });
}

module.exports = isFile;
