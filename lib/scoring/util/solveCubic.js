'use strict';
const Big = require('bignumber.js');

/**
 * Calculate the cubic root of the given number
 *
 * @param {number} x The value
 *
 * @return {number} The cubic root
 */
function cubeRoot(x) {
    x = x instanceof Big ? Number(x.valueOf()) : x;
    const root = Math.pow(Math.abs(x), 1 / 3);

    return x < 0 ? -root : root;
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
    const p = (3 * c - Math.pow(b, 2)) / 3;
    const q = (2 * Math.pow(b, 3) - 9 * b * c + 27 * d) / 27;
    let roots;

    if (Math.abs(p) < 1e-11) { // p = 0 -> t^3 = -q -> t = -q^1/3
        roots = [cubeRoot(-q)];
    } else if (Math.abs(q) < 1e-11) { // q = 0 -> t^3 + pt = 0 -> t(t^2+p)=0
        const res = Math.sqrt(-p);

        roots = [0].concat(p < 1e-11 ? [res, -res] : []);
    } else {
        const D = q * q / 4 + Math.pow(p, 3) / 27;

        if (Math.abs(D) < 1e-11) { // D = 0 -> two roots
            const r = q / p;

            roots = [-1.5 * r, 3 * r];
        } else if (Math.abs(D) > 0) { // Only one real root
            const u = cubeRoot(-q / 2 - Math.sqrt(D));

            roots = [u - (p / (3 * u))];
        } else {  // D < 0, three roots, but needs to use complex numbers/trigonometric solution
            const u = new Big(p).times(-3).sqrt().times(2);
            const t = new Big(Math.acos(new Big(q * 3).div(u.mul(p)).valueOf())).div(3); // D < 0 implies p < 0 and acos argument in [-1..1]
            const k = new Big(2 / 3 * Math.PI);

            roots = [
                u.times(Math.cos(t.valueOf())),
                u.times(Math.cos(t.minus(k).valueOf())),
                u.times(Math.cos(t.minus(k.times(2)).valueOf())),
            ];
        }
    }

    // Convert back from depressed cubic

    const B = b / 3;

    for (let i = 0; i < roots.length; i += 1) {
        roots[i] = roots[i] - B;
    }

    return roots;
}

module.exports = solveCubic;
