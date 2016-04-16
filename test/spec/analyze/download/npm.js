'use strict';

const fs = require('fs');
const cp = require('child_process');
const loadJsonFile = require('load-json-file');
const expect = require('chai').expect;
const nock = require('nock');
const sepia = require(`${process.cwd()}/test/util/sepia`);
const npm = require(`${process.cwd()}/lib/analyze/download/npm`);

const tmpDir = `${process.cwd()}/test/tmp`;

describe('npm', () => {
    before(() => sepia.fixtureDir(`${process.cwd()}/test/fixtures/analyze/download/sepia/npm`));
    beforeEach(() => {
        cp.execSync(`mkdir -p ${tmpDir}`);
        sepia.disable();
        nock.cleanAll();
    });
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));
    after(() => {
        sepia.disable();
        nock.cleanAll();
    });

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
        });
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
        nock('https://registry.npmjs.org')
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
            expect(nock.isDone()).to.equal(true);
            expect(err.message).to.match(/too large/i);
            expect(err.unrecoverable).to.equal(true);
        });
    });

    it('should handle 404 errors', () => {
        nock('https://registry.npmjs.org')
        .get('/cross-spawn/-/cross-spawn-0.1.0.tgz')
        .reply(404);

        const download = npm({
            name: 'cool-module',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        });

        return download(tmpDir)
        .then(() => {
            expect(nock.isDone()).to.equal(true);
            expect(fs.readdirSync(tmpDir)).to.eql(['package.json']);
        });
    });

    it('should merge package.json', () => {
        const npmPackageJson = {
            name: 'cool-module',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        };

        const download = npm(npmPackageJson);

        return download(tmpDir)
        .then(() => loadJsonFile(`${tmpDir}/package.json`))
        .then((packageJson) => {
            expect(nock.isDone()).to.equal(true);

            expect(packageJson.name).to.equal('cool-module');
            expect(packageJson.version).to.equal('0.1.0');
            expect(packageJson.description).to.be.a('string');

            // Test if properties were merged back
            expect(npmPackageJson.name).to.equal('cool-module');
            expect(npmPackageJson.version).to.equal('0.1.0');
            expect(npmPackageJson.description).to.be.a('string');
        });
    });
});
