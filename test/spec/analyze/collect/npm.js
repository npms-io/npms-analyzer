'use strict';

const expect = require('chai').expect;
const sepia = require(`${process.cwd()}/test/util/sepia`);
const betray = require('betray');
const chronokinesis = require('chronokinesis');
const nano = require('nano');
const loadJsonFile = require('load-json-file');
const packageJsonFromData = require(`${process.cwd()}/lib/analyze/util/packageJsonFromData`);
const npm = require(`${process.cwd()}/lib/analyze/collect/npm`);

const fixturesDir = `${process.cwd()}/test/fixtures/analyze/collect`;
const npmNano = Promise.promisifyAll(nano('http://127.0.0.1:5984/npm'));

describe('npm', () => {
    before(() => {
        sepia.fixtureDir(`${fixturesDir}/recorded/npm`);
        chronokinesis.travel('2016-05-09T18:00:00.000Z');
    });
    after(() => chronokinesis.reset());

    ['cross-spawn'].forEach((name) => {
        it(`should collect \`${name}\` correctly`, () => {
            const data = loadJsonFile.sync(`${fixturesDir}/modules/${name}/data.json`);
            const expected = loadJsonFile.sync(`${fixturesDir}/modules/${name}/expected-npm.json`);

            sepia.enable();

            return npm(data, packageJsonFromData(name, data), npmNano)
            .then((collected) => expect(collected).to.eql(expected))
            .finally(() => sepia.disable());
        });
    });

    it('should handle no results when querying `app/dependedUpon` view', () => {
        const betrayed = betray(npmNano, 'viewAsync', () => Promise.resolve({ rows: [] }));
        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);

        return npm(data, packageJsonFromData('cross-spawn', data), npmNano)
        .then((collected) => expect(collected.dependentsCount).to.equal(0))
        .finally(() => betrayed.restore());
    });

    it('should handle no stats yet error from api.npmjs.org (404)', () => {
        sepia.nock('https://api.npmjs.org')
        .get((path) => path.indexOf('/downloads/range/') === 0)
        .reply(404, { error: 'package cross-spawn not found' });

        sepia.nock('http://127.0.0.1:5984')
        .get('/npm/_design/app/_view/dependedUpon')
        .query({
            startkey: '["cross-spawn"]',
            endkey: '["cross-spawn","￰"]',
            limit: '1',
            reduce: 'true',
            stale: 'update_after',
        })
        .reply(200, { rows: [] });

        const data = loadJsonFile.sync(`${fixturesDir}/modules/cross-spawn/data.json`);

        return npm(data, packageJsonFromData('cross-spawn', data), npmNano)
        .then((collected) => {
            collected.downloads.forEach((download) => expect(download.count).to.equal(0));
        })
        .finally(() => sepia.nock.cleanAll());
    });

    it('should retry on network errors');
});
