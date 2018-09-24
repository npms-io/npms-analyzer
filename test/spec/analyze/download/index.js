'use strict';

const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const expect = require('chai').expect;
const betray = require('betray');
const download = require(`${process.cwd()}/lib/analyze/download`);

describe('index', () => {
    it('should use the github downloader, passing in the correct options', () => {
        const betrayed = betray(download.downloaders, 'github', () => () => Promise.resolve({}));

        const options = {
            githubTokens: ['foo', 'bar'],
            waitRateLimit: true,
        };

        return download({
            name: 'cross-spawn',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
        }, options)
        .then((downloaded) => {
            expect(betrayed.invoked).to.equal(1);

            const invocation = betrayed.invocations[0];

            expect(invocation[0].name).to.equal('cross-spawn');
            expect(invocation[1]).to.eql({
                tokens: options.githubTokens,
                waitRateLimit: options.waitRateLimit,
            });

            expect(downloaded).to.eql({});
        })
        .finally(() => betrayed.restore());
    });

    it('should use the git downloader, passing in the correct options', () => {
        const betrayed = betray(download.downloaders, 'git', () => () => Promise.resolve({}));

        const options = {
            githubTokens: ['foo', 'bar'],
            waitRateLimit: true,
        };

        return download({
            name: 'angular-ui-select',
            repository: { type: 'git', url: 'git@gitlab.com:codium/angular-ui-select.git' },
        }, options)
        .then((downloaded) => {
            expect(betrayed.invoked).to.equal(1);

            const invocation = betrayed.invocations[0];

            expect(invocation[0].name).to.equal('angular-ui-select');
            expect(invocation[1]).to.equal(undefined);

            expect(downloaded).to.eql({});
        })
        .finally(() => betrayed.restore());
    });

    it('should use the npm downloader, passing in the correct options', () => {
        const betrayed = betray(download.downloaders, 'npm', () => () => Promise.resolve({}));

        const options = {
            githubTokens: ['foo', 'bar'],
            waitRateLimit: true,
        };

        return download({
            name: 'cross-spawn',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        }, options)
        .then((downloaded) => {
            expect(betrayed.invoked).to.equal(1);

            const invocation = betrayed.invocations[0];

            expect(invocation[0].name).to.equal('cross-spawn');
            expect(invocation[1]).to.equal(undefined);

            expect(downloaded).to.eql({});
        })
        .finally(() => betrayed.restore());
    });

    it('should call downloader with the temporary folder', () => {
        let tmpDir;
        const betrayed = betray(download.downloaders, 'npm', () => (tmpDir_) => {
            tmpDir = tmpDir_;

            return Promise.resolve({});
        });

        return download({
            name: 'cross-spawn',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        })
        .then(() => {
            expect(betrayed.invoked).to.equal(1);
            expect(tmpDir.indexOf(`${os.tmpdir()}/npms-analyzer/cross-spawn-`)).to.equal(0);
            expect(tmpDir).to.match(/-[a-z0-9]+$/);
        })
        .finally(() => betrayed.restore());
    });

    it('should create a unique and kebab-cased temporary folder');

    it('should delete the temporary folder on failure', () => {
        let tmpDir;
        const betrayed = betray(download.downloaders, 'npm', () => (tmpDir_) => {
            tmpDir = tmpDir_;

            return Promise.reject(new Error('foo'));
        });

        return download({
            name: 'cross-spawn',
            dist: { tarball: 'https://registry.npmjs.org/cross-spawn/-/cross-spawn-0.1.0.tgz' },
        })
        .then(() => {
            throw new Error('Should have failed');
        }, (err) => {
            expect(err.message).to.equal('foo');
            expect(betrayed.invoked).to.equal(1);
            expect(() => fs.statSync(tmpDir)).to.throw(/ENOENT/i);
        })
        .finally(() => betrayed.restore());
    });

    describe('cleanTmpDir', () => {
        const tmpDir = `${os.tmpdir()}/npms-analyzer`;

        it('should clean old folders from the temporary folder', () => {
            cp.execSync(`mkdir -p ${tmpDir}/foo`);
            cp.execSync(`mkdir -p ${tmpDir}/bar`);
            fs.utimesSync(`${tmpDir}/bar`, new Date(), new Date(Date.now() - (20 * 24 * 60 * 60 * 1000)));

            return download.cleanTmpDir()
            .then(() => fs.readdirSync(tmpDir))
            .then((files) => {
                expect(files).to.contain('foo');
                expect(files).not.to.contain('bar');
            });
        });

        it('should not fail to clean the folder if it doesn\'t yet exists', () => {
            cp.execSync(`rm -rf ${tmpDir}`);

            return download.cleanTmpDir();
        });
    });
});
