'use strict';

const cp = require('child_process');
const escapeshellarg = require('php-escape-shell').php_escapeshellarg;

/**
 * es6 tagged template to be used to automatically escape placeholders.
 *
 * @param {array}     pieces        The pieces array
 * @param {...string} substitutions The substitutions
 *
 * @return {string} The interpolated string
 */
function escape(pieces) {
    let result = pieces[0];
    const substitutions = [].slice.call(arguments, 1);

    substitutions.forEach((substitution, index) => {
        result += escapeshellarg(substitution) + pieces[index + 1];
    });

    return result;
}

/**
 * Wrapper around `child_process#exec` that returns a promise.
 *
 * @param {string} command The shell command
 * @param {object} options The options to pass to `child_process#exec`
 *
 * @return {Promise} The promise to exec
 */
function exec(command, options) {
    return new Promise((resolve, reject) => {
        cp.exec(command, options, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            } else {
                resolve([stdout, stderr]);
            }
        });
    });
}

module.exports = exec;
module.exports.escape = escape;
