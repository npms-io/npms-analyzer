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
            return github({}, { name: 'cross-spawn' })
            .then((collected) => expect(collected).to.equal(null));
        })
        .then(() => {
            return github({}, {
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

        return github(data, packageJsonFromData('cross-spawn', data))
        .then((collected) => expect(collected).to.eql(expected))
        .finally(() => sepia.disable());
    });

    it('should retry on network errors');
});
