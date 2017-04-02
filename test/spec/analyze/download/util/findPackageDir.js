'use strict';

const fs = require('fs');
const cp = require('child_process');
const expect = require('chai').expect;
const findPackageDir = require(`${process.cwd()}/lib/analyze/download/util/findPackageDir`);

const tmpDir = `${process.cwd()}/test/tmp`;

describe('findPackageDir', () => {
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should return the same dir if the root package.json points to the same package', () => {
        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify({
            name: 'cool-module',
        }));

        const packageJson = {
            name: 'cool-module',
        };

        return findPackageDir(packageJson, tmpDir)
        .then((dir) => expect(dir).to.equal(tmpDir));
    });

    it('should return the dir by looking for it in the folder', () => {
        fs.mkdirSync(`${tmpDir}/cool-module-foo`);
        fs.writeFileSync(`${tmpDir}/cool-module-foo/package.json`, JSON.stringify({
            name: 'cool-module',
        }));
        fs.mkdirSync(`${tmpDir}/cool-module-zoo`);
        fs.writeFileSync(`${tmpDir}/cool-module-zoo/package.json`, JSON.stringify({
            name: 'cool-module-zoo',
        }));
        fs.mkdirSync(`${tmpDir}/cool-module-bar`);
        fs.writeFileSync(`${tmpDir}/cool-module-bar/package.json`, JSON.stringify({
            name: 'cool-module-xxx',
        }));
        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify({
            name: 'cool-module-builder',
        }));

        const packageJson = {
            name: 'cool-module',
        };

        return findPackageDir(packageJson, tmpDir)
        .then((dir) => expect(dir).to.equal(`${tmpDir}/cool-module-foo`));
    });

    it('should swallow invalid json errors', () => {
        fs.mkdirSync(`${tmpDir}/cool-module-foo`);
        fs.writeFileSync(`${tmpDir}/cool-module-foo/package.json`, 'wow');
        fs.writeFileSync(`${tmpDir}/package.json`, JSON.stringify({
            name: 'cool-module-builder',
        }));

        const packageJson = {
            name: 'cool-module',
        };

        return findPackageDir(packageJson, tmpDir)
        .then((dir) => expect(dir).to.equal(tmpDir));
    });

    it('should not crash if there\'s no package.json in the root', () => {
        const packageJson = {
            name: 'cool-module',
        };

        return findPackageDir(packageJson, tmpDir)
        .then((dir) => expect(dir).to.equal(tmpDir));
    });
});
