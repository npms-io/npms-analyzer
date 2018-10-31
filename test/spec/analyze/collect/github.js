'use strict';

const expect = require('chai').expect;
const betray = require('betray');
const chronokinesis = require('chronokinesis');
const loadJsonFile = require('load-json-file');
const sepia = require(`${process.cwd()}/test/util/sepia`);
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);
const github = require(`${process.cwd()}/lib/analyze/collect/github`);

const fixturesDir = `${process.cwd()}/test/fixtures/analyze/collect`;

describe('github', () => {
    before(() => {
        sepia.fixtureDir(`${fixturesDir}/recorded/github`);
        chronokinesis.travel('2016-05-09T18:00:00.000Z');
    });
    after(() => chronokinesis.reset());

    ['cross-spawn'].forEach((name) => {
        it(`should collect \`${name}\` correctly`, () => {
            const data = loadJsonFile.sync(`${fixturesDir}/modules/${name}/data.json`);
            const expected = loadJsonFile.sync(`${fixturesDir}/modules/${name}/expected-github.json`);

            sepia.enable();

            return github(packageJsonFromData(name, data), {})
            .then((collected) => expect(collected).to.eql(expected))
            .finally(() => sepia.disable());
        });
    });

    it('should skip if there\'s no repository or if it\'s not hosted on github', () => (
        Promise.try(() => (
            github({ name: 'cross-spawn' }, {})
            .then((collected) => expect(collected).to.equal(null))
        ))
        .then(() => (
            github({
                name: 'cross-spawn',
                repository: { type: 'git', url: 'https://foo.com/IndigoUnited/node-cross-spawn.git' },
            }, {})
            .then((collected) => expect(collected).to.equal(null))
        ))
    ));

    it('should detect forks', () => {
        sepia.enable();

        return github({
            name: 'strong-fork-syslog',
            repository: { type: 'git', url: 'https://github.com/strongloop-forks/strong-fork-syslog' },
        }, {})
        .then((collected) => expect(collected.forkOf).to.equal('schamane/node-syslog'))
        .finally(() => sepia.disable());
    });

    it('should deal with empty repositories', () => {
        sepia.enable();

        const betrayed = betray(logger.children['collect/github'], 'info');

        return github({
            name: 'Cat4D',
            repository: { type: 'git', url: 'git://github.com/Cat4D/Cat4D.git' },
        }, {})
        .then((collected) => {
            expect(betrayed.invoked).to.equal(1);
            expect(betrayed.invocations[0][0]).to.match(/is empty/i);
            expect(collected).to.equal(null);
        })
        .finally(() => {
            sepia.disable();
            betrayed.restore();
        });
    });

    describe('commits activity', () => {
        it('should retry requests if cache is building up', () => {
            const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
            const expected = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/expected-github.json`);

            sepia.enable();

            sepia.nock('https://api.github.com', { allowUnmocked: true })
            .get('/repos/IndigoUnited/node-cross-spawn/stats/commit_activity')
            .reply(202, () => {
                sepia.nock.cleanAll();

                return [];
            });

            return github(packageJsonFromData('cross-spawn', data), {})
            .then((collected) => {
                expect(sepia.nock.isDone()).to.equal(true);
                expect(collected).to.eql(expected);
            })
            .finally(() => {
                sepia.nock.cleanAll();
                sepia.disable();
            });
        });

        it('should not fail if all retries were exhausted');
    });

    describe('unavailable status codes', () => {
        it('should deal with 404 - Not Found errors', () => {
            sepia.enable();

            const betrayed = betray(logger.children['collect/github'], 'info');

            return github({
                name: 'foo',
                repository: { type: 'git', url: 'git://github.com/some-org-that-will-never-exist/some-repo-that-will-never-exist.git' },
            }, {})
            .then((collected) => {
                expect(betrayed.invoked).to.greaterThan(0);
                expect(betrayed.invocations[0][1]).to.match(/failed with 404/i);
                expect(collected).to.equal(null);
            })
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        });

        it('should deal with 400 - Invalid repository name', () => {
            const betrayed = betray(logger.children['collect/github'], 'info');

            // Can't use sepia because of https://github.com/linkedin/sepia/issues/15
            sepia.nock('https://api.github.com')
            .persist()
            .get(/.*/)
            .reply(400);

            return github({
                name: 'foo',
                repository: { type: 'git', url: 'git://github.com/some-org/some-repó' },
            }, {})
            .then((collected) => {
                expect(betrayed.invoked).to.be.greaterThan(1);
                expect(betrayed.invocations[0][1]).to.match(/failed with 400/i);
                expect(collected).to.equal(null);
            })
            .finally(() => {
                betrayed.restore();
                sepia.nock.cleanAll();
            });
        });

        it('should deal with 403/451 - DMCA take down errors', () => {
            sepia.enable();

            const betrayed = betray(logger.children['collect/github'], 'info');

            return github({
                name: 'ps3mca-tool',
                repository: { type: 'git', url: 'git://github.com/jimmikaelkael/ps3mca-tool.git' },
            }, {})
            .then((collected) => {
                expect(betrayed.invoked).to.be.greaterThan(1);
                expect(betrayed.invocations[0][1]).to.match(/failed with 451/i);
                expect(collected).to.equal(null);
            })
            .finally(() => {
                sepia.disable();
                betrayed.restore();
            });
        });
    });

    describe('statuses', () => {
        it('should use downloaded.gitRef when analyzing the commit status', () => {
            const packageJson = {
                name: 'cross-spawn',
                repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn' },
                gitHead: 'foo',
            };

            sepia.enable();

            // See: https://github.com/IndigoUnited/node-cross-spawn/pull/27
            return github(packageJson, { gitRef: '9b77a14a370a6f0b81c9eb58ccade0fad94fe249' })
            .then((collected) => {
                expect(collected.statuses).to.eql([
                    { context: 'continuous-integration/appveyor/pr', state: 'failure' },
                    { context: 'continuous-integration/travis-ci/pr', state: 'success' },
                    { context: 'continuous-integration/appveyor/branch', state: 'failure' },
                    { context: 'continuous-integration/travis-ci/push', state: 'success' },
                ]);
            })
            .finally(() => sepia.disable());
        });

        it('should default to master if downloaded.gitHead is not set when analyzing the commit status', () => {
            const packageJson = {
                name: 'cross-spawn',
                repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn' },
            };

            sepia.enable();

            return github(packageJson, {})
            .then((collected) => {
                expect(collected.statuses).to.eql([
                    { context: 'continuous-integration/appveyor/branch', state: 'success' },
                    { context: 'continuous-integration/travis-ci/push', state: 'success' },
                ]);
            })
            .finally(() => sepia.disable());
        });
    });

    it('should retry on network errors');

    it('should pass the correct options to token-dealer');

    it('should handle rate limit errors (wait/bail)');
});
