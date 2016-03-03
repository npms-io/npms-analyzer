'use strict';

const urlLib = require('url');
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
        // Check if ref might no longer exist
        .catch((err) => {
            // did not match any file -> if branch or tag does not exist
            // reference is not a tree -> if sha does not exist
            if (/(did not match any file|reference is not a tree)/i.test(err.stderr)) {
                log.warn(logPrefix, `Failed to checkout ref ${ref} for ${url}`);
                return;
            }

            throw err;
        })
        .then(() => rimraf(`${tmpDir}/.git`));
    }, (err) => {
        // Repository does not exist, is invalid, or we have no permission?
        // https://foo:bar@github.com/something/thatwillneverexist.git  -> authentication failed
        // https://foo:bar@github.com/some/privaterepo.git  -> authentication failed
        // https://foo:bar@github.com/org/foo+foo.git -> not found
        // https://foo:bar@github.com/org/foo%foo.git -> unable to access (400)
        // https://foo:bar@bitbucket.org/something/thatwillneverexist.git -> not found
        // https://foo:bar@bitbucket.org/some/privaterepo.git  -> authentication failed
        // https://foo:bar@bitbucket.org/org/foo+foo.git -> not found
        // https://foo:bar@bitbucket.org/org/foo%foo.git -> unable to access (400)
        // https://foo:bar@gitlab.com/something/thatwillneverexist.git -> authenticated failed
        // https://foo:bar@gitlab.com/some/privaterepo.git  -> authentication failed
        // https://foo:bar@gitlab.com/org/foo+foo.git -> unable to access (500)
        // https://foo:bar@gitlab.com/org/foo%foo.git -> unable to access (400)
        if (/(not found|unable to access|authentication failed)/i.test(err.stderr)) {
            log.warn(logPrefix, `Repository ${url} does not exist or is private`, { err });
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
