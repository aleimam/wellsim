// Gas PVT correlations — verbatim port of the El-Ashry Excel toolset.
//
// Two pseudo-critical routes exist in the workbooks:
//  - Oil well models (BHP!X1:X2): Tpc = 169+314*gg, Ppc = 708.75-57.7*gg
//    (the sheet label says 57.5 but the formula uses 57.7 — formula wins).
//  - Gas well model ('VLP-IPR'/BHP Y9:Y16): hydrocarbon-gravity method with
//    N2/CO2/H2S corrections, Kay mixing and the Wichert-Aziz adjustment.
// Z-factor: the explicit Brill & Beggs fit is the project's ONLY Z model
// (decision 2026-08-27). The oil workbooks GoalSeek Hall-Yarborough instead —
// often unconverged (station residuals up to ~20% of the equation scale at
// depth), and Brill & Beggs tracks the CONVERGED H-Y within ~0.3% over the
// working range, so the explicit form replaces it everywhere.
// Gas viscosity is Carr-Kobayashi-Burrows base with the Dempsey polynomial
// (BHP!V3:V19; V9 unused).

import { KGM3_PER_LBFT3 } from './constants.js';

/** Oil-model pseudo-criticals (BHP!X1:X2). Returns degR / psia. */
export function pseudoCriticalsSweet(gasSg) {
  return { tpc: 169 + 314 * gasSg, ppc: 708.75 - 57.7 * gasSg };
}

/**
 * Gas-model pseudo-criticals with inorganic corrections (BHP!Y8:Y16).
 * Fractions (not percents) for n2, co2, h2s.
 * Returns { ghc, tchc, pchc, tcmix, pcmix, eps, tpc, ppc, ghcValid }.
 */
export function pseudoCriticalsSour({ gasSg, n2 = 0, co2 = 0, h2s = 0 }) {
  const inert = n2 + co2 + h2s;
  const ghc = (gasSg - 0.9672 * n2 - 1.5195 * co2 - 1.1762 * h2s) / (1 - inert);
  const tchc = 187 + 330 * ghc - 71.5 * ghc * ghc;
  const pchc = 706 + 51.7 * ghc - 11.1 * ghc * ghc;
  const tcmix = (1 - inert) * tchc + 227.3 * n2 + 547.6 * co2 + 672.4 * h2s;
  const pcmix = (1 - inert) * pchc + 493 * n2 + 1071 * co2 + 1306 * h2s;
  const eps =
    120 * ((co2 + h2s) ** 0.9 - (co2 + h2s) ** 1.6) + 15 * (h2s ** 0.5 - h2s ** 4);
  const tpc = tcmix - eps;
  const ppc = (pcmix * tpc) / (tcmix + h2s * (1 - h2s) * eps);
  return { ghc, tchc, pchc, tcmix, pcmix, eps, tpc, ppc, ghcValid: ghc >= 0.56 && ghc <= 1.3 };
}

/** Brill & Beggs explicit Z-factor (gas model BHP!W:AA columns). */
export function zFactorBrillBeggs(ppr, tpr) {
  const a = 1.39 * (tpr - 0.92) ** 0.5 - 0.36 * tpr - 0.101;
  const b =
    (0.62 - 0.23 * tpr) * ppr +
    (0.066 / (tpr - 0.86) - 0.037) * ppr * ppr +
    (0.32 / 10 ** (9 * (tpr - 1))) * ppr ** 6;
  const c = 0.132 - 0.32 * Math.log10(tpr);
  const d = 10 ** (0.3106 - 0.49 * tpr + 0.1824 * tpr * tpr);
  return { a, b, c, d, z: a + (1 - a) / Math.exp(b) + c * ppr ** d };
}

// Dempsey polynomial coefficients, BHP!V3:V19 (V9 is unused on the sheet).
const DEMPSEY = {
  a0: -2.462,
  a1: 2.97,
  a2: -2.862 / 10,
  a3: 8.054 / 1000,
  a4: 2.808,
  a5: -3.498,
  a6: 3.603 / 10,
  a7: -1.044 / 100,
  a8: -7.933 / 10,
  a9: 1.396,
  a10: -1.491 / 10,
  a11: 4.41 / 1000,
  a12: 8.393 / 100,
  a13: -1.864 / 10,
  a14: 2.033 / 100,
  a15: -6.095 / 10000,
};

/** Carr-Kobayashi-Burrows atmospheric base viscosity, cp (BHP!R column). */
export function gasViscosityBaseCp(gasSg, tempF) {
  return (
    (1.709 / 100000 - (2.062 / 1000000) * gasSg) * tempF +
    8.188 / 1000 -
    (6.15 / 1000) * Math.log10(gasSg)
  );
}

/** Dempsey ln(mu_g/mu_1 * Tpr) polynomial (BHP!Q column). */
export function dempseyLnRatio(ppr, tpr) {
  const k = DEMPSEY;
  return (
    k.a0 +
    k.a1 * ppr +
    k.a2 * ppr ** 2 +
    k.a3 * ppr ** 3 +
    tpr * (k.a4 + k.a5 * ppr + k.a6 * ppr ** 2 + k.a7 * ppr ** 3) +
    tpr ** 2 * (k.a8 + k.a9 * ppr + k.a10 * ppr ** 2 + k.a11 * ppr ** 3) +
    tpr ** 3 * (k.a12 + k.a13 * ppr + k.a14 * ppr ** 2 + k.a15 * ppr ** 3)
  );
}

/** Gas viscosity, cp (BHP!S column): mu = base/Tpr * exp(poly). */
export function gasViscosityCp(gasSg, tempF, ppr, tpr) {
  return (gasViscosityBaseCp(gasSg, tempF) / tpr) * Math.exp(dempseyLnRatio(ppr, tpr));
}

/** Gas density, lbm/ft3 (BHP!AB column): 28.97*gg*P/(Z*10.73*(T+460)). */
export function gasDensityLbft3(gasSg, pPsi, tempF, z) {
  return (28.97 * gasSg * pPsi) / z / 10.73 / (460 + tempF);
}

/** Excel's "b" gas expansion factor (BHP!AC column): 0.0283*Z*(T+460)/(P+14.5). */
export function bgFactor(z, tempF, pPsi) {
  return (0.0283 * z * (tempF + 460)) / (pPsi + 14.5);
}

/** Bg in bbl/scf as the reserve sheets use it (bgFactor / 5.615). */
export function bgBblPerScf(z, tempF, pPsi) {
  return bgFactor(z, tempF, pPsi) / 5.615;
}

/**
 * Field-convention composition input, matching the gas workbook exactly
 * ('VLP-IPR'!B5:B7: N2 in %, CO2 in %, H2S in ppm). Returns mole fractions
 * for the core functions.
 */
export function compositionFromField({ n2Pct = 0, co2Pct = 0, h2sPpm = 0 } = {}) {
  return { n2: n2Pct / 100, co2: co2Pct / 100, h2s: h2sPpm / 1e6 };
}

/**
 * Unified pseudo-criticals with impurities as inputs.
 * method:
 *  - 'sweet': oil-model correlation (169+314*gg / 708.75-57.7*gg) — ignores
 *    composition, as the oil workbooks do;
 *  - 'sour': gas-model hydrocarbon-gravity route with Kay mixing and
 *    Wichert-Aziz (valid with zero impurities too — it is a different
 *    correlation, not a corrected 'sweet');
 *  - 'auto' (default): 'sour' when any impurity is present, else 'sweet'.
 */
export function gasPseudoCriticals({ gasSg, n2 = 0, co2 = 0, h2s = 0, method = 'auto' }) {
  const resolved =
    method === 'auto' ? (n2 > 0 || co2 > 0 || h2s > 0 ? 'sour' : 'sweet') : method;
  if (resolved === 'sweet') return { ...pseudoCriticalsSweet(gasSg), method: resolved };
  if (resolved === 'sour')
    return { ...pseudoCriticalsSour({ gasSg, n2, co2, h2s }), method: resolved };
  throw new Error(`unknown pseudo-critical method: ${method}`);
}

/**
 * Full gas-property evaluation at (P, T) with composition as input.
 * gas: { gasSg, n2, co2, h2s, method } (fractions; see compositionFromField).
 * Z is the explicit Brill & Beggs correlation — the project's single Z model
 * (decision 2026-08-27: no iterative Z anywhere; Hall-Yarborough removed).
 * Returns { tpc, ppc, ppr, tpr, z, viscosityCp, densityLbft3, bg, bgBblPerScf }.
 */
export function gasPvt(gas, pPsi, tempF) {
  const { tpc, ppc } = gasPseudoCriticals(gas);
  const ppr = pPsi / ppc;
  const tpr = (tempF + 460) / tpc;
  const z = zFactorBrillBeggs(ppr, tpr).z;
  return {
    tpc,
    ppc,
    ppr,
    tpr,
    z,
    viscosityCp: gasViscosityCp(gas.gasSg, tempF, ppr, tpr),
    densityLbft3: gasDensityLbft3(gas.gasSg, pPsi, tempF, z),
    bg: bgFactor(z, tempF, pPsi),
    bgBblPerScf: bgBblPerScf(z, tempF, pPsi),
  };
}

/**
 * Standard-conditions gas density in kg/m3 — Excel named range `rouhgsc`
 * (BHP rows 91-92 evaluate it at 14.5 psia / 60 degF; the workbook's stored
 * value is off ~8% from a GoalSeek that quit early at near-atmospheric
 * pressure). Computed here with the project's single explicit Z (Brill &
 * Beggs, Z ~ 0.997 at these conditions). Accepts composition so impurities
 * propagate when the sour route is selected.
 */
export function gasDensityScKgm3(gasSg, { pPsi = 14.5, tempF = 60, n2 = 0, co2 = 0, h2s = 0, method = 'sweet' } = {}) {
  const { tpc, ppc } = gasPseudoCriticals({ gasSg, n2, co2, h2s, method });
  const ppr = pPsi / ppc;
  const tpr = (tempF + 460) / tpc;
  const { z } = zFactorBrillBeggs(ppr, tpr);
  return gasDensityLbft3(gasSg, pPsi, tempF, z) * KGM3_PER_LBFT3;
}
