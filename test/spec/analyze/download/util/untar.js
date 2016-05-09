'use strict';

const fs = require('fs');
const cp = require('child_process');
const expect = require('chai').expect;
const betray = require('betray');
const untar = require(`${process.cwd()}/lib/analyze/download/util/untar`);

const tmpDir = `${process.cwd()}/test/tmp`;
const fixturesDir = `${process.cwd()}/test/fixtures/analyze/download`;

describe('untar', () => {
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should decompress a tar.gz archive file', () => {
        fs.writeFileSync(`${tmpDir}/test.tgz`, fs.readFileSync(`${fixturesDir}/downloaded/couchdb-iterator-2.0.2.tgz`));

        return untar(`${tmpDir}/test.tgz`)
        .then(() => {
            const files = fs.readdirSync(tmpDir);

            expect(files).to.contain('index.js');
            expect(files).to.contain('package.json');
        });
    });

    it('should chmod 0777 extracted files recursively', () => {
        fs.writeFileSync(`${tmpDir}/test.tgz`, fs.readFileSync(`${fixturesDir}/downloaded/couchdb-iterator-2.0.2.tgz`));

        return untar(`${tmpDir}/test.tgz`)
        .then(() => {
            const stat = fs.statSync(`${tmpDir}/index.js`);
            const permStr = `0${(stat.mode & parseInt('777', 8)).toString(8)}`;  // eslint-disable-line no-bitwise

            expect(permStr).to.equal('0777');
        });
    });

    it('should deal with malformed archives', () => {
        const log = logger.children['util/untar'];
        const betrayed = betray(log, 'warn');

        fs.writeFileSync(`${tmpDir}/test.tgz`, fs.readFileSync(`${fixturesDir}/mocked/broken-archive.tgz`));

        return untar(`${tmpDir}/test.tgz`)
        .then(() => {
            expect(betrayed.invoked).to.equal(1);
            expect(betrayed.invocations[0][1]).to.match(/malformed/i);
            expect(fs.readdirSync(tmpDir)).to.eql([]);
        })
        .finally(() => betrayed.restore());
    });

    it('should deal with archives that have extended/unknown headers', () => {
        fs.writeFileSync(`${tmpDir}/test.tgz`, fs.readFileSync(`${fixturesDir}/downloaded/pickles2-contents-editor-2.0.0-alpha.1.tgz`));

        return untar(`${tmpDir}/test.tgz`)
        .then(() => {
            const files = fs.readdirSync(tmpDir);

            expect(files).to.contain('package.json');
            expect(files).to.contain('tests');
            expect(files).to.contain('src');
            expect(files).to.contain('dist');
        });
    });

    it('should fail if extraction fails', () => {
        return untar(`${tmpDir}/archive-that-will-never-exist.tgz`)
        .then(() => {
            throw new Error('Expected to fail');
        }, (err) => {
            expect(err.stderr).to.match(/(error opening|no such file)/i);
        });
    });


    it('should delete the archive file, even if the extraction failed', () => {
        // Good tar
        return Promise.try(() => {
            fs.writeFileSync(`${tmpDir}/test.tgz`, fs.readFileSync(`${fixturesDir}/downloaded/couchdb-iterator-2.0.2.tgz`));

            return untar(`${tmpDir}/test.tgz`)
            .then(() => expect(() => fs.accessSync(`${tmpDir}/test.tgz`)).to.throw(/ENOENT/));
        })
        // Broken tar
        .then(() => {
            cp.execSync(`rm -rf ${tmpDir}`);
            cp.execSync(`mkdir -p ${tmpDir}`);
            fs.writeFileSync(`${tmpDir}/test.tgz`, fs.readFileSync(`${fixturesDir}/mocked/broken-archive.tgz`));

            return untar(`${tmpDir}/test.tgz`)
            .then(() => expect(() => fs.accessSync(`${tmpDir}/test.tgz`)).to.throw(/ENOENT/));
        });
    });
});
