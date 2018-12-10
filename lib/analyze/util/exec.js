'use strict';

const cp = require('child_process');
const escapeshellarg = require('php-escape-shell').php_escapeshellarg;

/**
 * Es6 tagged template to be used to automatically escape placeholders.
 *
 * @param {Array}     pieces        - The pieces array.
 * @param {...String} substitutions - The substitutions.
 *
 * @returns {String} The interpolated string.
 */
function escape(pieces, ...substitutions) {
    let result = pieces[0];

    substitutions.forEach((substitution, index) => {
        result += escapeshellarg(substitution) + pieces[index + 1];
    });

    return result;
}

/**
 * Wrapper around `child_process#exec` that returns a promise.
 *
 * @param {String} command - The shell command.
 * @param {Object} options - The options to pass to `child_process#exec`.
 *
 * @returns {Promise} The promise to exec.
 */
function exec(command, options) {
    return new Promise((resolve, reject) => {
        cp.exec(command, options, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;

                // Change `code` property to `exitCode` to be consistent with our errors (code are strings)
                err.exitCode = err.code;
                delete err.code;

                reject(err);
            } else {
                resolve([stdout, stderr]);
            }
        });
    });
}

module.exports = exec;
module.exports.escape = escape;
