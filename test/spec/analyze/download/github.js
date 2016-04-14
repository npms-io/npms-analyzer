'use strict';

const fs = require('fs');
const cp = require('child_process');
const loadJsonFile = require('load-json-file');
const expect = require('chai').expect;
const nock = require('nock');
const sepia = require('../../../util/sepia');
const github = require('../../../../lib/analyze/download/github');

describe('github', () => {
    const testDir = `${__dirname}/../../..`;
    const tmpDir = `${testDir}/tmp`;

    before(() => sepia.fixtureDir(`${testDir}/fixtures/analyze/download/sepia/github`));
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
    });

    it('should download a specific commit hash', () => {
        sepia.enable();

        const download = github({
            name: 'cross-spawn',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'b5239f25c0274feba89242b77d8f0ce57dce83ad',
        });

        return download(tmpDir)
        .then(() => loadJsonFile.sync(`${tmpDir}/package.json`))
        .then((packageJson) => expect(packageJson.version).to.equal('1.0.0'));
    });

    it('should fallback to master branch if the commit hash does not exist', () => {
        sepia.enable();

        const download = github({
            name: 'cross-spawn',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'somecommithashthatwillneverexist00000000',
        });

        return download(tmpDir)
        .then(() => {
            expect(() => fs.accessSync(`${tmpDir}/package.json`)).to.not.throw();
            expect(() => fs.accessSync(`${tmpDir}/appveyor.yml`)).to.not.throw();
        });
    });

    it('should fail if the tarball is too large', () => {
        nock('https://api.github.com')
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
            expect(nock.isDone()).to.equal(true);
            expect(err.message).to.match(/too large/i);
            expect(err.unrecoverable).to.equal(true);
        });
    });

    it('should handle some 4xx errors', () => {
        return Promise.each([404, 403, 400], (code) => {
            nock('https://api.github.com')
            .get(`/repos/some-org/repo-${code}/tarball/`)
            .reply(code);

            const download = github({
                name: 'cool-module',
                repository: { type: 'git', url: `git+https://github.com/some-org/repo-${code}.git` },
            });

            return download(tmpDir)
            .then(() => {
                expect(nock.isDone()).to.equal(true);
                expect(fs.readdirSync(`${tmpDir}`)).to.eql(['package.json']);
            });
        });
    });

    it('should prefer the passed package.json over the downloaded one', () => {
        sepia.enable();

        const download = github({
            name: 'cross-spawn',
            version: '0.0.1',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'b5239f25c0274feba89242b77d8f0ce57dce83ad',  // This is ref for 1.0.0
        });

        return download(tmpDir)
        .tap(() => expect(nock.isDone()).to.equal(true))
        .then(() => loadJsonFile.sync(`${tmpDir}/package.json`))
        .then((packageJson) => expect(packageJson.version).to.equal('0.0.1'));
    });

    it('should override refs based on options.refOverrides', () => {
        sepia.enable();

        const download = github({
            name: 'cross-spawn',
            version: '0.0.1',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: 'b5239f25c0274feba89242b77d8f0ce57dce83ad',                           // This is ref for 1.0.0
        }, {
            refOverrides: { 'cross-spawn': '65d41138e6b5161787df43d5f8de2442765e32d0' },   // This is ref for 2.0.0
        });

        return download(tmpDir)
        .then(() => {
            expect(nock.isDone()).to.equal(true);
            expect(() => fs.accessSync(`${tmpDir}/package.json`)).to.not.throw();
            expect(() => fs.accessSync(`${tmpDir}/appveyor.yml`)).to.not.throw();

            // Test if the downloaded package.json was preferred
            return loadJsonFile(`${tmpDir}/package.json`)
            .then(() => loadJsonFile.sync(`${tmpDir}/package.json`))
            .then((packageJson) => expect(packageJson.version).to.equal('2.0.0'));
        });
    });

    it('should pass the correct options to token-dealer');

    it('should handle rate limit errors (wait/bail)');
});
