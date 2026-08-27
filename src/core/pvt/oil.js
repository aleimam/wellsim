// Oil PVT correlations — verbatim port of the El-Ashry Excel toolset
// (Oil well model V3.1.7, 'VLP-IPR' B2:B14 and BHP sheet AF/AJ/AK columns).
//
// The Pb/Rs pair is a Standing-type correlation written in metric units
// (Rs in m3/m3, T in degC, oil density in kg/m3) with the author's
// calibration constant folded into the psi conversion. Bo is Standing's
// metric form with exp(co*dP) above bubble point, co = 3e-6 1/psi.
// Dead-oil viscosity is Glaso; live is Beggs-Robinson; the undersaturated
// exponent m is Vasquez-Beggs.
//
// All pressures here are handed through exactly as the sheets do (the
// workbooks feed gauge pressures without converting to absolute).

import {
  SCF_TO_M3,
  BBL_TO_M3,
  WATER_DENSITY_KGM3,
  LBFT3_PER_KGM3,
  PSI_TO_PA,
  scfStbToM3M3,
} from './constants.js';

const PB_CALIBRATION = 2.1045604254721; // 'VLP-IPR'!B2 trailing factor

/** gamma_o = 141.5/(131.5+API)  ('VLP-IPR'!E11) */
export function oilSpecificGravity(api) {
  return 141.5 / (131.5 + api);
}

/** Stock-tank oil density in kg/m3  ('VLP-IPR'!E12) */
export function oilDensityScKgm3(api) {
  return oilSpecificGravity(api) * WATER_DENSITY_KGM3;
}

/** degF -> degC as the sheet does  ('VLP-IPR'!E13) */
export function fahrenheitToCelsius(tempF) {
  return ((tempF - 32) * 5) / 9;
}

/**
 * Bubble point pressure, psi  ('VLP-IPR'!B2).
 * @param {{rsiScfStb:number, gasSg:number, api:number, tempF:number}} p
 */
export function bubblePointPsi({ rsiScfStb, gasSg, api, tempF }) {
  const rsi = scfStbToM3M3(rsiScfStb);
  const tC = fahrenheitToCelsius(tempF);
  const rhoO = oilDensityScKgm3(api);
  return (
    ((125 *
      ((582 * rsi / gasSg) ** 0.83 * 10 ** (0.00164 * tC - 1768 / rhoO) - 1.4)) /
      14.5) *
    PB_CALIBRATION
  );
}

/**
 * Solution GOR at pressure, scf/stb  (BHP!AF column / 'VLP-IPR'!E14).
 * Above (or at) Pb returns Rsi; below Pb inverts the Pb correlation.
 */
export function solutionGorScfStb(pPsi, { pbPsi, rsiScfStb, gasSg, api, tempF }) {
  if (pPsi >= pbPsi) return rsiScfStb;
  const tC = fahrenheitToCelsius(tempF);
  const rhoO = oilDensityScKgm3(api);
  const rsM3 =
    (gasSg / 582) *
    ((8e-6 * (pPsi * PSI_TO_PA) + 1.4) * 10 ** (1768 / rhoO - 0.00164 * tC)) **
      (1 / 0.83);
  return (rsM3 / SCF_TO_M3) * BBL_TO_M3;
}

/**
 * Saturated-oil FVF at a given Rs, bbl/stb (the Standing-metric core of
 * BHP!AJ column: 0.9759 + 12e-5*(177*Rs_m3m3*sqrt(gg/rho_o) + 2.25*Tc + 40)^1.2).
 */
export function oilFvfSaturated(rsScfStb, { gasSg, api, tempF }) {
  const rsM3 = scfStbToM3M3(rsScfStb);
  const tC = fahrenheitToCelsius(tempF);
  const rhoO = oilDensityScKgm3(api);
  return (
    0.9759 +
    12 * 0.00001 * (177 * rsM3 * Math.sqrt(gasSg / rhoO) + 2.25 * tC + 40) ** 1.2
  );
}

/**
 * Oil FVF at pressure, bbl/stb  (BHP!AJ column).
 * Above Pb: Bo = Bob * exp(3e-6*(Pb - P)); below Pb: saturated at Rs(P).
 */
export function oilFvf(pPsi, params) {
  const rs = solutionGorScfStb(pPsi, params);
  const bo = oilFvfSaturated(rs, params);
  return pPsi >= params.pbPsi ? Math.exp(0.000003 * (params.pbPsi - pPsi)) * bo : bo;
}

/**
 * Live oil density, lbm/ft3  (BHP!AK column).
 * Below/at Pb: (rho_o_sc + 0.1781*Rs*rho_g_sc)/Bo, converted kg/m3 -> lbm/ft3.
 * Above Pb: density at Pb compressed by exp(3e-6*(P - Pb)).
 *
 * rhoGscKgm3 is the standard-conditions gas density in kg/m3 (Excel named
 * range `rouhgsc`, computed on the BHP sheet at 14.5 psia / 60 degF). The
 * workbook's stored value (0.9387 for gg=0.842) carries a GoalSeek
 * convergence artifact; pass gasDensityScKgm3() from gas.js for the
 * converged value, or the workbook's number to reproduce it bit-for-bit.
 */
export function oilDensityLbft3(pPsi, params) {
  const { pbPsi, rsiScfStb, rhoGscKgm3 } = params;
  const rhoO = oilDensityScKgm3(params.api);
  const rsFactor = SCF_TO_M3 / BBL_TO_M3;
  if (pPsi <= pbPsi) {
    const rs = solutionGorScfStb(pPsi, params);
    const bo = oilFvf(pPsi, params);
    return ((rhoO + rsFactor * rs * rhoGscKgm3) / bo) * LBFT3_PER_KGM3;
  }
  const bob = oilFvfSaturated(rsiScfStb, params); // BHP!AJ19 (exp term = 1 at Pb)
  const rhoObpKgm3 = (rhoO + rsFactor * rsiScfStb * rhoGscKgm3) / bob; // BHP!AK19
  return rhoObpKgm3 * Math.exp(0.000003 * (pPsi - pbPsi)) * LBFT3_PER_KGM3;
}

/** Dead-oil viscosity, cp — Glaso  ('VLP-IPR'!B9:B10). */
export function deadOilViscosityCp({ api, tempF }) {
  const a1 = 10.313 * Math.log10(tempF) - 36.447;
  return 3.141 * 10 ** 10 * tempF ** -3.444 * Math.log10(api) ** a1;
}

/** Beggs-Robinson live-oil multipliers  ('VLP-IPR'!B11, B13). */
export function beggsRobinsonA(rsScfStb) {
  return 10.715 * (rsScfStb + 100) ** -0.515;
}
export function beggsRobinsonB(rsScfStb) {
  return 5.44 * (rsScfStb + 150) ** -0.338;
}

/** Vasquez-Beggs undersaturated viscosity exponent  ('VLP-IPR'!B12, B14). */
export function vasquezBeggsM(pPsi) {
  const a3 = -3.9 * 10 ** -5 * pPsi - 5;
  return 2.6 * pPsi ** 1.187 * 10 ** a3;
}

/**
 * Live oil viscosity at pressure, cp.
 * Saturated (P <= Pb): mu = A(Rs)*mu_od^B(Rs)  (Beggs-Robinson).
 * Undersaturated: mu_ob * (P/Pb)^m(P)          (Vasquez-Beggs).
 */
export function oilViscosityCp(pPsi, params) {
  const muOd = deadOilViscosityCp(params);
  const muAt = (rs) => beggsRobinsonA(rs) * muOd ** beggsRobinsonB(rs);
  if (pPsi <= params.pbPsi) return muAt(solutionGorScfStb(pPsi, params));
  const muOb = muAt(params.rsiScfStb);
  return muOb * (pPsi / params.pbPsi) ** vasquezBeggsM(pPsi);
}
