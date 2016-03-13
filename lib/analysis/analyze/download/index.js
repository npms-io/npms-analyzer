'use strict';

const os = require('os');
const unlink = Promise.promisify(require('fs').unlink);
const writeFile = Promise.promisify(require('fs').writeFile);
const downloaders = require('require-directory')(module);
const exec = require('../util/exec');

const downloadersOrder = [
    (packageJson, options) => downloaders.github(packageJson,
        { tokens: options.githubTokens, waitRateLimit: options.waitRateLimit }),
    (packageJson) => downloaders.git(packageJson),
    (packageJson) => downloaders.npm(packageJson),
];

function createTmpDir(name) {
    // Suffix the folder with a random string to make it more unique
    // This solves concurrency and case sensitive issues
    const naiveRandomStr = Math.random().toString(36).slice(2);
    const dir = `${os.tmpdir()}/npms-analyzer/${name}-${naiveRandomStr}`;

    return exec(`rm -rf ${dir}`)
    .then(() => exec(`mkdir -p ${dir}`))
    .then(() => dir);
}

function writePackageJson(packageJson, tmpDir) {
    const target = `${tmpDir}/package.json`;

    // Need re-write the package.json files because some modules had broken json files, some were using symlinks, etc
    // This was causing problems all over the place so we simply re-write the json file with the one from the registry

    // Unlink first because some modules have their package.json as symlinks which was causing some issues when analyzing
    return unlink(target)
    .catch({ code: 'ENOENT' }, () => {})
    // Finally write the package.json
    .then(() => writeFile(target, JSON.stringify(packageJson, null, 2)));
}

// -------------------------------------------------------------

function download(packageJson, options) {
    let downloadFn;

    downloadersOrder.some((downloader) => {
        downloadFn = downloader(packageJson, options);
        return !!downloadFn;
    });

    if (!downloadFn) {
        return Promise.reject(new Error(`Could not find suitable downloader for ${packageJson.name}`));
    }

    // Create temporary directory
    return createTmpDir(packageJson.name)
    // Download the module into the temporary directory
    .tap((tmpDir) => {
        return downloadFn(tmpDir)
        // Ensure/overwrite the package.json (we want to use the stored package json because its more exact)
        .then(() => writePackageJson(packageJson, tmpDir))
        // Cleanup the directory if download failed
        .catch((err) => {
            return exec(`rm -rf ${tmpDir}`)
            .finally(() => { throw err; });
        });
    });
}

module.exports = download;
