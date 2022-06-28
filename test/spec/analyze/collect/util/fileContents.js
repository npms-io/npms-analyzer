'use strict';

const fs = require('fs');
const cp = require('child_process');
const expect = require('chai').expect;
const fileContents = require(`${process.cwd()}/lib/analyze/collect/util/fileContents`);

const tmpDir = `${process.cwd()}/test/tmp`;

describe('fileContents', () => {
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should return the file contents of the given path', () => {
        fs.writeFileSync(`${tmpDir}/foo`, 'foo');

        return fileContents(`${tmpDir}/foo`)
        .then((contents) => expect(contents).to.equal('foo'));
    });

    it('should return 0 if the path does not exist', () => (
        fileContents(`${tmpDir}/foo`)
        .then((contents) => expect(contents).to.equal(null))
    ));

    it('should return 0 on recursive symlinks', () => {
        fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);
        fs.symlinkSync(`${tmpDir}/bar`, `${tmpDir}/foo`);

        return fileContents(`${tmpDir}/foo`)
        .then((contents) => expect(contents).to.equal(null));
    });

    it('should return 0 for non-file paths', () => {
        fs.mkdirSync(`${tmpDir}/foo`);

        return fileContents(`${tmpDir}/foo`)
        .then((contents) => expect(contents).to.equal(null));
    });
});
