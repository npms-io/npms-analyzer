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
 * @return {array} An array of ranges, which are objects with `from`, `to`, `days` and `points` properties
 */
function pointsToRanges(points, buckets) {
    return buckets.map((range) => {
        const filteredPoints = points.filter((point) => {
            return range.contains(point.date);
        });

        const rangeDates = range.toDate();

        return {
            from: moment(rangeDates[0]).toISOString(),
            to: moment(rangeDates[1]).toISOString(),
            days: range.diff('d'),
            points: filteredPoints,
        };
    });
}

/**
 * Utility function that builds a buckets array from breakpoints expressed in days.
 * Useful to use in conjunction with `pointsToRanges()`.
 *
 * @param {array}  breakpoints The breakpoints (order must be ASC)
 *
 * @return {array} An array of moment ranges to be used in pointsToRanges.
 */
function bucketsFromBreakpoints(breakpoints) {
    const referenceDate = moment.utc().startOf('day');
    let currentBreakpointDate = referenceDate;

    return breakpoints
    .map((breakpoint) => {
        const previousBreakpointDate = currentBreakpointDate;

        currentBreakpointDate = referenceDate.clone().subtract(breakpoint, 'd');

        return moment.range(currentBreakpointDate, previousBreakpointDate);
    });
}

module.exports = pointsToRanges;
module.exports.bucketsFromBreakpoints = bucketsFromBreakpoints;
