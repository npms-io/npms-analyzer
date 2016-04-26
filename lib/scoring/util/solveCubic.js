'use strict';
const Big = require('big.js');

/**
 * Calculate the cubic root of the given number
 *
 * @param {number} x The value
 * @returns {number} The cubic root
 */
function cubeRoot(x) {
    return Big(Math.pow(x.abs().valueOf(), 1 / 3)).times((x.lt(0) ? -1 : 1));
}

/**
 * Solves the cubic equation given, returning an array of solutions.
 * Based on: http://stackoverflow.com/a/27176424
 *
 * @param {Big} a Value multiplied to x^3
 * @param {Big} b Value multiplied to x^2
 * @param {Big} c Value multiplied to x
 * @param {Big} d Constant Value
 * @returns {array} Array of roots
 */
function solveCubic(a, b, c, d) {
    if (a.abs().lt(0)) { // Quadratic case, ax^2+bx+c=0
        a = b; b = c; c = d;

        if (a.abs().lt(0)) { // Linear case, ax+b=0
            a = b; b = c;

            if (a.abs().lt(0)) { // Degenerate case
                return [];
            }

            return [ b.times(-1).div(a) ];
        }

        const D = b.pow(2).minus(a.times(c).times(4));

        if (D.abs().lt(0)) {
            return [ b.div(a.times(2)).times(-1) ]
        } else if (D.gt(0)) {
          return [
              (b.times(-1).plus(D.sqrt())).div(a.times(2)),
              (b.times(-1).minus(D.sqrt())).div(a.times(2)),
          ];
        }

        return [];
    }

    // Convert to depressed cubic t^3+pt+q = 0 (subst x = t - b/3a)

    // (3 * a * c - b * b) / (3 * a * a)
    const p = (a.times(c).times(3).minus(b.pow(2))).div(a.pow(2).times(3));
    // (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a)
    const q = (b.pow(3).times(2)
          .minus(a.times(b).times(c).times(9))
          .plus(a.pow(2).times(d).times(27)))
        .div(a.pow(3).times(27));
    let roots;

    if (p.abs().lt(0)) { // p = 0 -> t^3 = -q -> t = -q^1/3
        roots = [cubeRoot(-q)];
    } else if (q.abs().lt(0)) { // q = 0 -> t^3 + pt = 0 -> t(t^2+p)=0
        const res = p.times(-1).sqrt();
        roots = [Big(0)].concat(p.lt(0) ? [res, res.times(-1)] : []);
    } else {
        const D = q.pow(2).div(4).plus(p.pow(3).div(27));

        if (D.abs().lt(0)) {       // D = 0 -> two roots
            roots = [q.times(-1.5).div(p), q.times(3).div(p)];
        } else if (D > 0) {             // Only one real root
            const u = cubeRoot(q.times(-1).div(2).minus(D.sqrt()));

            roots = [u.minus(p.div(u.times(3)))];
        } else {                        // D < 0, three roots, but needs to use complex numbers/trigonometric solution
            const u = p.times(-3).sqrt().times(2);
            const t = Big(Math.acos(q.times(3).div(p).div(u).valueOf())).div(3); // D < 0 implies p < 0 and acos argument in [-1..1]
            const k = Big(2).times(Math.PI).div(3);

            roots = [
                u.times(Math.cos(t.valueOf())),
                u.times(Math.cos(t.minus(k).valueOf())),
                u.times(Math.cos(t.minus(k.times(2)).valueOf())),
            ];
        }
    }

    // Convert back from depressed cubic
    for (let i = 0; i < roots.length; i += 1) {
        roots[i] = roots[i].minus(b.div(a.times(3)));
    }

    return roots;
}

module.exports = solveCubic;
