'use strict';

const moment = require('moment');

require('moment-range');

/**
 * Aggregates an array of points into buckets of date ranges.
 *
 * The array of points must have a `date` property with a moment's date
 *
 * @param {array} points  The array of points
 * @param {array} buckets An array of moment ranges, see https://www.npmjs.com/package/moment-range
 *
 * @return {array} An array of ranges, which are objects with `from`, `to` and `points` properties
 */
function pointsToRanges(points, buckets) {
    return buckets.map((range) => {
        const filteredPoints = points.filter((point) => range.contains(moment.utc(point.date), true));
        const rangeDates = range.toDate();

        return {
            from: moment.utc(rangeDates[0]).toISOString(),
            to: moment.utc(rangeDates[1]).toISOString(),
            points: filteredPoints,
        };
    });
}

/**
 * Utility function that builds a buckets array from breakpoints expressed in days.
 * Useful to use in conjunction with `pointsToRanges()`.
 *
 * @param {array} breakpoints The breakpoints (order must be ASC)
 *
 * @return {array} An array of moment ranges to be used in pointsToRanges.
 */
function bucketsFromBreakpoints(breakpoints) {
    const referenceDate = moment.utc().startOf('day');

    return breakpoints
    .map((breakpoint) => moment.range(referenceDate.clone().subtract(breakpoint, 'd'), referenceDate));
}

module.exports = pointsToRanges;
module.exports.bucketsFromBreakpoints = bucketsFromBreakpoints;
