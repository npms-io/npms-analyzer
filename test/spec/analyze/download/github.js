'use strict';

const fs = require('fs');
const cp = require('child_process');
const loadJsonFile = require('load-json-file');
const expect = require('chai').expect;
const sepia = require(`${process.cwd()}/test/util/sepia`);
const github = require(`${process.cwd()}/lib/analyze/download/github`);

const tmpDir = `${process.cwd()}/test/tmp`;
const fixturesDir = `${process.cwd()}/test/fixtures/analyze/download`;

describe('github', () => {
    before(() => sepia.fixtureDir(`${fixturesDir}/recorded/github`));
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should detect various GitHub urls', () => {
        let download;

        download = github({ repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.be.a('function');

        download = github({ repository: { type: 'git', url: 'git@github.com:IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.be.a('function');

        download = github({ repository: { type: 'git', url: 'https://github.com/IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.be.a('function');

        download = github({ repository: { type: 'git', url: 'https://foo.com/IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.equal(null);

        download = github({ repository: null });
        expect(download).to.equal(null);

        download = github({});
        expect(download).to.equal(null);
    });

    it('should download a specific commit hash', () => {
        sepia.enable();

        const download = github({
            name: 'cross-spawn',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'b5239f25c0274feba89242b77d8f0ce57dce83ad',
        });

        return download(tmpDir)
        .then((downloaded) => {
            expect(downloaded.downloader).to.equal('github');
            expect(downloaded.dir).to.equal(tmpDir);
            expect(downloaded.packageDir).to.equal(tmpDir);
            expect(downloaded.packageJson.name).to.equal('cross-spawn');
            expect(downloaded.gitRef).to.equal('b5239f25c0274feba89242b77d8f0ce57dce83ad');
        })
        .then(() => loadJsonFile.sync(`${tmpDir}/package.json`))
        .then((packageJson) => expect(packageJson.version).to.equal('1.0.0'))
        .finally(() => sepia.disable());
    });

    it('should fallback to default branch if the commit hash does not exist', () => {
        sepia.enable();

        const download = github({
            name: 'cross-spawn',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        });

        return download(tmpDir)
        .then((downloaded) => {
            expect(downloaded.downloader).to.equal('github');
            expect(downloaded.dir).to.equal(tmpDir);
            expect(downloaded.packageDir).to.equal(tmpDir);
            expect(downloaded.packageJson.name).to.equal('cross-spawn');
            expect(downloaded.gitRef).to.equal(null);

            expect(() => fs.accessSync(`${tmpDir}/package.json`)).to.not.throw();
            expect(() => fs.accessSync(`${tmpDir}/appveyor.yml`)).to.not.throw();
        })
        .finally(() => sepia.disable());
    });

    it('should fail if the tarball is too large', () => {
        sepia.nock('https://api.github.com')
        .get('/repos/liferay/liferay-portal/tarball/')
        .reply(200, 'foo', {
            'Content-Length': '1000000000000',
        });

        const download = github({
            name: 'liferay-frontend-theme-classic-web',
            repository: { type: 'git', url: 'git+https://github.com/liferay/liferay-portal.git' },
        });

        return download(tmpDir)
        .then(() => {
            throw new Error('Should have failed');
        }, (err) => {
            expect(sepia.nock.isDone()).to.equal(true);
            expect(err.message).to.match(/too large/i);
            expect(err.unrecoverable).to.equal(true);
        })
        .then(() => Promise.delay(2500))  // Wait some time because request.abort() might take a while
        .finally(() => sepia.nock.cleanAll());
    });

    it('should fail if the tarball has too many files', () => {
        sepia.enable();

        const download = github({
            name: 'cross-spawn',
            version: '0.1.0',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'b5239f25c0274feba89242b77d8f0ce57dce83ad',  // This is the ref for 1.0.0
        }, { maxFiles: 1 });

        return download(tmpDir)
        .then(() => {
            throw new Error('Should have failed');
        }, (err) => {
            expect(err.message).to.match(/too many file/i);
            expect(err.unrecoverable).to.equal(true);
        })
        .finally(() => sepia.disable());
    });

    it('should handle some 4xx errors', () => {
        return Promise.each([404, 403, 400], (code) => {
            sepia.nock('https://api.github.com')
            .get(`/repos/some-org/repo-${code}/tarball/`)
            .reply(code);

            const download = github({
                name: 'cool-module',
                repository: { type: 'git', url: `git+https://github.com/some-org/repo-${code}.git` },
            });

            return download(tmpDir)
            .then(() => {
                expect(sepia.nock.isDone()).to.equal(true);
                expect(fs.readdirSync(tmpDir)).to.eql(['package.json']);
            })
            .finally(() => sepia.nock.cleanAll());
        });
    });

    it('should prefer the passed package.json over the downloaded one', () => {
        sepia.enable();

        const npmPackageJson = {
            name: 'cool-module',
            version: '0.1.0',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'b5239f25c0274feba89242b77d8f0ce57dce83ad',  // This is the ref for 1.0.0
        };

        const download = github(npmPackageJson);

        return download(tmpDir)
        .then(() => loadJsonFile.sync(`${tmpDir}/package.json`))
        .then((packageJson) => {
            expect(packageJson.name).to.equal('cool-module');
            expect(packageJson.version).to.equal('0.1.0');
            expect(packageJson.description).to.be.a('string');

            // Test if properties were merged back
            expect(npmPackageJson.name).to.equal('cool-module');
            expect(npmPackageJson.version).to.equal('0.1.0');
            expect(npmPackageJson.description).to.be.a('string');
        })
        .finally(() => sepia.disable());
    });

    it('should remove the package-lock.json file', () => {
        sepia.enable();

        const download = github({
            name: 'babel-preset-moxy',
            version: '2.3.1',
            repository: { type: 'git', url: 'git://github.com/moxystudio/babel-preset-moxy' },
            gitHead: 'b77ba80b71d6898970e2541b1f1c34d86ba493f7',  // This is the ref for 2.3.1
        });

        return download(tmpDir)
        .then(() => {
            expect(fs.existsSync(`${tmpDir}/package-lock.json`)).to.equal(false);
        })
        .finally(() => sepia.disable());
    });

    it('should resolve with the downloaded object', () => {
        sepia.enable();

        const download = github({
            name: 'cool-module',
            version: '0.1.0',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'b5239f25c0274feba89242b77d8f0ce57dce83ad',  // This is the ref for 1.0.0
        });

        return download(tmpDir)
        .then((downloaded) => {
            expect(downloaded.dir).to.equal(tmpDir);
            expect(downloaded.packageDir).to.equal(tmpDir);
            expect(downloaded.packageJson.name).to.equal('cross-spawn');
            expect(downloaded.packageJson.version).to.equal('1.0.0');
        })
        .finally(() => sepia.disable());
    });

    it('should detect the proper `packageDir` for mono-repositories', () => {
        sepia.enable();

        const download = github({
            name: 'babel-cli',
            version: '6.23.0',
            repository: { type: 'git', url: 'git://github.com/babel/babel.git' },
            gitHead: '48573f1fb4e632add2c000bec3f95d88ebea4440',  // This is the ref for 6.23.0
        });

        return download(tmpDir)
        .then((downloaded) => {
            expect(downloaded.dir).to.equal(tmpDir);
            expect(downloaded.packageDir).to.equal(`${tmpDir}/packages/babel-cli`);
            expect(downloaded.packageJson.name).to.equal('babel-cli');
            expect(downloaded.packageJson.version).to.equal('6.23.0');
        })
        .finally(() => sepia.disable());
    });

    it('should retry on network errors');

    it('should pass the correct options to token-dealer');

    it('should handle rate limit errors (wait/bail)');
});
