'use strict';

const cp = require('child_process');
const loadJsonFile = require('load-json-file');
const nano = require('nano');
const expect = require('chai').expect;
const betray = require('betray');
const sepia = require('sepia');
const collect = require(`${process.cwd()}/lib/analyze/collect`);
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);

const tmpDir = `${process.cwd()}/test/tmp`;
const fixturesDir = `${process.cwd()}/test/fixtures/analyze/collect`;
const npmNano = Promise.promisifyAll(nano('https://skimdb.npmjs.com/registry'));

describe('index', () => {
    before(() => sepia.fixtureDir(`${fixturesDir}/recorded/index`));
    beforeEach(() => cp.execSync(`mkdir -p ${tmpDir}`));
    afterEach(() => cp.execSync(`rm -rf ${tmpDir}`));

    it('should call all the collectors with the correct arguments', () => {
        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
        const packageJson = packageJsonFromData('cross-spawn', data);
        const downloaded = { downloader: 'github', dir: tmpDir, packageJson, gitRef: packageJson.gitHead };
        const options = { githubTokens: ['foo', 'bar'], waitRateLimit: true };

        const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve('metadata'));
        const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve('npm'));
        const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve('github'));
        const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve('source'));

        return collect(data, packageJson, downloaded, npmNano, options)
        .then((collected) => {
            expect(betrayedMetadata.invoked).to.equal(1);
            expect(betrayedMetadata.invocations[0]).to.eql([data, packageJson]);

            expect(betrayedNpm.invoked).to.equal(1);
            expect(betrayedNpm.invocations[0]).to.eql([data, packageJson, npmNano]);

            expect(betrayedGithub.invoked).to.equal(1);
            expect(betrayedGithub.invocations[0]).to.eql([packageJson, downloaded, {
                tokens: options.githubTokens,
                waitRateLimit: options.waitRateLimit,
            }]);

            expect(betrayedSource.invoked).to.equal(1);
            expect(betrayedSource.invocations[0]).to.eql([data, packageJson, downloaded, {
                npmRegistry: `${npmNano.config.url}/${npmNano.config.db}`,
            }]);

            expect(collected).to.eql({ metadata: 'metadata', npm: 'npm', github: 'github', source: 'source' });
        });
    });

    describe('repository ownership', () => {
        it('should detect if name is the same as the downloaded one', () => {
            const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
            const packageJson = packageJsonFromData('cross-spawn', data);
            const downloaded = { downloader: 'github', dir: tmpDir, packageJson, gitRef: packageJson.gitHead };

            const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve());
            const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve());
            const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve());
            const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve());

            return collect(data, packageJson, downloaded, npmNano)
            .then(() => {
                expect(betrayedMetadata.invoked).to.equal(1);
                expect(betrayedNpm.invoked).to.equal(1);
                expect(betrayedGithub.invoked).to.equal(1);
                expect(betrayedSource.invoked).to.equal(1);
            });
        });

        it('should detect if both have no repository', () => {
            const data = { name: 'cross-spawn' };
            const packageJson = { name: 'cross-spawn-foo' };
            const downloaded = { downloader: 'github', dir: tmpDir, packageJson: data, gitRef: packageJson.gitHead };

            const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve());
            const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve());
            const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve());
            const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve());

            return collect(data, packageJson, downloaded, npmNano)
            .then(() => {
                expect(betrayedMetadata.invoked).to.equal(1);
                expect(betrayedNpm.invoked).to.equal(1);
                expect(betrayedGithub.invoked).to.equal(1);
                expect(betrayedSource.invoked).to.equal(1);
            });
        });

        it('should detect repositories belong to the same org', () => {
            const data = {
                name: 'bower-canary',
                maintainers: [{ name: 'André Cruz', email: 'andremiguelcruz@msn.com' }],
            };
            const packageJson = {
                name: 'bower-canary',
                repository: { type: 'git', url: 'git://github.com/bower/bower-canary.git' },
            };
            const downloadedPackageJson = {
                name: 'bower',
                repository: { type: 'git', url: 'git://github.com/bower/bower.git' },
            };
            const downloaded = { downloader: 'github', dir: tmpDir, packageJson: downloadedPackageJson, gitRef: null };

            const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve());
            const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve());
            const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve());
            const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve());

            return collect(data, packageJson, downloaded, npmNano)
            .then(() => {
                expect(betrayedMetadata.invoked).to.equal(1);
                expect(betrayedNpm.invoked).to.equal(1);
                expect(betrayedGithub.invoked).to.equal(1);
                expect(betrayedSource.invoked).to.equal(1);
            });
        });

        it('should detect empty downloaded package.json\'s (download failed)', () => {
            const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
            const packageJson = packageJsonFromData('cross-spawn', data);
            const downloaded = { downloader: 'github', dir: tmpDir, packageJson: {}, gitRef: packageJson.gitHead };

            const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve());
            const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve());
            const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve());
            const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve());

            return collect(data, packageJson, downloaded, npmNano)
            .then(() => {
                expect(betrayedMetadata.invoked).to.equal(1);
                expect(betrayedNpm.invoked).to.equal(1);
                expect(betrayedGithub.invoked).to.equal(0);
                expect(betrayedSource.invoked).to.equal(0);
            });
        });

        it('should detect if any of maintainers are the same', () => {
            sepia.enable();

            const data = {
                name: 'bower-fork',
                maintainers: [{ name: 'André Cruz', email: 'andremiguelcruz@msn.com' }],
            };
            const packageJson = {
                name: 'bower-fork',
                repository: { type: 'git', url: 'git://github.com/user/bower.git' },
            };
            const downloadedPackageJson = {
                name: 'bower',
                repository: { type: 'git', url: 'git://github.com/bower/bower.git' },
            };
            const downloaded = { downloader: 'github', dir: tmpDir, packageJson: downloadedPackageJson, gitRef: null };

            const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve());
            const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve());
            const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve());
            const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve());

            return collect(data, packageJson, downloaded, npmNano)
            .then(() => {
                expect(betrayedMetadata.invoked).to.equal(1);
                expect(betrayedNpm.invoked).to.equal(1);
                expect(betrayedGithub.invoked).to.equal(1);
                expect(betrayedSource.invoked).to.equal(1);
            })
            .finally(() => sepia.disable());
        });

        it('should not assume ownership for malicious modules', () => {
            sepia.enable();

            // Complete example
            return Promise.try(() => {
                const data = { name: 'bower-fork', maintainers: [] };
                const packageJson = {
                    name: 'bower-fork',
                    repository: { type: 'git', url: 'git://github.com/user/bower.git' },
                };
                const downloadedPackageJson = {
                    name: 'bower',
                    repository: { type: 'git', url: 'git://github.com/bower/bower.git' },
                };
                const downloaded = { downloader: 'github', dir: tmpDir, packageJson: downloadedPackageJson, gitRef: null };

                const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve('metadata'));
                const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve('npm'));
                const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve('github'));
                const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve('source'));

                return collect(data, packageJson, downloaded, npmNano)
                .then(() => {
                    expect(betrayedMetadata.invoked).to.equal(1);
                    expect(betrayedNpm.invoked).to.equal(1);
                    expect(betrayedGithub.invoked).to.equal(0);
                    expect(betrayedSource.invoked).to.equal(0);
                });
            })
            // Without repository
            .then(() => {
                const data = { name: 'bower-fork' };
                const packageJson = data;
                const downloadedPackageJson = {
                    name: 'bower',
                    repository: { type: 'git', url: 'git://github.com/bower/bower.git' },
                };
                const downloaded = { downloader: 'github', dir: tmpDir, packageJson: downloadedPackageJson, gitRef: null };

                const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve('metadata'));
                const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve('npm'));
                const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve('github'));
                const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve('source'));

                return collect(data, packageJson, downloaded, npmNano)
                .then(() => {
                    expect(betrayedMetadata.invoked).to.equal(1);
                    expect(betrayedNpm.invoked).to.equal(1);
                    expect(betrayedGithub.invoked).to.equal(0);
                    expect(betrayedSource.invoked).to.equal(0);
                });
            })
            // Without maintainers
            .then(() => {
                const data = { name: 'graphql-shorthand-parser-fork' };
                const packageJson = {
                    name: 'graphql-shorthand-parser-fork',
                    repository: { type: 'git', url: 'git://github.com/user/graphql-shorthand-parser.git' },
                };
                const downloadedPackageJson = {
                    name: 'graphql-shorthand-parser',
                    repository: { type: 'git', url: 'git://github.com/other-user/graphql-shorthand-parser.git' },
                };
                const downloaded = { downloader: 'github', dir: tmpDir, packageJson: downloadedPackageJson, gitRef: null };

                const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve('metadata'));
                const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve('npm'));
                const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve('github'));
                const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve('source'));

                return collect(data, packageJson, downloaded, npmNano)
                .then(() => {
                    expect(betrayedMetadata.invoked).to.equal(1);
                    expect(betrayedNpm.invoked).to.equal(1);
                    expect(betrayedGithub.invoked).to.equal(0);
                    expect(betrayedSource.invoked).to.equal(0);
                });
            })
            .finally(() => sepia.disable());
        });

        it('should still call the source collector if the downloaded source was not from a repository', () => {
            const data = {
                name: 'bower-fork',
                repository: { type: 'git', url: 'git://github.com/user/bower.git' },
            };
            const packageJson = data;
            const downloadedPackageJson = {
                name: 'bower',
                repository: { type: 'git', url: 'git://github.com/bower/bower.git' },
            };
            const downloaded = { downloader: 'npm', dir: tmpDir, packageJson: downloadedPackageJson };

            const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve());
            const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve());
            const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve());
            const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve());

            return collect(data, packageJson, downloaded, npmNano)
            .then(() => {
                expect(betrayedMetadata.invoked).to.equal(1);
                expect(betrayedNpm.invoked).to.equal(1);
                expect(betrayedGithub.invoked).to.equal(0);
                expect(betrayedSource.invoked).to.equal(1);
            });
        });

        it('should work around not_found errors when fetching the downloaded data', () => {
            sepia.enable();

            const data = { name: 'bower-fork' };
            const packageJson = {
                name: 'bower-fork',
                repository: { type: 'git', url: 'git://github.com/user/bower.git' },
            };
            const downloadedPackageJson = {
                name: 'some-module-that-will-never-exist',
            };
            const downloaded = { downloader: 'github', dir: tmpDir, packageJson: downloadedPackageJson, gitRef: null };

            const betrayedMetadata = betray(collect.collectors, 'metadata', () => Promise.resolve());
            const betrayedNpm = betray(collect.collectors, 'npm', () => Promise.resolve());
            const betrayedGithub = betray(collect.collectors, 'github', () => Promise.resolve());
            const betrayedSource = betray(collect.collectors, 'source', () => Promise.resolve());

            return collect(data, packageJson, downloaded, npmNano)
            .then(() => {
                expect(betrayedMetadata.invoked).to.equal(1);
                expect(betrayedNpm.invoked).to.equal(1);
                expect(betrayedGithub.invoked).to.equal(0);
                expect(betrayedSource.invoked).to.equal(0);
            })
            .finally(() => sepia.disable());
        });
    });
});
