'use strict';
const Big = require('big.js');

Big.DP = 16;

/**
 * Calculate the cubic root of the given number
 *
 * @param {number} x The value
 *
 * @return {number} The cubic root
 */
function cubeRoot(x) {
    const root = Math.pow(x.abs().valueOf(), 1 / 3);
    return new Big(x.lt(0) ? -root : root);
}

/**
 * Solves the cubic equation given, returning an array of solutions.
 * Based on: http://stackoverflow.com/a/27176424
 * Assumes a = 1
 *
 * @param {Big} b Value multiplied to x^2
 * @param {Big} c Value multiplied to x
 * @param {Big} d Constant Value
 *
 * @return {array} Array of roots
 */
function solveCubic(b, c, d) {
    // Convert to depressed cubic t^3+pt+q = 0 (subst x = t - b/3a)

    // (3 * c - b * b) / (3 * a * a)
    const p = (c.times(3).minus(b.pow(2))).div(3);
    // (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a)
    const q = (b.pow(3).times(2)
          .minus(b.times(c).times(9))
          .plus(d.times(27)))
        .div(27);
    let roots;

    if (p.abs().lt(0)) { // p = 0 -> t^3 = -q -> t = -q^1/3
        roots = [cubeRoot(-q)];
    } else if (q.abs().lt(0)) { // q = 0 -> t^3 + pt = 0 -> t(t^2+p)=0
        const res = p.times(-1).sqrt();

        roots = [new Big(0)].concat(p.lt(0) ? [res, res.times(-1)] : []);
    } else {
        const D = q.pow(2).div(4).plus(p.pow(3).div(27));

        if (D.abs().lt(0)) { // D = 0 -> two roots
            const r = q.div(p);

            roots = [r.times(-1.5), r.times(3)];
        } else if (D.gt(0)) { // Only one real root
            const u = cubeRoot(q.times(-1).div(2).minus(D.sqrt()));

            roots = [u.minus(p.div(u.times(3)))];
        } else {  // D < 0, three roots, but needs to use complex numbers/trigonometric solution
            const u = p.times(-3).sqrt().times(2);
            const t = new Big(Math.acos(q.times(3).div(p.mul(u)).valueOf())).div(3); // D < 0 implies p < 0 and acos argument in [-1..1]
            const k = new Big(2 / 3 * Math.PI);

            roots = [
                u.times(Math.cos(t.valueOf())),
                u.times(Math.cos(t.minus(k).valueOf())),
                u.times(Math.cos(t.minus(k.times(2)).valueOf())),
            ];
        }
    }

    // Convert back from depressed cubic

    const B = b.div(3);

    for (let i = 0; i < roots.length; i += 1) {
        roots[i] = roots[i].minus(B);
    }

    return roots;
}

module.exports = solveCubic;
