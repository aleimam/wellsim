// Modified-Gray gas wellbore march (M.El-Ashry) — verbatim port of the BHP
// sheet of "Gas Well model_temp V6.0.0.xls".
//
// Fully explicit (Brill & Beggs Z), so this march reproduces the workbook to
// numerical precision. Per station: sour pseudo-criticals (hydrocarbon
// gravity + Kay + Wichert-Aziz), Brill & Beggs Z, CKB+Dempsey viscosity at
// LOCAL Tpr (unlike the oil family), Gray holdup with an effective-roughness
// friction term (base roughness tuned to 0.0021"), head on dTVD and friction
// on dAH, explicit Euler from THP down.
//
// Flowing temperature: geothermal ("shelf") profile from soil temperature at
// surface to Tres at TD, with the flowing temperature relaxing toward it
// bottom-up by a fixed factor K11 = exp(-alpha * L1) where alpha is built
// from tubing OD, overall heat transfer coefficient and Cp, and L1 is the
// FIRST station spacing (A23) — workbook quirk, preserved.

import { oilSpecificGravity } from '../pvt/oil.js';
import {
  gasPseudoCriticals,
  zFactorBrillBeggs,
  gasViscosityBaseCp,
  dempseyLnRatio,
  gasDensityLbft3,
  bgFactor,
} from '../pvt/gas.js';
import { WATER_DENSITY_KGM3, LBFT3_PER_KGM3 } from '../pvt/constants.js';
import { liquidViscosityCp } from '../pvt/water.js';
import { buildGrid } from './wellpath.js';
import { AIR_LB_PER_SCF, LIQ_LB_PER_FT3, chenFanning, frictionGradient, rameyTemperatures, requireInputs } from './common.js';

/** Required scalar inputs of the gas march (no defaults). */
const GAS_REQUIRED = [
  'thpPsi', 'qGasMMscfd', 'cgrStbMMscf', 'wgrStbMMscf', 'condApi', 'gasSg',
  'tresF', 'perfTvdM', 'tubingIdIn', 'tubingOdIn', 'soilTempF', 'htcBtu',
  'oilViscCp',
];

export function validateGasCfg(cfg) {
  requireInputs(cfg, GAS_REQUIRED, 'gas march');
  if (cfg.qGasMMscfd <= 0) throw new Error('gas march: qGasMMscfd must be > 0');
  if (cfg.cgrStbMMscf + cfg.wgrStbMMscf <= 0)
    throw new Error('gas march: CGR + WGR must be > 0 (the Gray liquid terms divide by the liquid rate; use a small CGR like 0.1 stb/MMscf for essentially dry gas)');
}

const SCF_TO_BBL = 0.1781075952; // gas scf -> bbl conversion used on the sheet

export function deriveGasFlow(cfg) {
  const qgScfD = cfg.qGasMMscfd * 1e6;
  const qL = cfg.qGasMMscfd * (cfg.cgrStbMMscf + cfg.wgrStbMMscf); // Q3
  const qw = cfg.qGasMMscfd * cfg.wgrStbMMscf;
  const ywFrac = cfg.wgrStbMMscf / (cfg.cgrStbMMscf + cfg.wgrStbMMscf); // AF4
  const waterSg = cfg.waterSg ?? 1.05;
  const condSg = oilSpecificGravity(cfg.condApi); // P7
  const liqSg = ((qL - qw) * condSg + qw * waterSg) / qL; // P15
  const rhoCond = condSg * WATER_DENSITY_KGM3 * LBFT3_PER_KGM3; // AD4
  const rhoW = waterSg * WATER_DENSITY_KGM3 * LBFT3_PER_KGM3; // AE4
  const rhoLConst = rhoCond + ywFrac * (rhoW - rhoCond); // AH4
  const gasBblSc = SCF_TO_BBL * qgScfD;
  const ygSc = gasBblSc / (gasBblSc + qL); // AG8
  const ylSc = 1 - ygSc; // AF8
  const massLbDay = liqSg * LIQ_LB_PER_FT3 * qL * 5.615 + AIR_LB_PER_SCF * cfg.gasSg * qgScfD; // R17
  const muLCp = liquidViscosityCp(cfg.oilViscCp, qL, qw); // R18
  const areaFt2 = (3.14 / 4) * (cfg.tubingIdIn / 12) ** 2; // P6
  const vslFtS = (qL * 5.615) / 86400 / areaFt2; // S15
  const sigmaLbS2 = (cfg.sigmaDyneCm ?? 30) / 0.00220462; // K17
  return { qgScfD, qL, qw, ywFrac, liqSg, rhoLConst, ygSc, ylSc, massLbDay, muLCp, areaFt2, vslFtS, sigmaLbS2 };
}

/** One Gray station (BHP row). Fully explicit. */
export function gasStationGradients({ pPsi, tF }, cfg, flow, pc) {
  const ppr = pPsi / pc.ppc; // O
  const tpr = (tF + 460) / pc.tpc; // P (local)
  const z = zFactorBrillBeggs(ppr, tpr).z; // AA
  const muG = (gasViscosityBaseCp(cfg.gasSg, tF) / tpr) * Math.exp(dempseyLnRatio(ppr, tpr)); // S
  const rhoG = gasDensityLbft3(cfg.gasSg, pPsi, tF, z); // AB
  const b = bgFactor(z, tF, pPsi); // AC
  const vsg = ((((1 / flow.areaFt2) * flow.qgScfD * z * (460 + tF)) / 520) * (14.7 / pPsi)) / 86400; // AD
  const vm = vsg + flow.vslFtS; // AE
  const rv = flow.vslFtS / vsg; // AF
  const rhoNs = rhoG + flow.ylSc * (flow.rhoLConst - rhoG); // AG (standard-condition split)
  const n1 = (rhoNs ** 2 * vm ** 4) / 32.2 / flow.sigmaLbS2 / (flow.rhoLConst - rhoG); // AH
  const n2 = (32.2 * (cfg.tubingIdIn / 12) ** 2 * (flow.rhoLConst - rhoG)) / flow.sigmaLbS2; // AI
  const rd = 0.0814 * (1 - 0.0554 * Math.log(1 + (730 * rv) / (1 + rv))); // AJ
  const f1 = -2.314 * (n1 * (1 + 205 / n2)) ** rd; // AK
  const cl = flow.qL / (flow.qL + SCF_TO_BBL * flow.qgScfD * b); // AL (in-situ)
  const el = 1 - (1 - cl) * (1 - Math.exp(f1)); // AM
  const rhoMix = rhoG + el * (flow.rhoLConst - rhoG); // AO
  const ko = (28.5 * flow.sigmaLbS2) / rhoNs / vm ** 2; // AP
  const base = cfg.roughnessBase ?? 0.0021; // S6
  const ke = rv >= 0.007 ? ko : base + rv * ((ko - base) / 0.007); // AQ
  const nre = (0.022 * flow.massLbDay) / (cfg.tubingIdIn * flow.muLCp ** el * muG ** (1 - el)); // AS
  const f = chenFanning(base / ke, nre); // AT (relative roughness = S6/Ke, verbatim)
  const gradHead = (rhoMix / 144) * (cfg.matchHead ?? 1); // AW
  const gradFric = frictionGradient(f, flow.massLbDay, cfg.tubingIdIn / 12, rhoMix, cfg.matchFriction ?? 1); // AX
  return { z, muG, rhoG, b, vsg, vm, rv, rhoNs, n1, n2, rd, f1, cl, el, rhoMix, ko, ke, nre, f, gradHead, gradFric };
}

/**
 * Gas well top-down march.
 *
 * REQUIRED cfg: thpPsi, qGasMMscfd (>0), cgrStbMMscf, wgrStbMMscf
 *   (CGR+WGR > 0), condApi, gasSg, tresF, perfTvdM, tubingIdIn,
 *   tubingOdIn, soilTempF, htcBtu, oilViscCp.
 * OPTIONAL cfg (defaults): n2/co2/h2s (0, fractions — pcrits are always the
 *   sour hydrocarbon-gravity route as in the workbook), cpBtu (0.51),
 *   devStartM (0), devAngleDeg (0), roughnessBase (0.0021),
 *   sigmaDyneCm (30), waterSg (1.05), matchHead (1), matchFriction (1),
 *   steps (29).
 * OUTPUTS: stations[], pwfPsi, whtF (calculated), k10/k11.
 */
export function gasMarch(cfg) {
  validateGasCfg(cfg);
  const flow = deriveGasFlow(cfg);
  const pc = gasPseudoCriticals({ gasSg: cfg.gasSg, n2: cfg.n2 ?? 0, co2: cfg.co2 ?? 0, h2s: cfg.h2s ?? 0, method: 'sour' });
  const path = { devStartM: cfg.devStartM ?? 0, devAngleDeg: cfg.devAngleDeg ?? 0 };
  const totTvdFt = cfg.perfTvdM * 3.281; // M5
  const grid = buildGrid([{ toTvdFt: totTvdFt, steps: cfg.steps ?? 29, zone: 'gas' }], path);

  // Temperature chain (independent of pressure) — shared Ramey helper
  const { tF, shelfF: shelf, k10: alpha, k11 } = rameyTemperatures({
    grid,
    totTvdFt,
    tresF: cfg.tresF,
    soilTempF: cfg.soilTempF,
    tubingOdIn: cfg.tubingOdIn,
    htcBtu: cfg.htcBtu,
    cpBtu: cfg.cpBtu,
    massLbDay: flow.massLbDay,
  });

  const stations = [];
  let p = cfg.thpPsi;
  for (let i = 0; i < grid.length; i++) {
    const calc = gasStationGradients({ pPsi: p, tF: tF[i] }, cfg, flow, pc);
    stations.push({ tvdFt: grid[i].tvdFt, ahFt: grid[i].ahFt, pPsi: p, tF: tF[i], shelfF: shelf[i], ...calc });
    if (i === grid.length - 1) break;
    p = p + calc.gradHead * (grid[i + 1].tvdFt - grid[i].tvdFt) + calc.gradFric * (grid[i + 1].ahFt - grid[i].ahFt); // D col
  }
  return { stations, pwfPsi: p, whtF: tF[0], k10: alpha, k11, flow, pc };
}
