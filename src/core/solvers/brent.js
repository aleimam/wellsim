// Brent-Dekker root finder — the project's single 1-D solver (used by the
// nodal operating point, and later by ESP matching and the Pres solver).
// Derivative-free and bracket-safe: right for marches with correlation
// branch switches (Pb crossings, dP floors) that break Newton.

/**
 * Find x in [a, b] with f(x) = 0. f(a) and f(b) must have opposite signs.
 * Returns { root, froot, iterations, converged }.
 */
export function brent(f, a, b, { tol = 1e-9, maxIter = 200 } = {}) {
  let fa = f(a);
  let fb = f(b);
  if (Number.isNaN(fa) || Number.isNaN(fb)) throw new Error('brent: f(a) or f(b) is NaN');
  if (fa === 0) return { root: a, froot: 0, iterations: 0, converged: true };
  if (fb === 0) return { root: b, froot: 0, iterations: 0, converged: true };
  if (fa * fb > 0) throw new Error(`brent: root not bracketed: f(${a})=${fa}, f(${b})=${fb}`);

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  let i = 0;
  for (; i < maxIter; i++) {
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b; b = c; c = a;
      fa = fb; fb = fc; fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + tol / 2;
    const xm = (c - b) / 2;
    if (Math.abs(xm) <= tol1 || fb === 0) return { root: b, froot: fb, iterations: i, converged: true };
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p;
      let q;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
  }
  return { root: b, froot: fb, iterations: i, converged: false };
}
