'use strict';

const fs = require('fs');
const execSync = require('child_process').execSync;
const expect = require('chai').expect;
const nock = require('nock');
const sepia = require('../../../util/sepia');
const npm = require('../../../../lib/analyze/download/npm');

describe('npm', () => {
    const testDir = `${__dirname}/../../../`;
    const tmpDir = `${testDir}/tmp`;

    before(() => sepia.fixtureDir(`${testDir}/fixtures/analyze/download/npm`));
    beforeEach(() => {
        execSync(`mkdir -p ${tmpDir}`);
        sepia.disable();
        nock.cleanAll();
    });
    afterEach(() => execSync(`rm -rf ${tmpDir}`));
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
            expect(fs.readdirSync(`${tmpDir}`)).to.eql(['package.json']);
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
            expect(err.message).to.match(/too large/i);
            expect(err.unrecoverable).to.equal(true);
            expect(nock.isDone()).to.equal(true);
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
            expect(fs.readdirSync(`${tmpDir}`)).to.eql(['package.json']);
        });
    });
});
