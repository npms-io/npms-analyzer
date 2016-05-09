'use strict';

const expect = require('chai').expect;
const sepia = require('sepia');
const nock = require('nock');
const chronokinesis = require('chronokinesis');
const nano = require('nano');
const loadJsonFile = require('load-json-file');
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);
const npm = require(`${process.cwd()}/lib/analyze/collect/npm`);

const fixturesDir = `${process.cwd()}/test/fixtures/analyze/collect`;
const npmNano = Promise.promisifyAll(nano('https://skimdb.npmjs.com/registry'));

describe('npm', () => {
    before(() => sepia.fixtureDir(`${fixturesDir}/recorded/npm`));

    it('should collect cross-spawn correctly', () => {
        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);
        const expected = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/expected-npm.json`);

        sepia.enable();
        chronokinesis.travel('2016-05-09T18:00:00.000Z');

        return npm(data, packageJsonFromData('cross-spawn', data), npmNano)
        .then((collected) => expect(collected).to.eql(expected))
        .finally(() => {
            sepia.disable();
            chronokinesis.reset();
        });
    });

    it('should handle 200 OK error responses from api.npmjs.org', () => {
        nock('https://api.npmjs.org')
        .get((path) => path.indexOf('/downloads/range/') === 0)
        .reply(200, { error: 'foo' });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);

        return npm(data, packageJsonFromData('cross-spawn', data), npmNano)
        .then(() => {
            throw new Error('Expected to fail');
        }, (err) => {
            expect(nock.isDone()).to.equal(true);
            expect(err.message).to.equal('foo');
        })
        .finally(() => nock.cleanAll());
    });

    it('should handle `no stats yet` error from api.npmjs.org', () => {
        nock('https://api.npmjs.org')
        .get((path) => path.indexOf('/downloads/range/') === 0)
        .reply(200, { error: 'no stats for this package' });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);

        return npm(data, packageJsonFromData('cross-spawn', data), npmNano)
        .then((collected) => {
            collected.downloads.forEach((download) => expect(download.count).to.equal(0));
        })
        .finally(() => nock.cleanAll());
    });

    it('should retry on network errors');
});
