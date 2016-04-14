'use strict';

const fs = require('fs');
const cp = require('child_process');
const loadJsonFile = require('load-json-file');
const expect = require('chai').expect;
const git = require('../../../../lib/analyze/download/git');

describe('git', () => {
    const testDir = `${__dirname}/../../..`;
    const tmpDir = `${testDir}/tmp`;

    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should detect GitHub, GitLab and BitBucket endpoints', () => {
        let download;

        download = git({ repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.be.a('function');

        download = git({ repository: { type: 'git', url: 'git@github.com:IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.be.a('function');

        download = git({ repository: { type: 'git', url: 'https://github.com/IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.be.a('function');

        download = git({ repository: { type: 'git', url: 'git@gitlab.com:codium/angular-ui-select.git' } });
        expect(download).to.be.a('function');

        download = git({ repository: { type: 'git', url: 'https://gitlab.com/codium/angular-ui-select.git' } });
        expect(download).to.be.a('function');

        download = git({ repository: { type: 'git', url: 'git@bitbucket.org:fvdm/node-xml2json.git' } });
        expect(download).to.be.a('function');

        download = git({ repository: { type: 'git', url: 'https://bitbucket.org/fvdm/node-xml2json.git' } });
        expect(download).to.be.a('function');

        download = git({ repository: { type: 'git', url: 'https://foo.com/IndigoUnited/node-cross-spawn.git' } });
        expect(download).to.equal(null);
    });

    it('should clone a GitHub repository and checkout a specific ref', () => {
        return Promise.each([
            'git://github.com/IndigoUnited/node-cross-spawn.git',
            'git@github.com:IndigoUnited/node-cross-spawn.git',
            'https://github.com/IndigoUnited/node-cross-spawn.git',
        ], (url) => {
            const download = git({
                name: 'cross-spawn',
                repository: { type: 'git', url },
                gitHead: '5fb20ce2f44d9947fcf59e8809fe6cb1d767433b',
            });

            return download(tmpDir)
            .then(() => loadJsonFile.sync(`${tmpDir}/package.json`))
            .then((packageJson) => expect(packageJson.version).to.equal('0.1.0'))
            .then(() => {
                cp.execSync(`rm -rf ${tmpDir}`);
                cp.execSync(`mkdir -p ${tmpDir}`);
            });
        });
    });

    it('should clone a Bitbucket repository and checkout a specific ref', () => {
        return Promise.each([
            'git@bitbucket.org:fvdm/node-xml2json.git',
            'https://bitbucket.org/fvdm/node-xml2json.git',
        ], (url) => {
            const download = git({
                name: 'xml2json',
                repository: { type: 'git', url },
                gitHead: '4c8dc5c636f7bbb746ed519a39bb1b183a27064d',
            });

            return download(tmpDir)
            .then(() => loadJsonFile.sync(`${tmpDir}/package.json`))
            .then((packageJson) => expect(packageJson.version).to.equal('0.2.2'))
            .then(() => {
                cp.execSync(`rm -rf ${tmpDir}`);
                cp.execSync(`mkdir -p ${tmpDir}`);
            });
        });
    });

    it('should clone a GitLab repository and checkout a specific ref', () => {
        return Promise.each([
            'git@gitlab.com:codium/angular-ui-select.git',
            'https://gitlab.com/codium/angular-ui-select.git',
        ], (url) => {
            const download = git({
                name: 'angular-ui-select',
                repository: { type: 'git', url },
                gitHead: '560042cc9005e5f2c2889a3c7e64ea3ea0b80c88',
            });

            return download(tmpDir)
            .then(() => loadJsonFile.sync(`${tmpDir}/bower.json`))
            .then((bowerJson) => expect(bowerJson.version).to.equal('0.2.0'))
            .then(() => {
                cp.execSync(`rm -rf ${tmpDir}`);
                cp.execSync(`mkdir -p ${tmpDir}`);
            });
        });
    });

    it('should not fail if the ref does not exist', () => {
        const download = git({
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

    it('should deal with non-existent repositories', () => {
        return Promise.each([
            'git://github.com/some-org/repo-404.git',
            'https://bitbucket.org/some-org/repo-404.git',
            'https://gitlab.com/some-org/repo-404.git',
        ], (url) => {
            const download = git({ name: 'cool-module', repository: { type: 'git', url } });

            return download(tmpDir)
            .then(() => expect(fs.readdirSync(`${tmpDir}`)).to.eql(['package.json']))
            .then(() => {
                cp.execSync(`rm -rf ${tmpDir}`);
                cp.execSync(`mkdir -p ${tmpDir}`);
            });
        });
    });

    it('should deal with permission errors');

    it('should deal with invalid repositories', () => {
        return Promise.each([
            'https://foo:bar@github.com/org/foo+bar.git',
            'https://bitbucket.org/some-org/foo+bar.git',
            'https://gitlab.com/some-org/foo+bar.git',
        ], (url) => {
            const download = git({ name: 'cool-module', repository: { type: 'git', url } });

            return download(tmpDir)
            .then(() => expect(fs.readdirSync(`${tmpDir}`)).to.eql(['package.json']))
            .then(() => {
                cp.execSync(`rm -rf ${tmpDir}`);
                cp.execSync(`mkdir -p ${tmpDir}`);
            });
        });
    });

    it('should merge package.json', () => {
        const npmPackageJson = {
            name: 'cool-module',
            repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn.git' },
            gitHead: '5fb20ce2f44d9947fcf59e8809fe6cb1d767433b', // This is the ref for 1.0.0
        };

        const download = git(npmPackageJson);

        return download(tmpDir)
        .then(() => loadJsonFile(`${tmpDir}/package.json`))
        .then((packageJson) => {
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
