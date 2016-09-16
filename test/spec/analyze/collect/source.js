'use strict';

const fs = require('fs');
const cp = require('child_process');
const loadJsonFile = require('load-json-file');
const expect = require('chai').expect;
const betray = require('betray');
const sepia = require(`${process.cwd()}/test/util/sepia`);
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);
const githubDownloader = require(`${process.cwd()}/lib/analyze/download/github`);
const npmDownloader = require(`${process.cwd()}/lib/analyze/download/npm`);
const source = require(`${process.cwd()}/lib/analyze/collect/source`);

const tmpDir = `${process.cwd()}/test/tmp`;
const fixturesDir = `${process.cwd()}/test/fixtures/analyze/collect`;

function mockExternal(mocks, dir) {
    mocks = Object.assign({ clone: () => {}, checkout: () => {} }, mocks);
    dir = dir || tmpDir;

    return betray(cp, 'exec', [
        {
            match: (command) => command.indexOf('bin/david') !== -1,
            handle: (command, options, callback) => {
                let json;

                try {
                    json = (mocks.david && mocks.david(command)) || {};
                } catch (err) {
                    return callback(err, err.stdout || '', err.stderr || '');
                }

                fs.writeFileSync(`${dir}/.npms-david.json`, JSON.stringify(json));
                callback(null, '', '');
            },
        },
        {
            match: (command) => command.indexOf('bin/nsp') !== -1,
            handle: (command, options, callback) => {
                let json;

                try {
                    json = (mocks.nsp && mocks.nsp(command)) || {};
                } catch (err) {
                    return callback(err, err.stdout || '', err.stderr || '');
                }

                fs.writeFileSync(`${dir}/.npms-nsp.json`, JSON.stringify(json));
                callback(null, '', '');
            },
        },
        {
            match: () => true,
            handle: () => { throw new Error('Not mocked'); },
        },
    ]);
}

describe('source', () => {
    before(() => sepia.fixtureDir(`${fixturesDir}/recorded/source`));
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    [
        { name: 'cross-spawn', downloader: githubDownloader },
        { name: 'planify', downloader: githubDownloader },
        { name: 'hapi', downloader: githubDownloader },
        { name: '0', downloader: npmDownloader },
        { name: 'backoff', downloader: githubDownloader },
    ].forEach((entry) => {
        it(`should collect \`${entry.name}\` correctly`, () => {
            sepia.enable();

            const data = loadJsonFile.sync(`${fixturesDir}/modules/${entry.name}/data.json`);
            const packageJson = packageJsonFromData(entry.name, data);
            const expected = loadJsonFile.sync(`${fixturesDir}/modules/${entry.name}/expected-source.json`);

            return entry.downloader(packageJson)(tmpDir)
            .then((downloaded) => {
                const betrayed = mockExternal();

                return source(data, packageJson, downloaded)
                .then((collected) => expect(collected).to.eql(expected))
                .finally(() => betrayed.restore());
            })
            .finally(() => sepia.disable());
        });
    });

    it('should work around NPM_TOKEN env var, e.g.: `babbel`');

    it('should handle broken dependencies when checking outdated with david', () => {
        sepia.enable();
        const betrayed = mockExternal({
            david: () => { throw Object.assign(new Error('foo'), { stderr: 'failed to get versions' }); },
        });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/ccbuild/data.json`);
        const packageJson = packageJsonFromData('ccbuild', data);

        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify(packageJson));

        return source(data, packageJson, { dir: tmpDir })
        .then((collected) => expect(collected.outdatedDependencies).to.equal(false))
        .finally(() => {
            sepia.disable();
            betrayed.restore();
        });
    });

    it('should handle broken dependencies when checking vulnerabilities with nsp', () => {
        const data = loadJsonFile.sync(`${fixturesDir}/modules/ccbuild/data.json`);
        const packageJson = packageJsonFromData('ccbuild', data);

        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify(packageJson));

        // Test "Debug output: undefined"
        return Promise.try(() => {
            sepia.enable();
            const betrayed = mockExternal({
                nsp: () => { throw Object.assign(new Error('foo'), { stderr: 'Debug output: undefined\n{}\n' }); },
            });

            return source(data, packageJson, { dir: tmpDir })
            .then((collected) => expect(collected.dependenciesVulnerabilities).to.equal(false))
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        })
        // Test 400 status code
        .then(() => {
            sepia.enable();
            const betrayed = mockExternal({
                nsp: () => { throw Object.assign(new Error('foo'), { stderr: '"statusCode":400' }); },
            });

            return source(data, packageJson, { dir: tmpDir })
            .then((collected) => expect(collected.dependenciesVulnerabilities).to.equal(false))
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        });
    });

    it('should retry getting vulnerabilities if nsp seems to be unavailable', () => {
        let counter = 0;

        sepia.enable();
        const betrayed = mockExternal({
            nsp: () => {
                counter += 1;

                if (counter === 1) {
                    throw Object.assign(new Error('foo'), { stderr: '"statusCode":503' });
                } else if (counter === 2) {
                    throw Object.assign(new Error('foo'),
                        { stderr: '53,48,52,32,71,97,116,101,119,97,121,32,84,105,109,101,45,111,117,116' });
                } else if (counter === 3) {
                    throw Object.assign(new Error('foo'),
                        { stderr: 'Bad Gateway' });
                } else {
                    return ['foo'];
                }
            },
        });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
        const packageJson = packageJsonFromData('cross-spawn', data);

        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify(packageJson));

        return source(data, packageJson, { dir: tmpDir })
        .then((collected) => expect(collected.dependenciesVulnerabilities).to.eql(['foo']))
        .finally(() => {
            sepia.disable();
            betrayed.restore();
        });
    });

    it('should retry on network errors');
});
