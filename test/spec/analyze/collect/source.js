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
            match: () => true,
            handle: () => { throw new Error('Not mocked'); },
        },
    ]);
}

describe.skip('source', () => {
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

            const escapedName = entry.name.replace('/', '%2f');
            const data = loadJsonFile.sync(`${fixturesDir}/modules/${escapedName}/data.json`);
            const packageJson = packageJsonFromData(entry.name, data);
            const expected = loadJsonFile.sync(`${fixturesDir}/modules/${escapedName}/expected-source.json`);

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

    describe('monorepos', () => {
        [
            { name: 'react-router', downloader: githubDownloader },
            { name: 'babel-jest', downloader: githubDownloader },
        ].forEach((entry) => {
            it(`should collect \`${entry.name}\` correctly`, () => {
                sepia.enable();

                const data = loadJsonFile.sync(`${fixturesDir}/modules/${entry.name}/data.json`);
                const packageJson = packageJsonFromData(entry.name, data);
                const expected = loadJsonFile.sync(`${fixturesDir}/modules/${entry.name}/expected-source.json`);

                return entry.downloader(packageJson)(tmpDir)
                .then((downloaded) => {
                    const betrayed = mockExternal(null, downloaded.packageDir);

                    return source(data, packageJson, downloaded)
                    .then((collected) => expect(collected).to.eql(expected))
                    .finally(() => betrayed.restore());
                })
                .finally(() => sepia.disable());
            });
        });

        it('should detect tests on the package dir and fallback to root', () => {
            sepia.enable();
            const betrayed = mockExternal(null, `${tmpDir}/cross-spawn`);

            const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
            const packageJson = packageJsonFromData('cross-spawn', data);

            fs.mkdirSync(`${tmpDir}/cross-spawn`);
            fs.writeFileSync(`${tmpDir}/cross-spawn/package.json`, JSON.stringify(packageJson));
            fs.writeFileSync(`${tmpDir}/cross-spawn/test.js`, 'foo');
            fs.writeFileSync(`${tmpDir}/test.js`, 'foobar');

            return Promise.try(() => (
                source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.files.testsSize).to.equal(3))
            ))
            .then(() => {
                fs.unlinkSync(`${tmpDir}/cross-spawn/test.js`);

                return source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.files.testsSize).to.equal(6));
            })
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        });

        it('should detect changelog on the package dir and fallback to root', () => {
            sepia.enable();
            const betrayed = mockExternal(null, `${tmpDir}/cross-spawn`);

            const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
            const packageJson = packageJsonFromData('cross-spawn', data);

            fs.mkdirSync(`${tmpDir}/cross-spawn`);
            fs.writeFileSync(`${tmpDir}/cross-spawn/package.json`, JSON.stringify(packageJson));
            fs.writeFileSync(`${tmpDir}/cross-spawn/CHANGELOG.md`, 'foo');

            return Promise.try(() => (
                source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.files.hasChangelog).to.equal(true))
            ))
            .then(() => {
                fs.unlinkSync(`${tmpDir}/cross-spawn/CHANGELOG.md`);
                fs.writeFileSync(`${tmpDir}/CHANGELOG.md`, 'foo');

                return source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.files.hasChangelog).to.equal(true));
            })
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        });

        it('should detect readme badges on the package readme and fallback to root', () => {
            sepia.enable();
            const betrayed = mockExternal(null, `${tmpDir}/cross-spawn`);

            const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
            const packageJson = packageJsonFromData('cross-spawn', data);

            fs.mkdirSync(`${tmpDir}/cross-spawn`);
            fs.writeFileSync(`${tmpDir}/cross-spawn/package.json`, JSON.stringify(packageJson));
            fs.writeFileSync(`${tmpDir}/README.md`, `
                # planify

                [![NPM version][npm-image]][npm-url]

                [npm-url]:https://npmjs.org/package/planify
                [npm-image]:http://img.shields.io/npm/v/planify.svg
            `);

            return Promise.try(() => (
                source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.badges).to.have.length(6))
            ))
            .then(() => {
                delete data.readme;

                return source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.badges).to.have.length(1));
            })
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        });

        it('should detect linters on the package dir and fallback to root', () => {
            sepia.enable();
            const betrayed = mockExternal(null, `${tmpDir}/cross-spawn`);

            const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
            const packageJson = packageJsonFromData('cross-spawn', data);

            fs.mkdirSync(`${tmpDir}/cross-spawn`);
            fs.writeFileSync(`${tmpDir}/cross-spawn/package.json`, JSON.stringify(packageJson));
            fs.writeFileSync(`${tmpDir}/cross-spawn/.editorconfig`, 'foo');
            fs.writeFileSync(`${tmpDir}/.eslintrc.json`, 'foo');

            return Promise.try(() => (
                source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.linters).to.eql(['editorconfig']))
            ))
            .then(() => {
                fs.unlinkSync(`${tmpDir}/cross-spawn/.editorconfig`);

                return source(data, packageJson, { dir: tmpDir, packageDir: `${tmpDir}/cross-spawn` })
                .then((collected) => expect(collected.linters).to.eql(['eslint']));
            })
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        });

        it('should ignore malformed downloaded package.json when detecting linters');
    });

    it('should work around NPM_TOKEN env var, e.g.: `babbel`');

    it('should handle broken dependencies when checking outdated with david', () => {
        sepia.enable();
        const betrayed = mockExternal({
            david: () => { throw Object.assign(new Error('foo'), { stderr: 'failed to get versions' }); },
        });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
        const packageJson = packageJsonFromData('cross-spawn', data);

        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify(packageJson));

        return source(data, packageJson, { dir: tmpDir, packageDir: tmpDir })
        .then((collected) => expect(collected.outdatedDependencies).to.equal(false))
        .finally(() => {
            sepia.disable();
            betrayed.restore();
        });
    });

    it('should handle broken package data when checking outdated with david', () => {
        sepia.enable();
        const betrayed = mockExternal({
            david: () => { throw Object.assign(new Error('foo'), { stderr: 'data[currentVersion].versions.sort is not a function' }); },
        });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
        const packageJson = packageJsonFromData('cross-spawn', data);

        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify(packageJson));

        return source(data, packageJson, { dir: tmpDir, packageDir: tmpDir })
        .then((collected) => expect(collected.outdatedDependencies).to.equal(false))
        .finally(() => {
            sepia.disable();
            betrayed.restore();
        });
    });

    it('should handle broken package name when checking outdated with david', () => {
        sepia.enable();
        const betrayed = mockExternal({
            david: () => { throw Object.assign(new Error('foo'), { stderr: 'AssertionError [ERR_ASSERTION]' }); },
        });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
        const packageJson = packageJsonFromData('cross-spawn', data);

        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify(packageJson));

        return source(data, packageJson, { dir: tmpDir, packageDir: tmpDir })
        .then((collected) => expect(collected.outdatedDependencies).to.equal(false))
        .finally(() => {
            sepia.disable();
            betrayed.restore();
        });
    });

    it('should signal as unrecoverable if there\'s a .npmrc pointing to a private registry');

    it('should retry on network errors');
});
