// Oil IPR — composite Vogel/Jones exactly as the workbooks and training
// decks define it ('VLP-IPR' B16/F-column, "3. Oil Productivity Index J" and
// "2. Oil IPR" decks). All rates here are GROSS liquid (stb/d); the sheets
// convert with Qoil = Qgross * (1 - WC/100).
//
// ipr record: { jTest, jDarcy, jSource, j, priPsi, prPsi, pbPsi } — TWO
// pressure records AND TWO J records, mirroring the workbook:
//   priPsi — INITIAL reservoir pressure ("Pri" / "Pres at test"): the
//            calibration anchor — set once, never overwritten.
//   prPsi  — CURRENT reservoir pressure ("Pr" := 'VLP-IPR'!B3): what the
//            IPR is evaluated at; the Pres solver and sensitivities update
//            THIS one (withCurrentPr), never priPsi.
//   jTest  — Jones general-equation J from the initial test ('VLP-IPR'!B16,
//            "IPR from Vogel" section).
//   jDarcy — Darcy J from reservoir properties ("IPR from Darcy" section /
//            J_2 — the workbook's analysis J; slide-8 workflow tunes K or
//            skin until it matches the test).
//   jSource ('darcy' default when jDarcy exists, 'jones' selectable) picks
//            which record is ACTIVE; `j` always holds the active value so
//            every evaluator reads ipr.j unchanged.

/**
 * Build the IPR record. THE DARCY J IS THE PROGRAM'S DEFAULT AND DOMINANT J
 * (workbook: "Darcy model is used for oil") — define it either directly
 * (jDarcy) or, preferably, from reservoir properties via
 * darcy: { permMd, thicknessFt, viscCp, bo, reFt, rwFt, skin } (stored on
 * the record so calibrateDarcyToTest can re-match K later). The Jones/test
 * record (jTest; legacy { j } maps here) is OPTIONAL — used to calibrate
 * Darcy once a production test exists, and selectable via
 * withJSource(ipr, 'jones') if desired.
 */
export function createOilIpr({ jTest, jDarcy, jSource, j, darcy, priPsi, pbPsi, prPsi }) {
  const jt = jTest ?? j;
  const jd = jDarcy ?? (darcy ? jDarcyOil(darcy) : undefined);
  const src = jSource ?? (jd != null ? 'darcy' : 'jones');
  const active = src === 'darcy' ? jd : jt;
  if (active == null)
    throw new Error(`createOilIpr: jSource '${src}' selected but that J record is missing`);
  return { jTest: jt, jDarcy: jd, jSource: src, j: active, darcy, priPsi, pbPsi, prPsi: prPsi ?? priPsi };
}

/** Switch the active J between the Darcy and Jones/test records. */
export function withJSource(ipr, jSource) {
  const active = jSource === 'darcy' ? ipr.jDarcy : ipr.jTest;
  if (active == null)
    throw new Error(`withJSource: J record '${jSource}' is missing on this IPR`);
  return { ...ipr, jSource, j: active };
}

/** New record with the current Pr updated — the calibration record priPsi
 *  (and the frozen J records) are preserved. */
export function withCurrentPr(ipr, prPsi) {
  return { ...ipr, prPsi };
}

/** Reset the working pressure back to the initial record. */
export function resetToInitialPr(ipr) {
  return { ...ipr, prPsi: ipr.priPsi };
}

/** Productivity index from the INITIAL test point — the "general equation"
 *  ('VLP-IPR'!B16, deck formula IF(BHP<=Pb, IF(Pri<Pb, ...))): anchored at
 *  Pri, the initial reservoir pressure. */
export function jFromTest({ qGrossStbD, pwfPsi, priPsi, pbPsi }) {
  if (pwfPsi <= pbPsi) {
    if (priPsi < pbPsi) {
      return (
        qGrossStbD /
        ((priPsi / 1.8) * (1 - 0.2 * (pwfPsi / priPsi) - 0.8 * (pwfPsi / priPsi) ** 2))
      );
    }
    return (
      qGrossStbD /
      (priPsi - pbPsi +
        (pbPsi / 1.8) * (1 - 0.2 * (pwfPsi / pbPsi) - 0.8 * (pwfPsi / pbPsi) ** 2))
    );
  }
  return qGrossStbD / (priPsi - pwfPsi);
}

/** Darcy pseudo-steady-state PI ("3. Oil Productivity Index J" deck):
 *  J = 0.00708*K*H / (mu*Bo*(ln(Re/Rw) - 0.75 + S)), bbl/d/psi. */
export function jDarcyOil({ permMd, thicknessFt, viscCp, bo, reFt, rwFt, skin = 0 }) {
  return (
    (0.00708 * permMd * thicknessFt) /
    viscCp / bo / (Math.log(reFt / rwFt) - 0.75 + skin)
  );
}

/** Slide-8 matching workflow, closed form: the permeability that makes the
 *  Darcy J equal a target J (usually the Jones/test J). */
export function permFromJOil({ j, thicknessFt, viscCp, bo, reFt, rwFt, skin = 0 }) {
  return (j * viscCp * bo * (Math.log(reFt / rwFt) - 0.75 + skin)) / (0.00708 * thicknessFt);
}

/** Slide-8 matching workflow, closed form: the skin that makes the Darcy J
 *  equal a target J at a fixed permeability. */
export function skinFromJOil({ j, permMd, thicknessFt, viscCp, bo, reFt, rwFt }) {
  return (0.00708 * permMd * thicknessFt) / (viscCp * bo * j) - Math.log(reFt / rwFt) + 0.75;
}

/**
 * The "calibrate Darcy" action — purpose: recover the ACTUAL MATCHED K.
 * Once a production test has given the Jones J (ipr.jTest):
 *  1. the USER DEFINES SKIN by best judgment from the drilling/completion/
 *     perforation method (see skin-guidance.js for reference ranges);
 *  2. the remaining unknown — the actual reservoir permeability — is
 *     solved so the Darcy J best-matches the Jones J (closed form; K is
 *     linear in J at fixed skin, exact in one shot, no iteration).
 * Darcy properties come from `props` merged over any darcy block already
 * stored on the record. Returns { ipr, matchedPermMd } — matchedPermMd IS
 * the actual K, conditional on the chosen skin; the record becomes
 * Darcy-sourced (the program's dominant J) with the Jones record kept for QC.
 */
export function calibrateDarcyToTest(ipr, { skin, ...props } = {}) {
  if (ipr.jTest == null)
    throw new Error('calibrateDarcyToTest: no Jones/test J on this record — calibrate from a production test first');
  const base = { ...(ipr.darcy ?? {}), ...props, skin: skin ?? ipr.darcy?.skin ?? 0 };
  for (const k of ['thicknessFt', 'viscCp', 'bo', 'reFt', 'rwFt']) {
    if (base[k] == null) throw new Error(`calibrateDarcyToTest: missing darcy property ${k}`);
  }
  const matchedPermMd = permFromJOil({ j: ipr.jTest, ...base });
  const darcy = { ...base, permMd: matchedPermMd };
  const jD = jDarcyOil(darcy); // equals jTest by construction
  return {
    ipr: { ...ipr, jDarcy: jD, jSource: 'darcy', j: jD, darcy },
    matchedPermMd,
  };
}

/** Gross rate at Pwf — composite Vogel ('VLP-IPR' F-column / slide 3). */
export function qGrossAtPwf(pwfPsi, { j, prPsi, pbPsi }) {
  if (prPsi >= pbPsi) {
    if (pwfPsi >= pbPsi) return j * (prPsi - pwfPsi);
    return (
      j * (prPsi - pbPsi) +
      ((j * pbPsi) / 1.8) * (1 - 0.2 * (pwfPsi / pbPsi) - 0.8 * (pwfPsi / pbPsi) ** 2)
    );
  }
  return ((j * prPsi) / 1.8) * (1 - 0.2 * (pwfPsi / prPsi) - 0.8 * (pwfPsi / prPsi) ** 2);
}

/** Absolute open flow, gross stb/d ('VLP-IPR'!B15 = F27). */
export function qMaxGross(ipr) {
  return qGrossAtPwf(0, ipr);
}

/** Pwf at a gross rate — closed-form inverse of the composite Vogel. Rates
 *  at/above AOF return 0. */
export function pwfAtQGross(qGrossStbD, { j, prPsi, pbPsi }) {
  const base = Math.min(prPsi, pbPsi); // Vogel curvature base
  const qb = prPsi >= pbPsi ? j * (prPsi - pbPsi) : 0;
  if (prPsi >= pbPsi && qGrossStbD <= qb) return prPsi - qGrossStbD / j;
  const k = (1.8 * (qGrossStbD - qb)) / (j * base);
  const disc = 0.04 + 3.2 * (1 - k);
  if (disc <= 0) return 0;
  const x = (-0.2 + Math.sqrt(disc)) / 1.6;
  return Math.max(0, x) * base;
}

/**
 * NEW current reservoir pressure back-calculated from a later test point
 * with the FROZEN calibrated J (prod_data column G / "3. Oil Productivity
 * Index J" slide 5). Store the result with withCurrentPr(ipr, result) —
 * priPsi stays as the calibration record. Branches are resolved
 * deterministically — the workbook's 5 fixed-point passes exist only to
 * settle the IF(Pr>Pb) branch selection.
 */
export function prFromTest({ qGrossStbD, pwfPsi, j, pbPsi }) {
  if (pwfPsi >= pbPsi) return qGrossStbD / j + pwfPsi; // undersaturated test
  // pwf < pb: try the mixed branch (Pr above Pb, Pwf below)
  const mixed =
    (qGrossStbD -
      ((j * pbPsi) / 1.8) *
        (1 - 0.2 * (pwfPsi / pbPsi) - 0.8 * (pwfPsi / pbPsi) ** 2)) /
      j +
    pbPsi;
  if (mixed > pbPsi) return mixed;
  // fully saturated: positive root of Pr^2 - (0.2*Pwf + 1.8*q/J)*Pr - 0.8*Pwf^2 = 0
  const bTerm = 0.2 * pwfPsi + (1.8 * qGrossStbD) / j;
  const disc = bTerm * bTerm + 3.2 * pwfPsi * pwfPsi;
  if (disc < 0) return 0; // Excel guard; cannot occur for real inputs
  return (bTerm + Math.sqrt(disc)) / 2;
}

/**
 * IPR curve on the workbook's pressure grid ('VLP-IPR'!D16:F27): Pr, then
 * min(Pr,Pb) times [1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1], then 0.
 * wcPct (optional) adds the oil-rate column (E-col).
 */
export function iprCurve(ipr, { wcPct = 0 } = {}) {
  const base = Math.min(ipr.prPsi, ipr.pbPsi);
  // pb <= 0 (water well: pure linear IPR) — fan the grid over Pr instead of
  // collapsing every workbook point onto zero
  const grid =
    base > 0
      ? [ipr.prPsi, ...[1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1].map((f) => base * f), 0]
      : [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0].map((f) => ipr.prPsi * f);
  return grid.map((pwf) => {
    const qGross = qGrossAtPwf(pwf, ipr);
    return { pwfPsi: pwf, qGrossStbD: qGross, qOilStbD: qGross * (1 - wcPct / 100) };
  });
}
