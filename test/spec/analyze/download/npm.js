'use strict';

const fs = require('fs');
const cp = require('child_process');
const loadJsonFile = require('load-json-file');
const expect = require('chai').expect;
const sepia = require(`${process.cwd()}/test/util/sepia`);
const npm = require(`${process.cwd()}/lib/analyze/download/npm`);

const tmpDir = `${process.cwd()}/test/tmp`;
const fixturesDir = `${process.cwd()}/test/fixtures/analyze/download`;

describe('npm', () => {
    before(() => sepia.fixtureDir(`${fixturesDir}/recorded/npm`));
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should download the dist tarball', () => {
        sepia.enable();

        const download = npm({
            name: 'cross-spawn',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        });

        return download(tmpDir)
        .then(() => {
            expect(() => fs.accessSync(`${tmpDir}/package.json`)).to.not.throw();
            expect(() => fs.accessSync(`${tmpDir}/appveyor.yml`)).to.throw(/ENOENT/);
        })
        .finally(() => sepia.disable());
    });

    it('should still work if there\'s no dist tarball', () => {
        const download = npm({
            name: 'cool-module',
        });

        return download(tmpDir)
        .then(() => {
            expect(fs.readdirSync(tmpDir)).to.eql(['package.json']);
        });
    });

    it('should fail if the tarball is too large', () => {
        sepia.nock('https://registry.npmjs.org')
        .get('/cross-spawn/-/cross-spawn-0.1.0.tgz')
        .reply(200, 'foo', {
            'Content-Length': '1000000000000',
        });

        const download = npm({
            name: 'cross-spawn',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        });

        return download(tmpDir)
        .then(() => {
            throw new Error('Should have failed');
        }, (err) => {
            expect(sepia.nock.isDone()).to.equal(true);
            expect(err.message).to.match(/too large/i);
            expect(err.unrecoverable).to.equal(true);
        })
        .finally(() => sepia.nock.cleanAll());
    });

    it('should fail if the tarball has too many files', () => {
        sepia.enable();

        const download = npm({
            name: 'cross-spawn',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
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

    it('should handle 404 errors', () => {
        sepia.nock('https://registry.npmjs.org')
        .get('/cross-spawn/-/cross-spawn-0.1.0.tgz')
        .reply(404);

        const download = npm({
            name: 'cool-module',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        });

        return download(tmpDir)
        .then(() => {
            expect(sepia.nock.isDone()).to.equal(true);
            expect(fs.readdirSync(tmpDir)).to.eql(['package.json']);
        })
        .finally(() => sepia.nock.cleanAll());
    });

    it('should merge package.json', () => {
        sepia.enable();

        const npmPackageJson = {
            name: 'cool-module',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        };

        const download = npm(npmPackageJson);

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

    it('should resolve with the downloaded object', () => {
        sepia.enable();

        const npmPackageJson = {
            name: 'cool-module',
            version: '0.1.0',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-1.0.0.tgz' },
        };

        const download = npm(npmPackageJson);

        return download(tmpDir)
        .then((downloaded) => {
            expect(downloaded.dir).to.equal(tmpDir);
            expect(downloaded.packageDir).to.equal(tmpDir);
            expect(downloaded.packageJson.name).to.equal('cross-spawn');
            expect(downloaded.packageJson.version).to.equal('1.0.0');
        })
        .finally(() => sepia.disable());
    });

    it('should retry on network errors');
});
