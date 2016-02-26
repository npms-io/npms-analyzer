'use strict';

const urlLib = require('url');
const Promise = require('bluebird');
const hostedGitInfo = require('hosted-git-info');
const rimraf = Promise.promisify(require('rimraf'));
const log = require('npmlog');
const exec = require('../util/exec');

const logPrefix = 'download/git';

function download(url, ref, tmpDir) {
    log.verbose(logPrefix, `Will now clone ${url}`);

    // Clone repository
    return exec(`git clone -q ${url} .`, { cwd: tmpDir })
    // Checkout the ref if any & remove .git folder
    .then(() => {
        return (ref ? exec(`git checkout -q ${ref}`, { cwd: tmpDir }) : Promise.resolve())
        // The ref might no longer exist, so we ignore the error
        .catch((err) => {
            if (/did not match any file/i.test(err.stderr)) {
                log.warn(logPrefix, `Failed to checkout ref ${ref} for ${url}`);
                return;
            }

            throw err;
        })
        .then(() => rimraf(`${tmpDir}/.git`));
    }, (err) => {
        // Repository does not exist or has an invalid name?
        if (/(does not exist|not found|is not a valid repository name)/i.test(err.stderr)) {
            log.warn(logPrefix, `Repository ${url} does not exist`, { err });
            return;
        }

        // Not a valid address or we have no permission?
        if (/could not read from remote repository|invalid username/i.test(err.stderr)) {
            log.warn(logPrefix, `Repository ${url} is not valid or was rejected`, { err });
            return;
        }

        throw err;
    });
}

function getCloneUrl(gitInfo) {
    let url;

    // Use https:// protocol to avoid having to setup ssh keys in GitHub, Bitbucket and GitLab
    // Also, foo@bar is added as username & password to prevent git clone from prompting for credentials
    // Even if foo@bar does not exist or is invalid, public repositories are still cloned correctly
    url = gitInfo.https().substr(4);
    url = Object.assign(urlLib.parse(url), { auth: 'foo:bar' });
    url = urlLib.format(url);

    return url;
}

function git(packageJson) {
    const repository = packageJson.repository;

    if (!repository) {
        return null;
    }

    const gitInfo = hostedGitInfo.fromUrl(repository.url);

    if (!gitInfo) {
        return null;
    }

    return (tmpDir) => {
        const url = getCloneUrl(gitInfo);
        const ref = packageJson.gitHead;

        return download(url, ref, tmpDir)
        .return();
    };
}

module.exports = git;
