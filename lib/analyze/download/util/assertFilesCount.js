'use strict';

const exec = require('../../util/exec');

/**
 * Asserts that the number of files in a directory is within a certain threshold.
 *
 * This should be used by downloaders if they can't pre-calculate the number of files
 * without actually starting populating a directory with files.
 *
 * @param {string} dir     The dir
 * @param {number} maxFiles The total number of files
 *
 * @return {Promise} A promise that fulfills when done
 */
function assertFilesCount(dir, maxFiles) {
    return exec(exec.escape`find ${dir} | wc -l`)
    .spread((stdout) => parseInt(stdout, 10))
    .tap((filesCount) => {
        if (isNaN(filesCount)) {
            throw Object.assign(new Error('Unable to retrieve the number of files within the directory'),
                { unrecoverable: true, dir });
        }

        if (filesCount > maxFiles) {
            throw Object.assign(new Error('Directory has too many files'), { unrecoverable: true, dir });
        }
    });
}

module.exports = assertFilesCount;
