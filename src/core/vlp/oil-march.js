// Modified-Griffith oil wellbore march (M.El-Ashry) — verbatim port of the
// BHP sheets of Oil well model Natural/GasLift/ESP.
//
// Structure per station (columns in the Natural workbook):
//  flowing temperature CALCULATED with the gas-march Ramey chain — the
//  project's only oil temperature model (decision 2026-08-27; the oil
//  workbooks' input-THT linear profile is retired, WHT is an output);
//  EXPLICIT Brill & Beggs Z, the project's only Z model (the workbook
//  GoalSeeks Hall-Yarborough — often unconverged at depth);
//  Carr-Kobayashi-Burrows + Dempsey gas viscosity with the Tpr of STATION 1
//  anchored in both the polynomial and the divisor (P$22 quirk, oil family
//  only); Vsg from total gas with the 14.7/P(gauge) expansion; Rs/Bo/rho_o
//  from the Standing-metric PVT; Griffith holdup with the 0.38 coefficient;
//  HB mass-rate Reynolds; Chen Fanning friction; head gradient x Ashry factor
//  x user match on dTVD, friction x user match on dAH; explicit Euler.
//
// Lift variants:
//  gasLift: two zones — above the injection depth the gas rate and the
//   Reynolds mass rate include injection gas (P$11/T$17); below they revert
//   to formation gas (P$10/R$17). The FRICTION mass rate stays formation-only
//   in both zones (AQ uses R$17 everywhere) — workbook quirk, preserved.
//  esp: 26 steps to the pump, a zero-length intake node where the pump dP is
//   subtracted (D49 = D48 - dP, floored at 60 psi), then 2 steps to the
//   perfs. ALL zones use the separated tubing gas rate (P$10 built from
//   GLR*(1 - sep%/100)) and its mass rate (P$17) — including below the pump;
//   workbook quirk, preserved. espBackMarch runs the IPR-side branch from
//   Pwf up to the pump with properties evaluated at max(P, 100) psi.

import {
  oilSpecificGravity,
  oilDensityScKgm3,
  solutionGorScfStb,
  oilFvf,
  oilFvfSaturated,
  bubblePointPsi,
} from '../pvt/oil.js';
import {
  gasPseudoCriticals,
  zFactorBrillBeggs,
  gasViscosityBaseCp,
  dempseyLnRatio,
  gasDensityLbft3,
  gasDensityScKgm3,
} from '../pvt/gas.js';
import { SCF_TO_M3, BBL_TO_M3, LBFT3_PER_KGM3 } from '../pvt/constants.js';
import { waterDensityLbft3, liquidViscosityCp } from '../pvt/water.js';
import { buildGrid, ahToTvdM } from './wellpath.js';
import { ashryHeadFactor } from './ashry.js';
import { AIR_LB_PER_SCF, LIQ_LB_PER_FT3, chenFanning, frictionGradient, rameyTemperatures, requireInputs } from './common.js';

/** Rate-basis factor between gross liquid and the march's qOilStbD input:
 *  oil wells are oil-based (1 - WC/100); a water well (fluid:'water') takes
 *  qOilStbD AS the gross water rate, so the factor is 1. */
export function oilFraction(cfg) {
  return cfg.fluid === 'water' ? 1 : 1 - cfg.wcPct / 100;
}

/** Required scalar inputs of every oil march (no defaults — roughness has
 *  none on purpose: the workbooks themselves differ, Natural 0.00006 vs
 *  GasLift 0.0006). Heat inputs are required because the flowing wellhead
 *  temperature is calculated. */
const OIL_REQUIRED = [
  'thpPsi', 'qOilStbD', 'gorScfStb', 'wcPct', 'api', 'gasSg', 'tresF',
  'perfTvdM', 'tubingIdIn', 'roughness', 'oilViscCp', 'rsiScfStb',
  'soilTempF', 'htcBtu', 'tubingOdIn',
];

export function validateOilCfg(cfg) {
  requireInputs(cfg, OIL_REQUIRED, 'oil march');
  // water well (fluid:'water'): the same march at the limit API 10 / w.c.
  // 100% / GOR 0 — qOilStbD is then the WATER (gross liquid) rate and wcPct
  // is ignored (100 by definition)
  if (cfg.fluid !== 'water' && cfg.wcPct >= 100)
    throw new Error('oil march: wcPct must be < 100 (rates are oil-based; use fluid:"water" for a water well)');
  if (cfg.qOilStbD <= 0) throw new Error('oil march: qOilStbD must be > 0');
  if (cfg.gasLift) requireInputs(cfg.gasLift, ['injDepthTvdM'], 'oil march gasLift');
  if (cfg.esp) {
    if (cfg.esp.pumpAhM == null && cfg.esp.pumpTvdM == null)
      throw new Error('oil march esp: missing required input(s): pumpAhM');
    requireInputs(cfg.esp, ['pumpDpPsi'], 'oil march esp');
  }
}

/** Rates, masses and constants derived from the input block (BHP!C5:C16, I/M/P/R rows). */
export function deriveOilFlow(cfg) {
  const water = cfg.fluid === 'water';
  const qo = water ? 0 : cfg.qOilStbD; // water well: no oil phase
  const wc = cfg.wcPct;
  const waterSg = cfg.waterSg ?? 1.05;
  const qw = water ? cfg.qOilStbD : ((qo * wc) / 100) / (1 - wc / 100); // I4
  const qL = qo + qw; // I9
  const yw = water ? 1 : wc / 100;
  const gasFormationScfD = cfg.gorScfStb * qo; // P10 (natural/gas-lift)
  const injScfD = (cfg.gasLift?.injRateMMscfd ?? 0) * 1e6;
  const gasLiftedScfD = gasFormationScfD + injScfD; // P11 (gas lift)
  const gasTubingScfD = cfg.esp?.tubingGasScfD ?? gasFormationScfD; // ESP P10 (separated)
  const liqSg = ((qL - qw) * oilSpecificGravity(cfg.api) + qw * waterSg) / qL; // P15
  const liqMass = liqSg * LIQ_LB_PER_FT3 * qL * 5.615;
  const massFormation = liqMass + AIR_LB_PER_SCF * cfg.gasSg * gasFormationScfD; // R17
  const massLifted = liqMass + AIR_LB_PER_SCF * cfg.gasSg * gasLiftedScfD; // T17
  const massTubing = liqMass + AIR_LB_PER_SCF * cfg.gasSg * gasTubingScfD; // ESP P17
  const areaFt2 = (3.14 / 4) * (cfg.tubingIdIn / 12) ** 2; // P6 (pi = 3.14)
  const vslFtS = (qL * 5.615) / 86400 / areaFt2; // S15
  const muLCp = liquidViscosityCp(cfg.oilViscCp, qL, qw); // R18
  const rhoWLbft3 = waterDensityLbft3(waterSg); // AB12
  return {
    qw, qL, yw, gasFormationScfD, gasLiftedScfD, gasTubingScfD,
    liqSg, massFormation, massLifted, massTubing, areaFt2, vslFtS, muLCp, rhoWLbft3,
  };
}

/** PVT parameter bundle resolved once per march. Gas impurities (n2/co2/h2s
 *  mole fractions) flow into the pseudo-criticals when pcritMethod is 'sour'
 *  or 'auto'; the default 'sweet' matches the workbooks (which ignore
 *  composition in the oil models). */
export function resolveOilPvt(cfg, anchorTempF = cfg.thtF) {
  if (anchorTempF == null)
    throw new Error('resolveOilPvt: anchor temperature required (pass the station-1 temperature, or set cfg.thtF for standalone use)');
  const pbPsi =
    cfg.pbPsi ??
    bubblePointPsi({ rsiScfStb: cfg.rsiScfStb, gasSg: cfg.gasSg, api: cfg.api, tempF: cfg.tresF });
  const rhoGscKgm3 = cfg.rhoGscKgm3 ?? gasDensityScKgm3(cfg.gasSg);
  const { tpc, ppc } = gasPseudoCriticals({
    gasSg: cfg.gasSg,
    n2: cfg.n2 ?? 0,
    co2: cfg.co2 ?? 0,
    h2s: cfg.h2s ?? 0,
    method: cfg.pcritMethod ?? 'sweet',
  });
  const tprAnchor = (anchorTempF + 460) / tpc; // P$22 — station-1 Tpr, oil-family quirk
  return {
    pbPsi, rhoGscKgm3, tpc, ppc, tprAnchor,
    rsiScfStb: cfg.rsiScfStb, gasSg: cfg.gasSg, api: cfg.api, tempF: cfg.tresF,
    rhoOScKgm3: oilDensityScKgm3(cfg.api),
  };
}

/**
 * One station's properties and gradients (BHP row). Pass z explicitly for
 * bit-parity tests against the sheet; omit it and the Z-factor is the
 * project's single explicit Brill & Beggs model (no iteration anywhere).
 */
export function oilStationGradients(
  { pPsi, tF, z = null, gasScfD, massNreLbDay, massFricLbDay },
  cfg,
  flow,
  pvt
) {
  const warnings = [];
  const ppr = pPsi / pvt.ppc;
  const tpr = (tF + 460) / pvt.tpc;
  const zVal = z ?? zFactorBrillBeggs(ppr, tpr).z;
  const rhoG = gasDensityLbft3(cfg.gasSg, pPsi, tF, zVal); // AB
  const vsg = ((((1 / flow.areaFt2) * gasScfD * zVal * (460 + tF)) / 520) * (14.7 / pPsi)) / 86400; // AD
  const vm = vsg + flow.vslFtS; // AE
  const rs = solutionGorScfStb(pPsi, pvt); // AF
  const bo = oilFvf(pPsi, pvt); // AJ
  // AK: live oil density with the workbook's rouhgsc chain
  const rsFactor = SCF_TO_M3 / BBL_TO_M3;
  let rhoO;
  if (pPsi <= pvt.pbPsi) {
    rhoO = ((pvt.rhoOScKgm3 + rsFactor * rs * pvt.rhoGscKgm3) / bo) * LBFT3_PER_KGM3;
  } else {
    const bob = oilFvfSaturated(pvt.rsiScfStb, pvt);
    rhoO =
      ((pvt.rhoOScKgm3 + rsFactor * pvt.rsiScfStb * pvt.rhoGscKgm3) / bob) *
      Math.exp(0.000003 * (pPsi - pvt.pbPsi)) *
      LBFT3_PER_KGM3;
  }
  const rhoL = rhoO + flow.yw * (flow.rhoWLbft3 - rhoO); // AL
  const disc = (1 + vm / 0.8) ** 2 - (4 * vsg) / 0.8;
  if (disc < 0) warnings.push(`Griffith discriminant < 0 at ${pPsi.toFixed(1)} psi`);
  const el = 1 - 0.38 * (1 + vm / 0.8 - Math.sqrt(Math.max(disc, 0))); // AG/AH
  const rhoMix = rhoG + el * (rhoL - rhoG); // AM
  // Gas viscosity with the anchored station-1 Tpr in poly AND divisor (Q/S cols)
  const muG =
    (gasViscosityBaseCp(cfg.gasSg, tF) / pvt.tprAnchor) *
    Math.exp(dempseyLnRatio(ppr, pvt.tprAnchor));
  const nre = (0.022 * massNreLbDay) / (cfg.tubingIdIn * flow.muLCp ** el * muG ** (1 - el)); // AN
  const f = chenFanning(cfg.roughness, nre); // AO
  const headFactor = ashryHeadFactor(cfg.gorScfStb, cfg.wcPct) * (cfg.matchHead ?? 1); // C17
  const gradHead = (rhoMix / 144) * headFactor; // AP
  const gradFric = frictionGradient(f, massFricLbDay, cfg.tubingIdIn / 12, rhoMix, cfg.matchFriction ?? 1); // AQ
  return { z: zVal, rhoG, vsg, vm, rs, bo, rhoO, rhoL, el, rhoMix, muG, nre, f, gradHead, gradFric, warnings };
}

function zoneRates(zone, flow) {
  if (zone === 'lifted') return { gasScfD: flow.gasLiftedScfD, massNreLbDay: flow.massLifted, massFricLbDay: flow.massFormation };
  if (zone === 'esp') return { gasScfD: flow.gasTubingScfD, massNreLbDay: flow.massTubing, massFricLbDay: flow.massTubing };
  return { gasScfD: flow.gasFormationScfD, massNreLbDay: flow.massFormation, massFricLbDay: flow.massFormation };
}

/**
 * Station temperatures for an oil-family march — the project's ONLY oil
 * temperature model (decision 2026-08-27): the flowing wellhead temperature
 * is CALCULATED with the same Ramey relaxation chain as the gas march
 * (shared rameyTemperatures helper). The oil workbooks' input-THT linear
 * profile is retired; THT is an output (whtF) here.
 * Required inputs: soilTempF, tubingOdIn, htcBtu. Optional: cpBtu (0.51),
 * massForHeatLbDay (defaults to the tubing/formation stream mass).
 */
export function computeOilTemps(cfg, grid, totTvdFt, flow) {
  const massLbDay = cfg.massForHeatLbDay ?? (cfg.esp ? flow.massTubing : flow.massFormation);
  return rameyTemperatures({
    grid,
    totTvdFt,
    tresF: cfg.tresF,
    soilTempF: cfg.soilTempF,
    tubingOdIn: cfg.tubingOdIn,
    htcBtu: cfg.htcBtu,
    cpBtu: cfg.cpBtu,
    massLbDay,
  });
}

/** Pump setting depth as TVD (m). The input is the MEASURED (along-hole)
 *  depth pumpAhM — how a pump is actually run and reported — converted on
 *  the well's own trajectory. cfg.esp.pumpTvdM is still honoured so saved
 *  cases (and the workbook pins) keep working. */
export function espPumpTvdM(cfg) {
  const e = cfg.esp ?? {};
  if (e.pumpAhM != null) return ahToTvdM(e.pumpAhM, cfg);
  return e.pumpTvdM;
}

function oilSegments(cfg, totTvdFt) {
  if (cfg.gasLift) {
    const injFt = cfg.gasLift.injDepthTvdM * 3.281;
    return [
      { toTvdFt: injFt, steps: cfg.gasLift.stepsAbove ?? 15, zone: 'lifted' },
      { toTvdFt: totTvdFt, steps: cfg.gasLift.stepsBelow ?? 14, zone: 'formation' },
    ];
  }
  if (cfg.esp) {
    const pumpFt = espPumpTvdM(cfg) * 3.281;
    return [
      { toTvdFt: pumpFt, steps: cfg.esp.stepsAbove ?? 26, zone: 'esp' },
      { toTvdFt: pumpFt, steps: 0, zone: 'esp', node: 'pumpIntake' },
      { toTvdFt: totTvdFt, steps: cfg.esp.stepsBelow ?? 2, zone: 'esp' },
    ];
  }
  return [{ toTvdFt: totTvdFt, steps: cfg.steps ?? 29, zone: 'formation' }];
}

/**
 * Top-down march: THP at surface to Pwf at the perfs.
 *
 * REQUIRED cfg: thpPsi, qOilStbD, gorScfStb, wcPct (<100), api, gasSg,
 *   tresF, perfTvdM, tubingIdIn, roughness, oilViscCp, rsiScfStb,
 *   soilTempF, htcBtu, tubingOdIn (heat inputs — WHT is calculated).
 * OPTIONAL cfg (defaults): devStartM (0), devAngleDeg (0), waterSg (1.05),
 *   cpBtu (0.51), massForHeatLbDay (stream mass), pbPsi (computed from
 *   Rsi/gg/API/Tres), rhoGscKgm3 (computed at 14.5 psia/60 F),
 *   matchHead (1), matchFriction (1), steps (29),
 *   n2/co2/h2s (0, fractions) with pcritMethod ('sweet' | 'sour' | 'auto').
 * LIFT blocks:
 *   gasLift: { injDepthTvdM (req), injRateMMscfd (0), stepsAbove (15), stepsBelow (14) }
 *   esp: { pumpTvdM (req), pumpDpPsi (req), tubingGasScfD (formation gas),
 *          stepsAbove (26), stepsBelow (2) }
 * OUTPUTS: stations[], pwfPsi, whtF (calculated), k10/k11,
 *   dischargePsi/intakePsi (ESP), warnings[].
 */
export function oilMarch(cfg) {
  validateOilCfg(cfg);
  const flow = deriveOilFlow(cfg);
  const path = { devStartM: cfg.devStartM ?? 0, devAngleDeg: cfg.devAngleDeg ?? 0 };
  const totTvdFt = cfg.perfTvdM * 3.281; // M5
  const grid = buildGrid(oilSegments(cfg, totTvdFt), path);
  const temps = computeOilTemps(cfg, grid, totTvdFt, flow);
  const pvt = resolveOilPvt(cfg, temps.tF[0]); // Dempsey anchor at station 1 (= calculated WHT)

  const warnings = [];
  const stations = [];
  let p = cfg.thpPsi;
  let dischargePsi = null;
  let intakePsi = null;

  for (let i = 0; i < grid.length; i++) {
    const g = grid[i];
    const calc = oilStationGradients(
      { pPsi: p, tF: temps.tF[i], ...zoneRates(g.zone, flow) },
      cfg, flow, pvt
    );
    warnings.push(...calc.warnings);
    stations.push({ tvdFt: g.tvdFt, ahFt: g.ahFt, tF: temps.tF[i], pPsi: p, zone: g.zone, ...calc });
    if (i === grid.length - 1) break;

    const next = grid[i + 1];
    if (next.node === 'pumpIntake') {
      dischargePsi = p; // D48
      const dp = cfg.esp.pumpDpPsi;
      p = dp >= p ? 60 : p - dp; // D49 (zero-length step)
      intakePsi = p;
    } else {
      p = p + calc.gradHead * (next.tvdFt - g.tvdFt) + calc.gradFric * (next.ahFt - g.ahFt); // D col
    }
  }

  return {
    stations, pwfPsi: p, dischargePsi, intakePsi,
    whtF: temps.tF[0], k10: temps.k10, k11: temps.k11,
    flow, pvt, warnings,
  };
}

/**
 * ESP IPR-side back-march (BHP rows 67 -> 65): from Pwf at the perfs up to
 * the pump intake, 2 steps, properties evaluated at max(P, 100) psi, using
 * the gradient of the LOWER station for each upward step.
 */
export function espBackMarch(cfg, pwfPsi) {
  validateOilCfg(cfg);
  const flow = deriveOilFlow(cfg);
  const path = { devStartM: cfg.devStartM ?? 0, devAngleDeg: cfg.devAngleDeg ?? 0 };
  const totTvdFt = cfg.perfTvdM * 3.281;
  // Reuse the full top-down ESP grid so the temperatures are identical
  // between the two branches; the back-march runs over its last
  // (stepsBelow + 1) stations: perf ... pump intake.
  const grid = buildGrid(oilSegments(cfg, totTvdFt), path);
  const temps = computeOilTemps(cfg, grid, totTvdFt, flow);
  const pvt = resolveOilPvt(cfg, temps.tF[0]);
  const steps = cfg.esp.stepsBelow ?? 2;
  const idx = [];
  for (let i = 0; i <= steps; i++) idx.push(grid.length - 1 - i); // perf -> pump

  const warnings = [];
  const stations = [];
  let p = pwfPsi;
  for (let k = 0; k < idx.length; k++) {
    const g = grid[idx[k]];
    const pEval = Math.max(p, 100); // M65:M67 floor
    const calc = oilStationGradients(
      { pPsi: pEval, tF: temps.tF[idx[k]], ...zoneRates('esp', flow) },
      cfg, flow, pvt
    );
    warnings.push(...calc.warnings);
    stations.push({ tvdFt: g.tvdFt, ahFt: g.ahFt, pPsi: p, tF: temps.tF[idx[k]], ...calc });
    if (k === idx.length - 1) break;
    const next = grid[idx[k + 1]];
    p = p - calc.gradHead * (g.tvdFt - next.tvdFt) - calc.gradFric * (g.ahFt - next.ahFt); // D66/D65
  }
  return { stations, pipPsi: p, warnings };
}
