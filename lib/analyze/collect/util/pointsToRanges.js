'use strict';

const moment = require('moment');

/**
 * Aggregates an array of points into buckets of date ranges.
 *
 * The array of points must have a `date` property with a moment's date.
 *
 * @param {Array} points  - The array of points.
 * @param {Array} buckets - An array of buckets, see bucketsFromBreakpoints().
 *
 * @returns {Array} An array of ranges, which are objects with `from`, `to` and `points` properties.
 */
function pointsToRanges(points, buckets) {
    return buckets.map((bucket) => {
        const filteredPoints = points.filter((point) => moment.utc(point.date).isBetween(bucket.start, bucket.end, null, '[)'));

        return {
            from: moment.utc(bucket.start).toISOString(),
            to: moment.utc(bucket.end).toISOString(),
            points: filteredPoints,
        };
    });
}

/**
 * Utility function that builds a buckets array from breakpoints expressed in days.
 * Useful to use in conjunction with `pointsToRanges()`.
 *
 * @param {Array} breakpoints - The breakpoints (order must be ASC).
 *
 * @returns {Array} An array of objects containaing `start` and `end` moment dates to be used in pointsToRanges.
 */
function bucketsFromBreakpoints(breakpoints) {
    const referenceDate = moment.utc().startOf('day');

    return breakpoints
    .map((breakpoint) => ({
        start: referenceDate.clone().subtract(breakpoint, 'd'),
        end: referenceDate,
    }));
}

module.exports = pointsToRanges;
module.exports.bucketsFromBreakpoints = bucketsFromBreakpoints;
