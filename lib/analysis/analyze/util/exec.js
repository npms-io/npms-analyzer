'use strict';

const cp = require('child_process');

function exec(command, options) {
    return new Promise((resolve, reject) => {
        cp.exec(command, options, (err, stdout, stderr) => {
            stdout = stdout && stdout.toString();
            stderr = stderr && stderr.toString();

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
