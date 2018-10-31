'use strict';

const fs = require('fs');
const cp = require('child_process');
const expect = require('chai').expect;
const fileSize = require(`${process.cwd()}/lib/analyze/collect/util/fileSize`);

const tmpDir = `${process.cwd()}/test/tmp`;

describe('fileSize', () => {
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should return the size of the given path', () => {
        fs.writeFileSync(`${tmpDir}/foo`, 'foo');

        return fileSize(`${tmpDir}/foo`)
        .then((size) => expect(size).to.equal(3));
    });

    it('should return the size of the given paths', () => {
        fs.writeFileSync(`${tmpDir}/foo`, 'foo');
        fs.writeFileSync(`${tmpDir}/fooz`, 'fooz');

        return fileSize([`${tmpDir}/foo`, `${tmpDir}/fooz`])
        .then((size) => expect(size).to.equal(7));
    });

    it('should return 0 if the path does not exist', () => (
        fileSize(`${tmpDir}/foo`)
        .then((size) => expect(size).to.equal(0))
        .then(() => fileSize([`${tmpDir}/foo`, `${tmpDir}/bar`]))
        .then((size) => expect(size).to.equal(0))
    ));

    it('should return 0 on recursive symlinks', () => {
        fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);
        fs.symlinkSync(`${tmpDir}/bar`, `${tmpDir}/foo`);

        return fileSize(`${tmpDir}/foo`)
        .then((size) => expect(size).to.equal(0));
    });

    it('should return 0 for non-file paths', () => {
        fs.mkdirSync(`${tmpDir}/foo`);

        return fileSize(`${tmpDir}/foo`)
        .then((size) => expect(size).to.equal(0));
    });

    describe('dir', () => {
        it('should recursively sum the size of all files in a directory', () => {
            fs.writeFileSync(`${tmpDir}/foo`, 'foo');
            fs.writeFileSync(`${tmpDir}/.foo`, '.foo'); // Test hidden files

            fs.mkdirSync(`${tmpDir}/dir`);
            fs.writeFileSync(`${tmpDir}/dir/bar`, 'bar');
            fs.writeFileSync(`${tmpDir}/dir/.bar`, '.bar'); // Test hidden files

            return fileSize.dir(`${tmpDir}`)
            .then((size) => expect(size).to.equal(14));
        });
    });
});
