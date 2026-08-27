// Sensitivity engine — the VLP_Sens macro and the IPR-sensitivity blocks.
//
// VLP sensitivities: named parameter sets (tubing ID, THP, GOR/CGR, WC/WGR,
// gas-lift injection rate, ESP settings...) merged over a base march config,
// one VLP curve per set ('VLP-IPR' N4:S7 / gas I39:K48 blocks).
//
// Oil IPR sensitivities (workbook B51:F58): future reservoir pressures
// Pres1..3 (default 0.75/0.5/0.25 x current Pr) with the FUTURE J recomputed
// through the DARCY equation using future mu and Bo — J_21..J_23. Workbook
// quirks preserved: the Beggs-Robinson A/B viscosity factors stay at the
// CURRENT-Pr Rs (so saturated future viscosity is constant), and only the
// undersaturated (Pres/Pb)^m correction varies above Pb.
//
// Gas IPR sensitivities: curves at future Pr with C&n (or J) frozen.

import { oilMarch } from '../vlp/oil-march.js';
import { gasMarch } from '../vlp/gas-march.js';
import { oilRateGrid, gasRateGrid } from './nodal.js';
import {
  deadOilViscosityCp,
  beggsRobinsonA,
  beggsRobinsonB,
  vasquezBeggsM,
  solutionGorScfStb,
  oilFvf,
} from '../pvt/oil.js';
import { jDarcyOil, iprCurve, withCurrentPr } from '../ipr/oil-ipr.js';
import { gasIprCurve } from '../ipr/gas-ipr.js';

/** Merge overrides over a base march config, deep-merging the lift blocks. */
export function mergeCfg(base, overrides) {
  const out = { ...base, ...overrides };
  if (base.gasLift || overrides.gasLift) out.gasLift = { ...base.gasLift, ...overrides.gasLift };
  if (base.esp || overrides.esp) out.esp = { ...base.esp, ...overrides.esp };
  return out;
}

/** One VLP curve per parameter set (oil family: natural / gas lift / ESP).
 *  sets: [{ label?, overrides }]. rates defaults to the workbook grid. */
export function vlpSensitivityOil(baseCfg, sets, { rates } = {}) {
  const grid = rates ?? oilRateGrid(50, 10000);
  return sets.map((s, i) => ({
    label: s.label ?? `VLP${i + 1}`,
    overrides: s.overrides,
    curve: grid.map((q) => ({
      q,
      pwfPsi: oilMarch(mergeCfg(baseCfg, { ...s.overrides, qOilStbD: q })).pwfPsi,
    })),
  }));
}

/** Gas VLP sensitivity families (gas 'VLP-IPR' I39:K48 sets). */
export function vlpSensitivityGas(baseCfg, sets, { rates } = {}) {
  const grid = rates ?? gasRateGrid(0.1, 25);
  return sets.map((s, i) => ({
    label: s.label ?? `VLP${i + 1}`,
    overrides: s.overrides,
    curve: grid.map((q) => ({
      q,
      pwfPsi: gasMarch(mergeCfg(baseCfg, { ...s.overrides, qGasMMscfd: q })).pwfPsi,
    })),
  }));
}

/**
 * Future oil J at a reservoir pressure (workbook B55:F58 chain):
 * Rs(Pres), Bo(Pres), mu(Pres) with A/B at the CURRENT-Pr Rs, then the
 * Darcy J with the record's K/H/Re/Rw/skin and the future mu*Bo.
 * pvt: { pbPsi, rsiScfStb, gasSg, api, tempF }. darcy: the stored record.
 */
export function futureOilJ(presPsi, { darcy, pvt, rsCurScfStb }) {
  const rs = solutionGorScfStb(presPsi, pvt);
  const bo = oilFvf(presPsi, pvt);
  const muOd = deadOilViscosityCp({ api: pvt.api, tempF: pvt.tempF });
  const muSat = beggsRobinsonA(rsCurScfStb) * muOd ** beggsRobinsonB(rsCurScfStb);
  const mu =
    presPsi > pvt.pbPsi ? muSat * (presPsi / pvt.pbPsi) ** vasquezBeggsM(presPsi) : muSat;
  return { j: jDarcyOil({ ...darcy, viscCp: mu, bo }), rs, bo, mu };
}

/**
 * Oil IPR sensitivity family: future IPR records + curves at each Pres,
 * with the future Darcy J (J_21..J_2n). Needs the Darcy record on the IPR
 * (the program's dominant J — K/H/Re/Rw/skin drive the future J).
 * presList defaults to the workbook's 0.75/0.5/0.25 x current Pr.
 */
export function oilIprSensitivity(ipr, pvt, { presList, wcPct = 0 } = {}) {
  if (!ipr.darcy)
    throw new Error(
      'oilIprSensitivity: the IPR needs its Darcy record (K/H/Re/Rw/skin) — future J is recomputed through Darcy with future mu*Bo (workbook J_21..J_23)'
    );
  const list = presList ?? [0.75, 0.5, 0.25].map((f) => ipr.prPsi * f);
  const rsCur = solutionGorScfStb(ipr.prPsi, pvt);
  return list.map((presPsi, i) => {
    const f = futureOilJ(presPsi, { darcy: ipr.darcy, pvt, rsCurScfStb: rsCur });
    const rec = { ...withCurrentPr(ipr, presPsi), jDarcy: f.j, jSource: 'darcy', j: f.j };
    return {
      label: `Pres${i + 1}=${Math.round(presPsi)} psi`,
      presPsi,
      j: f.j,
      rs: f.rs,
      bo: f.bo,
      mu: f.mu,
      ipr: rec,
      curve: iprCurve(rec, { wcPct }),
    };
  });
}

/** Gas IPR sensitivity family: curves at future Pr, C&n (or J) frozen. */
export function gasIprSensitivity(ipr, { presList } = {}) {
  const list = presList ?? [0.75, 0.5, 0.25].map((f) => ipr.prPsi * f);
  return list.map((presPsi, i) => {
    const rec = withCurrentPr(ipr, presPsi);
    return { label: `Pres${i + 1}=${Math.round(presPsi)} psi`, presPsi, ipr: rec, curve: gasIprCurve(rec) };
  });
}
