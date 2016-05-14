'use strict';

const moment = require('moment');
const expect = require('chai').expect;
const chronokinesis = require('chronokinesis');
const values = require('lodash/values');
const pointsToRanges = require(`${process.cwd()}/lib/analyze/collect/util/pointsToRanges`);

require('moment-range');

describe('pointsToRanges', () => {
    it('should arrange points into ranges', () => {
        const points = {
            a: {
                date: '2016-05-01T00:00:00.000Z',
                value: 'foo',
            },
            b: {
                date: '2016-05-10T00:00:00.000Z',
                value: 'foo',
            },
            c: {
                date: '2016-05-20T00:00:00.000Z',
                value: 'foo',
            },
            d: {
                date: '2016-05-30T00:00:00.000Z',
                value: 'foo',
            },
            e: {
                date: '2016-06-10T00:00:00.000Z',
                value: 'foo',
            },
            f: {
                date: '2016-06-20T00:00:00.000Z',
                value: 'foo',
            },
        };

        const ranges = pointsToRanges(values(points), [
            moment.range('2016-05-01T00:00:00.000Z', '2016-05-11T00:00:00.000Z'),
            moment.range('2016-05-11T00:00:00.000Z', '2016-05-12T00:00:00.000Z'),
            moment.range('2016-05-12T00:00:00.000Z', '2016-06-10T00:00:00.000Z'),
            moment.range('2016-06-10T00:00:00.000Z', '2017-01-01T00:00:00.000Z'),
        ]);

        expect(ranges).to.eql([
            {
                from: '2016-05-01T00:00:00.000Z',
                to: '2016-05-11T00:00:00.000Z',
                points: [points.a, points.b],
            },
            {
                from: '2016-05-11T00:00:00.000Z',
                to: '2016-05-12T00:00:00.000Z',
                points: [],
            },
            {
                from: '2016-05-12T00:00:00.000Z',
                to: '2016-06-10T00:00:00.000Z',
                points: [points.c, points.d],
            },
            {
                from: '2016-06-10T00:00:00.000Z',
                to: '2017-01-01T00:00:00.000Z',
                points: [points.e, points.f],
            },
        ]);
    });

    describe('bucketsFromBreakpoints', () => {
        before(() => chronokinesis.travel('2016-05-14T15:00:00.000Z'));
        after(() => chronokinesis.reset());

        it('should generate ranges based on breakpoints', () => {
            const ranges = pointsToRanges.bucketsFromBreakpoints([1, 7, 15, 30, 90]);
            const dates = ranges.map((range) => range.toDate().map((date) => date.toISOString()));

            expect(dates).to.eql([
                ['2016-05-13T00:00:00.000Z', '2016-05-14T00:00:00.000Z'],
                ['2016-05-07T00:00:00.000Z', '2016-05-14T00:00:00.000Z'],
                ['2016-04-29T00:00:00.000Z', '2016-05-14T00:00:00.000Z'],
                ['2016-04-14T00:00:00.000Z', '2016-05-14T00:00:00.000Z'],
                ['2016-02-14T00:00:00.000Z', '2016-05-14T00:00:00.000Z'],
            ]);
        });
    });
});
