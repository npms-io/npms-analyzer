'use strict';

const expect = require('chai').expect;
const sepia = require('sepia');
const chronokinesis = require('chronokinesis');
const loadJsonFile = require('load-json-file');
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);
const github = require(`${process.cwd()}/lib/analyze/collect/github`);

const fixturesDir = `${process.cwd()}/test/fixtures/analyze/collect`;

describe('github', () => {
    before(() => {
        sepia.fixtureDir(`${fixturesDir}/recorded/github`);
        chronokinesis.travel('2016-05-09T18:00:00.000Z');
    });
    after(() => chronokinesis.reset());

    it('should skip if there\'s no repository or if it\'s not hosted on github', () => {
        return Promise.try(() => {
            return github({ name: 'cross-spawn' })
            .then((collected) => expect(collected).to.equal(null));
        })
        .then(() => {
            return github({
                name: 'cross-spawn',
                repository: { type: 'git', url: 'https://foo.com/IndigoUnited/node-cross-spawn.git' },
            })
            .then((collected) => expect(collected).to.equal(null));
        });
    });

    it('should collect cross-spawn correctly', () => {
        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
        const expected = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/expected-github.json`);

        sepia.enable();

        return github(packageJsonFromData('cross-spawn', data))
        .then((collected) => expect(collected).to.eql(expected))
        .finally(() => sepia.disable());
    });

    it('should detect forks', () => {
        sepia.enable();

        return github({
            name: 'strong-fork-syslog',
            repository: { type: 'git', url: 'https://github.com/strongloop-forks/strong-fork-syslog' },
        })
        .then((collected) => expect(collected.forkOf).to.equal('schamane/node-syslog'))
        .finally(() => sepia.disable());
    });

    it('should deal with empty repositories', () => {
        sepia.enable();

        return github({
            name: 'Cat4D',
            repository: { type: 'git', url: 'git://github.com/Cat4D/Cat4D.git' },
        })
        .then((collected) => expect(collected).to.equal(null))
        .finally(() => sepia.disable());
    });

    describe('statuses', () => {
        it('should use options.ref when analyzing the commit status', () => {
            const packageJson = {
                name: 'cross-spawn',
                repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn' },
                gitHead: 'foo',
            };

            sepia.enable();

            // See: https://github.com/IndigoUnited/node-cross-spawn/pull/27
            return github(packageJson, { ref: '9b77a14a370a6f0b81c9eb58ccade0fad94fe249' })
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

        it('should default to packageJson.gitHead', () => {
            const packageJson = {
                name: 'cross-spawn',
                repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn' },
                gitHead: '7bc71932e517c974c80f54ae9f7687c9cd25db74',
            };

            sepia.enable();

            return github(packageJson)
            .then((collected) => {
                expect(collected.statuses).to.eql([
                    { context: 'continuous-integration/appveyor/branch', state: 'success' },
                    { context: 'continuous-integration/travis-ci/push', state: 'success' },
                ]);
            })
            .finally(() => sepia.disable());
        });

        it('should default to master if packageJson.gitHead is not set', () => {
            const packageJson = {
                name: 'cross-spawn',
                repository: { type: 'git', url: 'git://github.com/IndigoUnited/node-cross-spawn' },
            };

            sepia.enable();

            return github(packageJson)
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
