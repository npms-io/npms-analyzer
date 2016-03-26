'use strict';

/**
 * Calculate the cubic root of the given number
 *
 * @param {number} x The value
 * @returns {number} The cubic root
 */
function cubeRoot(x) {
    return (x < 0 ? -1 : 1) * Math.pow(Math.abs(x), 1 / 3);
}

/**
 * Solves the cubic equation given, returning an array of solutions.
 * Based on: http://stackoverflow.com/a/27176424
 *
 * @param {number} a Value multiplied to x^3
 * @param {number} b Value multiplied to x^2
 * @param {number} c Value multiplied to x
 * @param {number} d Constant Value
 * @returns {array} Array of roots
 */
function solveCubic(a, b, c, d) {
    if (Math.abs(a) < 1e-8) { // Quadratic case, ax^2+bx+c=0
        a = b; b = c; c = d;

        if (Math.abs(a) < 1e-8) { // Linear case, ax+b=0
            a = b; b = c;

            if (Math.abs(a) < 1e-8) { // Degenerate case
                return [];
            }

            return [-b / a];
        }

        const D = b * b - 4 * a * c;

        if (Math.abs(D) < 1e-8) {
            return [-b / (2 * a)];
        } else if (D > 0) {
            return [(-b + Math.sqrt(D)) / (2 * a), (-b - Math.sqrt(D)) / (2 * a)];
        }

        return [];
    }

    // Convert to depressed cubic t^3+pt+q = 0 (subst x = t - b/3a)
    const p = (3 * a * c - b * b) / (3 * a * a);
    const q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a);
    let roots;

    if (Math.abs(p) < 1e-8) { // p = 0 -> t^3 = -q -> t = -q^1/3
        roots = [cubeRoot(-q)];
    } else if (Math.abs(q) < 1e-8) { // q = 0 -> t^3 + pt = 0 -> t(t^2+p)=0
        roots = [0].concat(p < 0 ? [Math.sqrt(-p), -Math.sqrt(-p)] : []);
    } else {
        const D = q * q / 4 + p * p * p / 27;

        if (Math.abs(D) < 1e-8) {       // D = 0 -> two roots
            roots = [-1.5 * q / p, 3 * q / p];
        } else if (D > 0) {             // Only one real root
            const u = cubeRoot(-q / 2 - Math.sqrt(D));

            roots = [u - p / (3 * u)];
        } else {                        // D < 0, three roots, but needs to use complex numbers/trigonometric solution
            const u = 2 * Math.sqrt(-p / 3);
            const t = Math.acos(3 * q / p / u) / 3;  // D < 0 implies p < 0 and acos argument in [-1..1]
            const k = 2 * Math.PI / 3;

            roots = [u * Math.cos(t), u * Math.cos(t - k), u * Math.cos(t - 2 * k)];
        }
    }

    // Convert back from depressed cubic
    for (let i = 0; i < roots.length; i += 1) {
        roots[i] -= b / (3 * a);
    }

    return roots;
}

module.exports = solveCubic;
