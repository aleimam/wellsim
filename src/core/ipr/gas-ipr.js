// Gas IPR — squared-pressure Darcy J and the back-pressure C&n form, as the
// gas workbook and "7. Gas inflow Performance relationship" deck define them.
// Rates in MMscf/d, pressures psi. q = J*(Pr^2 - Pwf^2)/1000 with J in
// Mscf/d/psi^2 (the sheet's 1000 divisor), and q = C*(Pr^2 - Pwf^2)^n.
//
// Like the oil side, the gas IPR record keeps TWO pressures under the same
// "pr" name: priPsi (initial — the C&n / J fit is anchored there, the
// deck's "Pri2-FBHP2" columns) and prPsi (current — what the curve is
// evaluated at; the Pres solver updates it via withCurrentPr).

export { withCurrentPr, resetToInitialPr, withJSource } from './oil-ipr.js';

/** Build a gas IPR record ({jTest/jDarcy/darcy} or {c, n} basis). Same
 *  hierarchy as oil: the DARCY J is the program's default and dominant J —
 *  give it directly or via darcy: { permMd, thicknessFt, viscCp, z, tresF,
 *  reFt, rwFt, skin } (stored for re-matching). Jones (test) is optional
 *  and selectable; legacy { j } maps to it. C&n records carry c/n and
 *  ignore the J machinery. */
export function createGasIpr({ jTest, jDarcy, jSource, j, darcy, c, n, priPsi, prPsi }) {
  if (c != null) return { c, n, priPsi, prPsi: prPsi ?? priPsi };
  const jt = jTest ?? j;
  const jd = jDarcy ?? (darcy ? jDarcyGas(darcy) : undefined);
  const src = jSource ?? (jd != null ? 'darcy' : 'jones');
  const active = src === 'darcy' ? jd : jt;
  if (active == null)
    throw new Error(`createGasIpr: jSource '${src}' selected but that J record is missing`);
  return { jTest: jt, jDarcy: jd, jSource: src, j: active, darcy, priPsi, prPsi: prPsi ?? priPsi };
}

/** Gas "calibrate Darcy": user inputs skin, matched K solved closed-form so
 *  jDarcy equals the test J. Mirrors calibrateDarcyToTest (oil). */
export function calibrateDarcyToTestGas(ipr, { skin, ...props } = {}) {
  if (ipr.jTest == null)
    throw new Error('calibrateDarcyToTestGas: no Jones/test J on this record — calibrate from a production test first');
  const base = { ...(ipr.darcy ?? {}), ...props, skin: skin ?? ipr.darcy?.skin ?? 0 };
  for (const k of ['thicknessFt', 'viscCp', 'z', 'tresF', 'reFt', 'rwFt']) {
    if (base[k] == null) throw new Error(`calibrateDarcyToTestGas: missing darcy property ${k}`);
  }
  const matchedPermMd = permFromJGas({ j: ipr.jTest, ...base });
  const darcy = { ...base, permMd: matchedPermMd };
  const jD = jDarcyGas(darcy);
  return { ipr: { ...ipr, jDarcy: jD, jSource: 'darcy', j: jD, darcy }, matchedPermMd };
}

/** Gas Darcy PI (slide 3): J = 703e-6*K*H/(mu*Z*(Tres+460)*(ln(0.472*Re/Rw)+S)). */
export function jDarcyGas({ permMd, thicknessFt, viscCp, z, tresF, reFt, rwFt, skin = 0 }) {
  return (
    (703 * 1e-6 * permMd * thicknessFt) /
    viscCp / z / (tresF + 460) / (Math.log((0.472 * reFt) / rwFt) + skin)
  );
}

/** Permeability that makes the gas Darcy J equal a target J (matching). */
export function permFromJGas({ j, thicknessFt, viscCp, z, tresF, reFt, rwFt, skin = 0 }) {
  return (
    (j * viscCp * z * (tresF + 460) * (Math.log((0.472 * reFt) / rwFt) + skin)) /
    (703e-6 * thicknessFt)
  );
}

/** Skin that makes the gas Darcy J equal a target J at fixed permeability. */
export function skinFromJGas({ j, permMd, thicknessFt, viscCp, z, tresF, reFt, rwFt }) {
  return (
    (703e-6 * permMd * thicknessFt) / (viscCp * z * (tresF + 460) * j) -
    Math.log((0.472 * reFt) / rwFt)
  );
}

/** J from the INITIAL test point — squared-pressure form (deck slide 5
 *  inverted): J = 1000*q/(Pri^2 - Pwf^2), Mscf/d/psi^2. */
export function jFromTestGas({ qMMscfd, pwfPsi, priPsi }) {
  return (1000 * qMMscfd) / (priPsi ** 2 - pwfPsi ** 2);
}

export function qGasAtPwfJ(pwfPsi, { j, prPsi }) {
  return (j * (prPsi ** 2 - pwfPsi ** 2)) / 1000;
}

export function pwfAtQGasJ(qMMscfd, { j, prPsi }) {
  return Math.sqrt(Math.max(prPsi ** 2 - (1000 * qMMscfd) / j, 0));
}

/** Pr from a test point with calibrated J (gas Solver macro / slide 5):
 *  Pr = sqrt(1000*q/J + Pwf^2). */
export function prFromTestGasJ({ qMMscfd, pwfPsi, j }) {
  return Math.sqrt((1000 * qMMscfd) / j + pwfPsi ** 2);
}

export function aofGasJ(ipr) {
  return qGasAtPwfJ(0, ipr);
}

/**
 * Fit C & n from the INITIAL multi-rate test ('VLP-IPR'!A10:E13, B15:B17;
 * the deck's "Pri2-FBHP2" columns — anchored at Pri):
 * n = SLOPE(log10 q, log10(Pri^2 - Pwf^2)); Qmax from the regression line
 * evaluated at log10(Pri^2) (the TREND call); C = 10^(log10 Qmax - 2n log10 Pri).
 * points: [{ qMMscfd, pwfPsi }]. Returns { c, n, qMaxMMscfd }.
 */
export function fitCn(points, priPsi) {
  const xs = points.map((p) => Math.log10(priPsi ** 2 - p.pwfPsi ** 2));
  const ys = points.map((p) => Math.log10(p.qMMscfd));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const n = num / den; // SLOPE
  const intercept = my - n * mx;
  const qMaxMMscfd = 10 ** (intercept + n * Math.log10(priPsi ** 2)); // TREND at AOF
  const c = 10 ** (Math.log10(qMaxMMscfd) - 2 * n * Math.log10(priPsi));
  return { c, n, qMaxMMscfd };
}

export function qGasAtPwfCn(pwfPsi, { c, n, prPsi }) {
  return c * (prPsi ** 2 - pwfPsi ** 2) ** n;
}

export function pwfAtQGasCn(qMMscfd, { c, n, prPsi }) {
  return Math.sqrt(Math.max(prPsi ** 2 - (qMMscfd / c) ** (1 / n), 0));
}

/** Pr from a test point with calibrated C&n (slide 5). */
export function prFromTestGasCn({ qMMscfd, pwfPsi, c, n }) {
  return Math.sqrt((qMMscfd / c) ** (1 / n) + pwfPsi ** 2);
}

/** IPR curve on the workbook grid ('VLP-IPR'!D16:E27 gas): Pr times
 *  [1, 0.9, 0.8, ..., 0.1, 0]. model: {j, prPsi} or {c, n, prPsi}. */
export function gasIprCurve(model) {
  const qAt = model.c != null ? (p) => qGasAtPwfCn(p, model) : (p) => qGasAtPwfJ(p, model);
  return [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0].map((f) => ({
    pwfPsi: model.prPsi * f,
    qMMscfd: qAt(model.prPsi * f),
  }));
}
