'use strict';

const fs = require('fs');
const Promise = require('bluebird');
const hostedGitInfo = require('hosted-git-info');
const tokenDealer = require('token-dealer');
const got = require('got');
const log = require('npmlog');
const untar = require('./util/untar');

const logPrefix = 'download/github';

function download(shorthand, ref, tmpDir, options) {
    const url = `https://api.github.com/repos/${shorthand}/tarball/${ref || ''}`;
    const tarballFile = `${tmpDir}/tarball.tar`;

    log.verbose(logPrefix, `Will download tarball of ${shorthand}@${ref || 'default'}..`);

    // Use token dealer to circumvent rate limit issues
    return tokenDealer(options.tokens, (token, exhaust) => {
        return new Promise((resolve, reject) => {
            const handleResponse = (response, err) => {
                if (response.headers['x-ratelimit-remaining'] === '0') {
                    log.warn(logPrefix, `Token ${token.substr(0, 10)}.. exhausted`);

                    try {
                        exhaust(Number(response.headers['x-ratelimit-reset']) * 1000, err && err.statusCode === 403);
                    } catch (err) {
                        reject(err);
                    }
                }
            };

            got.stream(url, {
                timeout: 15000,
                headers: token ? { Authorization: `token ${token}` } : null,
            })
            .on('error', (err, details, response) => {
                response && handleResponse(response, err);
                reject(err);
            })
            .on('response', (response) => handleResponse(response))
            .pipe(fs.createWriteStream(tarballFile))
            .on('error', reject)
            .on('finish', resolve);
        });
    }, {
        group: 'github',
        wait: (token, duration) => {
            if (!options.waitRateLimit) {
                return false;
            }

            duration = Math.ceil(duration / 1000);
            log.warn(logPrefix, `All tokens are exhausted, next one will become available in ${duration}s`);
            return true;
        },
    })
    .then(() => {
        log.verbose(logPrefix, `Successfully downloaded ${shorthand} tarball, will now extract ..`,
            { tarballFile });

        return untar(tarballFile)
        .then(() => {
            log.verbose(logPrefix, `Extraction of ${shorthand} tarball successful`, { tmpDir });
        }, (err) => {
            log.error(logPrefix, `Failed to extract ${shorthand} tarball`, { err, tarballFile });
            throw err;
        });
    }, (err) => {
        // Check if the repository does not exist
        if (err.statusCode === 404) {
            log.warn(logPrefix, `Download of ${shorthand} tarball failed`, { err });
            return;
        }

        log.error(logPrefix, `Download of ${shorthand} tarball failed`, { err });
        throw err;
    });
}

function github(packageJson, options) {
    const repository = packageJson.repository;

    if (!repository) {
        return null;
    }

    const gitInfo = hostedGitInfo.fromUrl(repository.url);

    if (!gitInfo || gitInfo.type !== 'github') {
        return null;
    }

    return (tmpDir) => {
        const shorthand = `${gitInfo.user}/${gitInfo.project}`;
        const ref = packageJson.gitHead;

        return download(shorthand, ref, tmpDir, options)
        .return();
    };
}

module.exports = github;
