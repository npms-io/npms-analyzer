'use strict';

const fs = require('fs');
const cp = require('child_process');
const expect = require('chai').expect;
const mergePackageJson = require(`${process.cwd()}/lib/analyze/download/util/mergePackageJson`);

const tmpDir = `${process.cwd()}/test/tmp`;

describe('mergePackageJson', () => {
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should merge the files, preferring the passed one', () => {
        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify({
            name: 'cool-module',
            version: '2.0.0',
            description: 'bar',
            dependencies: { 'foo-dep': '^1.0.0' },
        }));

        const packageJson = {
            name: 'cool-module',
            version: '1.0.0',
            keywords: ['cool'],
            dependencies: { 'cool-dep': '^1.0.0' },
        };

        return mergePackageJson(packageJson, tmpDir)
        .then((mergedPackageJson) => {
            expect(packageJson).to.equal(mergedPackageJson);
            expect(packageJson.name).to.equal('cool-module');
            expect(packageJson.version).to.equal('1.0.0');
            expect(packageJson.description).to.equal('bar');
            expect(packageJson.keywords).to.eql(['cool']);
            expect(packageJson.dependencies).to.eql({ 'cool-dep': '^1.0.0' });
        });
    });

    it('should merge the files, preferring the downloaded one', () => {
        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify({
            name: 'foo',  // Intentionally changing it to 'foo' and it must be ignored because it's the name property
            version: '2.0.0',
            description: 'bar',
            dependencies: { 'foo-dep': '^1.0.0' },
        }));

        const packageJson = {
            name: 'cool-module',
            version: '1.0.0',
            keywords: ['cool'],
            dependencies: { 'cool-dep': '^1.0.0' },
        };

        return mergePackageJson(packageJson, tmpDir, { preferDownloaded: true })
        .then((mergedPackageJson) => {
            expect(packageJson).to.equal(mergedPackageJson);
            expect(packageJson.name).to.equal('cool-module');
            expect(packageJson.version).to.equal('2.0.0');
            expect(packageJson.description).to.equal('bar');
            expect(packageJson.keywords).to.eql(['cool']);
            expect(packageJson.dependencies).to.eql({ 'foo-dep': '^1.0.0' });
        });
    });

    it('should deal with broken downloaded package.json files', () => {
        fs.writeFileSync(`${tmpDir}/package.json`, 'brokenjson');

        const packageJson = {
            name: 'cool-module',
            version: '1.0.0',
            keywords: ['cool'],
            dependencies: { 'cool-dep': '^1.0.0' },
        };

        return mergePackageJson(packageJson, tmpDir)
        .then((mergedPackageJson) => {
            expect(packageJson).to.equal(mergedPackageJson);
            expect(packageJson.name).to.equal('cool-module');
            expect(packageJson.version).to.equal('1.0.0');
            expect(packageJson.keywords).to.eql(['cool']);
            expect(packageJson.dependencies).to.eql({ 'cool-dep': '^1.0.0' });
        });
    });
});
