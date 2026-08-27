// JSON API handlers — thin mapping from UI form state onto the calculation
// core. No physics here; every number comes from src/core.

import { bubblePointPsi, oilViscosityCp, oilFvf, solutionGorScfStb } from '../core/pvt/oil.js';
import { WATER_VISCOSITY_CP } from '../core/pvt/water.js';
import {
  waterInjectorMarch,
  injectorOperatingPoint,
  pwfAtQInj,
} from '../core/vlp/water-injector.js';
import { gasPvt } from '../core/pvt/gas.js';
import { perfTvdM } from '../core/vlp/wellpath.js';
import { oilMarch, espBackMarch } from '../core/vlp/oil-march.js';
import { gasMarch } from '../core/vlp/gas-march.js';
import {
  createOilIpr,
  calibrateDarcyToTest,
  iprCurve,
  qMaxGross,
  pwfAtQGross,
  withCurrentPr,
  permFromJOil,
  jDarcyOil,
  jFromTest,
} from '../core/ipr/oil-ipr.js';
import { getPwfOil } from '../core/nodal/calibrate.js';
import { ESP_PUMPS, pumpByName, THRUST } from '../core/vlp/esp-catalog.js';
import {
  pumpCurveAt,
  espOperatingPoint,
  espSolveDp,
  matchStages,
  matchWearAndPi,
} from '../core/vlp/esp.js';
import { createOilInflow, createGasInflow, applyInflowFluids } from '../core/ipr/inflow.js';
import { multiLayerOilRates, multiLayerGasRates } from '../core/ipr/multilayer.js';
import {
  createGasIpr,
  calibrateDarcyToTestGas,
  gasIprCurve,
  pwfAtQGasJ,
  pwfAtQGasCn,
  aofGasJ,
  fitCn,
  jDarcyGas,
} from '../core/ipr/gas-ipr.js';
import {
  oilRateGrid,
  gasRateGrid,
  oilOperatingPoint,
  gasOperatingPoint,
} from '../core/nodal/nodal.js';
import { calibrateOilIpr, calibrateGasCn } from '../core/nodal/calibrate.js';
import { gasLiftPerformance } from '../core/nodal/gaslift.js';
import {
  gasPresSolver,
  giipFromPz,
  staticPresFromSithp,
  sithpReserve,
  reservoirLimitWorkbook,
  cumGp,
  gasForecast,
  zAtRes,
  toDays,
} from '../core/reserve/gas-reserve.js';
import {
  oilPresSolver,
  oilStaticMb,
  stoiipFit,
  reservoirLimitOil,
} from '../core/reserve/oil-reserve.js';
import { tarnerForecast } from '../core/reserve/tarner.js';
import {
  vlpSensitivityOil,
  vlpSensitivityGas,
  oilIprSensitivity,
  gasIprSensitivity,
  futureOilJ,
} from '../core/nodal/sensitivity.js';
import { SKIN_GUIDANCE } from '../core/ipr/skin-guidance.js';

const num = (v) => (v === '' || v == null ? undefined : Number(v));
/** Date cell: a number stays a day-serial; a non-empty string (e.g.
 *  dd/mm/yyyy hh:mm:ss) passes through for the core parser. */
const dateVal = (v) => {
  if (v === '' || v == null) return undefined;
  const s = String(v).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
};

// ---------- OIL ----------

function buildOilCfg(f) {
  const perfTvd =
    num(f.perfTvdM) ??
    perfTvdM({ topPerfAhM: num(f.topPerfAhM), devStartM: num(f.devStartM) ?? 0, devAngleDeg: num(f.devAngleDeg) ?? 0 });
  const cfg = {
    thpPsi: num(f.thpPsi),
    qOilStbD: num(f.qOilStbD) ?? 1000,
    gorScfStb: num(f.gorScfStb),
    wcPct: num(f.wcPct),
    api: num(f.api),
    gasSg: num(f.gasSg),
    tresF: num(f.tresF),
    perfTvdM: perfTvd,
    devStartM: num(f.devStartM) ?? 0,
    devAngleDeg: num(f.devAngleDeg) ?? 0,
    tubingIdIn: num(f.tubingIdIn),
    roughness: num(f.roughness),
    oilViscCp: num(f.oilViscCp),
    waterSg: num(f.waterSg) ?? 1.05,
    rsiScfStb: num(f.rsiScfStb),
    matchHead: num(f.matchHead) ?? 1,
    matchFriction: num(f.matchFriction) ?? 1,
    soilTempF: num(f.soilTempF),
    htcBtu: num(f.htcBtu),
    tubingOdIn: num(f.tubingOdIn),
    cpBtu: num(f.cpBtu) ?? 0.51,
  };
  if (num(f.pbPsi) != null) cfg.pbPsi = num(f.pbPsi);
  // Water well: the same march at its limiting case — API 10 (SG = 1.000),
  // w.c. 100 %, no gas (GOR = Rsi = 0, Pb = 0). qOilStbD is the WATER rate.
  if (f.fluid === 'water') {
    // oilViscCp only satisfies the march's required-input check — the
    // liquid blend collapses to the hardcoded 0.5 cp water viscosity anyway
    Object.assign(cfg, { fluid: 'water', api: 10, wcPct: 100, gorScfStb: 0, rsiScfStb: 0, pbPsi: 0, oilViscCp: 0.5 });
  }
  // Lift type: one active mode — natural | gaslift | esp. Backward-compat
  // default: an injection depth implies gas lift (two-zone march even at
  // zero injection, matching the GasLift workbook's grid).
  const lift = f.liftType ?? (num(f.injDepthTvdM) != null ? 'gaslift' : 'natural');
  if (lift === 'gaslift' && num(f.injDepthTvdM) != null) {
    cfg.gasLift = { injDepthTvdM: num(f.injDepthTvdM), injRateMMscfd: num(f.injRateMMscfd) ?? 0 };
  }
  if (lift === 'esp') {
    cfg.esp = { pumpTvdM: num(f.pumpTvdM), pumpDpPsi: num(f.pumpDpPsi) };
    if (num(f.tubingGasScfD) != null) cfg.esp.tubingGasScfD = num(f.tubingGasScfD);
  }
  return cfg;
}

function oilPb(f, cfg) {
  return (
    cfg.pbPsi ??
    bubblePointPsi({ rsiScfStb: cfg.rsiScfStb, gasSg: cfg.gasSg, api: cfg.api, tempF: cfg.tresF })
  );
}

function oilPvtBundle(cfg, pb) {
  return { pbPsi: pb, rsiScfStb: cfg.rsiScfStb, gasSg: cfg.gasSg, api: cfg.api, tempF: cfg.tresF };
}

/** Darcy record with mu and Bo evaluated at the CURRENT Pr (the workbook's
 *  B35/B36 -> J_2 chain). */
function oilDarcyAtPr(f, pvt, prPsi) {
  // water well: reservoir fluid is water — mu = 0.5 cp (the sheets'
  // hardcoded water viscosity), Bw = 1; the oil correlations do not apply
  const water = f.fluid === 'water';
  return {
    permMd: num(f.permMd),
    thicknessFt: num(f.thicknessFt),
    reFt: num(f.reFt),
    rwFt: num(f.rwFt),
    skin: num(f.skin) ?? 0,
    viscCp: water ? WATER_VISCOSITY_CP : oilViscosityCp(prPsi, pvt),
    bo: water ? 1 : oilFvf(prPsi, pvt),
  };
}

function buildOilIpr(f, cfg, pb) {
  const priPsi = num(f.priPsi);
  const prPsi = num(f.prPsi) ?? priPsi;
  const pvt = oilPvtBundle(cfg, pb);
  const darcy = oilDarcyAtPr(f, pvt, prPsi);
  const ipr = createOilIpr({ darcy, priPsi, pbPsi: pb, prPsi });
  if (num(f.jTest) != null) {
    ipr.jTest = num(f.jTest);
    if (f.jSource === 'jones') {
      ipr.jSource = 'jones';
      ipr.j = ipr.jTest;
    }
  }
  return ipr;
}

/** Optional multi-layer Darcy inflow (f.mlMode === 'multi'): per-layer
 *  K/H/skin/Pr with Re/Rw (and Pb for oil) shared from the single-layer
 *  inputs; fluid ratios blank = base. Each layer's Darcy J takes its own
 *  mu*B (oil) / mu*z (gas) at the LAYER's Pr. */
function oilMultiLayer(f, cfg, pb) {
  if (f.mlMode !== 'multi') return null;
  const pvt = oilPvtBundle(cfg, pb);
  const rows = (f.mlLayers ?? []).filter(
    (r) => num(r.permMd) != null && num(r.thicknessFt) != null && num(r.prPsi) != null
  );
  if (rows.length < 2) return { error: 'multi-layer needs at least 2 layers (K, H and Pr on each row)' };
  const layers = rows.map((r, i) => {
    const pr = num(r.prPsi);
    return {
      name: `L${i + 1}`,
      jDarcy: jDarcyOil({
        permMd: num(r.permMd),
        thicknessFt: num(r.thicknessFt),
        reFt: num(f.reFt),
        rwFt: num(f.rwFt),
        skin: num(r.skin) ?? 0,
        viscCp: oilViscosityCp(pr, pvt),
        bo: oilFvf(pr, pvt),
      }),
      priPsi: pr,
      prPsi: pr,
      pbPsi: pb,
      wcPct: num(r.wcPct) ?? cfg.wcPct,
      gorScfStb: num(r.gorScfStb) ?? cfg.gorScfStb,
    };
  });
  return { inflow: createOilInflow({ multiLayer: { layers, pbPsi: pb } }) };
}

function gasMultiLayer(f, cfg) {
  if (f.mlMode !== 'multi' || f.iprMode === 'cn') return null;
  const rows = (f.mlLayers ?? []).filter(
    (r) => num(r.permMd) != null && num(r.thicknessFt) != null && num(r.prPsi) != null
  );
  if (rows.length < 2) return { error: 'multi-layer needs at least 2 layers (K, H and Pr on each row)' };
  const layers = rows.map((r, i) => {
    const pr = num(r.prPsi);
    const p = gasPvt({ gasSg: cfg.gasSg, n2: cfg.n2, co2: cfg.co2, h2s: cfg.h2s, method: 'sour' }, pr, cfg.tresF);
    return {
      name: `L${i + 1}`,
      jDarcy: jDarcyGas({
        permMd: num(r.permMd),
        thicknessFt: num(r.thicknessFt),
        reFt: num(f.reFt),
        rwFt: num(f.rwFt),
        skin: num(r.skin) ?? 0,
        viscCp: p.viscosityCp,
        z: p.z,
        tresF: cfg.tresF,
      }),
      priPsi: pr,
      prPsi: pr,
      cgrStbMMscf: num(r.cgrStbMMscf) ?? cfg.cgrStbMMscf,
      wgrStbMMscf: num(r.wgrStbMMscf) ?? cfg.wgrStbMMscf,
    };
  });
  return { inflow: createGasInflow({ multiLayer: { layers } }) };
}

export function oilNodal(f) {
  const cfg0 = buildOilCfg(f);
  const pb = oilPb(f, cfg0);
  const ml = oilMultiLayer(f, cfg0, pb);
  if (ml?.error) return ml;
  const inflow = ml?.inflow ?? null;
  const ipr = inflow ? inflow.ipr : buildOilIpr(f, cfg0, pb);
  // multi-layer: the blended WC/GOR at the solution point drive the marches
  const cfg = inflow ? applyInflowFluids(cfg0, inflow) : cfg0;
  const oilFrac = cfg.fluid === 'water' ? 1 : 1 - cfg.wcPct / 100;
  const aofOil = qMaxGross(ipr) * oilFrac;
  const cap = Math.min(aofOil * 0.999, 10000);
  if (!(cap > 50)) return { error: 'AOF too small — the well cannot flow above the 50 stb/d grid floor' };
  const rates = oilRateGrid(50, cap);
  // one march per rate yields the VLP point AND the calculated WHT
  const marchPts = rates.map((q) => {
    const m = oilMarch({ ...cfg, qOilStbD: q });
    return { q, pwfPsi: m.pwfPsi, whtF: m.whtF };
  });
  const vlp = marchPts.map(({ q, pwfPsi }) => ({ q, pwfPsi }));
  const op = oilOperatingPoint(cfg, ipr, { capStbD: cap });
  const whp = marchPts.map((p) => {
    const pwfIpr = pwfAtQGross(p.q / oilFrac, ipr);
    return {
      q: p.q,
      whpPsi: pwfIpr - p.pwfPsi + cfg.thpPsi,
      pwfIprPsi: pwfIpr,
      pwfVlpPsi: p.pwfPsi,
      whtF: p.whtF,
    };
  });
  const opMarch = op.status === 'ok' ? oilMarch({ ...cfg, qOilStbD: op.qOp }) : null;
  return {
    pbPsi: pb,
    computed: { pbPsi: pb, prPsi: ipr.prPsi, perfTvdM: cfg.perfTvdM },
    ipr: { jDarcy: ipr.jDarcy, jTest: ipr.jTest ?? null, j: ipr.j, jSource: ipr.jSource, priPsi: ipr.priPsi, prPsi: ipr.prPsi },
    aofOilStbD: aofOil,
    iprCurve: iprCurve(ipr, { wcPct: cfg.fluid === 'water' ? 0 : cfg.wcPct }),
    vlpCurve: vlp,
    whpCurve: whp,
    op: op.status === 'ok' ? { qOilStbD: op.qOp, pwfPsi: op.pwfPsi, whtF: opMarch.whtF } : null,
    esp:
      cfg.esp && opMarch
        ? { dischargePsi: opMarch.dischargePsi, intakePsi: opMarch.intakePsi, pumpDpPsi: cfg.esp.pumpDpPsi }
        : null,
    // manual-dP ESP: the input dP is merged into the march at the pump
    // depth — show that traverse (top-down + the IPR back-calc branch)
    espTraverse:
      cfg.esp && opMarch
        ? {
            stations: opMarch.stations.map((s) => ({ tvdFt: s.tvdFt, pPsi: s.pPsi })),
            backStations: espBackMarch(cfg, op.pwfPsi ?? opMarch.pwfPsi).stations.map((s) => ({ tvdFt: s.tvdFt, pPsi: s.pPsi })),
            dischargePsi: opMarch.dischargePsi,
            intakePsi: opMarch.intakePsi,
            dpPsi: cfg.esp.pumpDpPsi,
            pumpTvdFt: cfg.esp.pumpTvdM * 3.281,
          }
        : null,
    opStatus: op.status,
    warnings: opMarch?.warnings ?? [],
    multiLayer: inflow
      ? {
          prAvgPsi: inflow.prAvgPsi,
          jFinal: inflow.ipr.j,
          blended: inflow.blended,
          warnings: inflow.warnings,
          layersAtOp:
            op.status === 'ok' ? multiLayerOilRates(op.pwfPsi, inflow.layers) : null,
        }
      : null,
  };
}

export function oilCalibrate(f) {
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  if (num(f.testQOilStbD) == null) return { error: 'enter a test oil rate' };
  const cal = calibrateOilIpr({
    marchCfg: { ...cfg, thpPsi: num(f.testThpPsi) ?? cfg.thpPsi },
    priPsi: num(f.priPsi),
    pbPsi: pb,
    test: { qOilStbD: num(f.testQOilStbD), pwfPsi: num(f.testPwfPsi) },
  });
  const pvt = oilPvtBundle(cfg, pb);
  const prPsi = num(f.prPsi) ?? num(f.priPsi);
  const darcy = oilDarcyAtPr(f, pvt, prPsi);
  const matched = calibrateDarcyToTest(
    { ...cal.ipr, darcy: { ...darcy, permMd: undefined } },
    { skin: num(f.skin) ?? 0 }
  );
  // optional multi-layer fit ("total IPR to Jones, K is the solver"): scale
  // EVERY layer permeability by one factor so the commingled final J equals
  // the Jones/test J. Each layer J is linear in its K and PrAvg is
  // scale-invariant, so lambda = jTest / jFinal is exact.
  let mlFit = null;
  if (f.mlMode === 'multi') {
    const ml = oilMultiLayer(f, cfg, pb);
    if (ml?.error) return ml;
    const inflow = ml.inflow;
    // test Pwf marched with the commingled blended fluids at the test THP
    const cfgT = applyInflowFluids({ ...cfg, thpPsi: num(f.testThpPsi) ?? cfg.thpPsi }, inflow);
    const pwfSourceMl = num(f.testPwfPsi) != null ? 'input' : 'calculated';
    const pwfMl = num(f.testPwfPsi) ?? getPwfOil(cfgT, num(f.testQOilStbD));
    const qGrossMl = num(f.testQOilStbD) / (1 - (inflow.blended.wcPct ?? cfg.wcPct) / 100);
    const jTestMl = jFromTest({ qGrossStbD: qGrossMl, pwfPsi: pwfMl, priPsi: inflow.prAvgPsi, pbPsi: pb });
    const scale = jTestMl / inflow.ipr.j;
    mlFit = {
      jTestMl,
      jFinal: inflow.ipr.j,
      scale,
      prAvgPsi: inflow.prAvgPsi,
      testPwfPsi: pwfMl,
      pwfSource: pwfSourceMl,
      layers: (f.mlLayers ?? [])
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => num(r.permMd) != null && num(r.thicknessFt) != null && num(r.prPsi) != null)
        .map(({ r, i }) => ({ idx: i, kOld: num(r.permMd), kNew: num(r.permMd) * scale })),
    };
  }
  return {
    jTest: cal.ipr.jTest,
    testPwfPsi: cal.testPwfPsi,
    testQGrossStbD: cal.testQGrossStbD,
    pwfSource: cal.pwfSource,
    matchedPermMd: matched.matchedPermMd,
    skinUsed: num(f.skin) ?? 0,
    pbPsi: pb,
    mlFit,
  };
}

export function oilSensitivity(f) {
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const pvt = oilPvtBundle(cfg, pb);
  const water = cfg.fluid === 'water';
  const oilFrac = water ? 1 : 1 - cfg.wcPct / 100;
  const cap = Math.min(qMaxGross(ipr) * oilFrac * 0.999, 10000);
  const rates = oilRateGrid(50, Math.max(cap, 100));
  const sets = (f.vlpSets ?? []).map((s, i) => {
    const o = {};
    for (const k of ['thpPsi', 'wcPct', 'gorScfStb', 'tubingIdIn']) if (num(s[k]) != null) o[k] = num(s[k]);
    if (num(s.injRateMMscfd) != null && cfg.gasLift) o.gasLift = { injRateMMscfd: num(s.injRateMMscfd) };
    return { label: s.label || `VLP${i + 1}`, overrides: o };
  });
  const presList = (f.presList ?? []).map(num).filter((p) => p != null && p > 0);
  // water well: mu_w and Bw do not change with pressure, so the future J IS
  // the current J — no futureOilJ chain (that chain is oil PVT)
  const iprFamily = water
    ? (presList.length ? presList : [0.75, 0.5, 0.25].map((x) => ipr.prPsi * x)).map((p, i) => ({
        label: `Pres${i + 1}=${Math.round(p)} psi`,
        presPsi: p,
        j: ipr.j,
        curve: iprCurve(withCurrentPr(ipr, p), { wcPct: 0 }),
      }))
    : oilIprSensitivity(ipr, pvt, {
        presList: presList.length ? presList : undefined,
        wcPct: cfg.wcPct,
      }).map((m) => ({ label: m.label, presPsi: m.presPsi, j: m.j, curve: m.curve }));
  return { vlpFamily: vlpSensitivityOil(cfg, sets, { rates }), iprFamily };
}

export function oilGasLift(f) {
  if (f.liftType && f.liftType !== 'gaslift')
    return { error: 'switch the lift type to Gas lift to run the performance curve' };
  if (num(f.injDepthTvdM) == null)
    return { error: 'gas-lift performance needs the injection depth (mTVD)' };
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const max = num(f.injMaxMMscfd) ?? 2;
  const steps = Math.min(Math.max(Math.round(num(f.injSteps) ?? 10), 2), 25);
  const injRates = Array.from({ length: steps + 1 }, (_, i) => (max * i) / steps);
  const r = gasLiftPerformance(cfg, ipr, { injRatesMMscfd: injRates });
  return {
    ...r,
    currentInjMMscfd: cfg.gasLift.injRateMMscfd,
  };
}

// ---------- GAS ----------

function buildGasCfg(f) {
  const perfTvd =
    num(f.perfTvdM) ??
    perfTvdM({ topPerfAhM: num(f.topPerfAhM), devStartM: num(f.devStartM) ?? 0, devAngleDeg: num(f.devAngleDeg) ?? 0 });
  return {
    thpPsi: num(f.thpPsi),
    qGasMMscfd: num(f.qGasMMscfd) ?? 10,
    cgrStbMMscf: num(f.cgrStbMMscf),
    wgrStbMMscf: num(f.wgrStbMMscf),
    condApi: num(f.condApi),
    gasSg: num(f.gasSg),
    n2: (num(f.n2Pct) ?? 0) / 100,
    co2: (num(f.co2Pct) ?? 0) / 100,
    h2s: (num(f.h2sPpm) ?? 0) / 1e6,
    tresF: num(f.tresF),
    perfTvdM: perfTvd,
    devStartM: num(f.devStartM) ?? 0,
    devAngleDeg: num(f.devAngleDeg) ?? 0,
    tubingIdIn: num(f.tubingIdIn),
    tubingOdIn: num(f.tubingOdIn),
    soilTempF: num(f.soilTempF),
    htcBtu: num(f.htcBtu),
    cpBtu: num(f.cpBtu) ?? 0.51,
    roughnessBase: num(f.roughnessBase) ?? 0.0021,
    sigmaDyneCm: num(f.sigmaDyneCm) ?? 30,
    oilViscCp: num(f.oilViscCp),
    waterSg: num(f.waterSg) ?? 1.05,
    matchHead: num(f.matchHead) ?? 1,
    matchFriction: num(f.matchFriction) ?? 1,
  };
}

function buildGasIpr(f, cfg) {
  const priPsi = num(f.priPsi);
  const prPsi = num(f.prPsi) ?? priPsi;
  if (f.iprMode === 'cn') {
    if (num(f.cValue) != null && num(f.nValue) != null) {
      return createGasIpr({ c: num(f.cValue), n: num(f.nValue), priPsi, prPsi });
    }
    const points = (f.testPoints ?? [])
      .filter((p) => num(p.qMMscfd) != null)
      .map((p) => ({ qMMscfd: num(p.qMMscfd), pwfPsi: num(p.pwfPsi), thpPsi: num(p.thpPsi) }));
    if (points.length < 2) return { error: 'C&n needs at least 2 test points (or direct C and n values)' };
    const cal = calibrateGasCn({ marchCfg: cfg, priPsi, points });
    return { ...createGasIpr({ c: cal.ipr.c, n: cal.ipr.n, priPsi, prPsi }), fitPoints: cal.points, qMaxMMscfd: cal.qMaxMMscfd };
  }
  // Darcy J (default): mu and z at current Pr from the gas PVT chain
  const p = gasPvt({ gasSg: cfg.gasSg, n2: cfg.n2, co2: cfg.co2, h2s: cfg.h2s, method: 'sour' }, prPsi, cfg.tresF);
  const darcy = {
    permMd: num(f.permMd),
    thicknessFt: num(f.thicknessFt),
    reFt: num(f.reFt),
    rwFt: num(f.rwFt),
    skin: num(f.skin) ?? 0,
    viscCp: p.viscosityCp,
    z: p.z,
    tresF: cfg.tresF,
  };
  const ipr = createGasIpr({ darcy, priPsi, prPsi });
  if (num(f.jTest) != null) ipr.jTest = num(f.jTest);
  return ipr;
}

export function gasNodal(f) {
  const cfg0 = buildGasCfg(f);
  const ml = gasMultiLayer(f, cfg0);
  if (ml?.error) return ml;
  const inflow = ml?.inflow ?? null;
  const ipr = inflow ? inflow.ipr : buildGasIpr(f, cfg0);
  if (ipr.error) return ipr;
  // multi-layer: the blended CGR/WGR drive the marches
  const cfg = inflow ? applyInflowFluids(cfg0, inflow) : cfg0;
  const aof = ipr.c != null ? ipr.c * ipr.prPsi ** (2 * ipr.n) : aofGasJ(ipr);
  if (!(aof > 0.2)) return { error: 'AOF too small — gas well cannot flow above the 0.1 MMscf/d grid floor' };
  const rates = gasRateGrid(0.1, aof * 0.999);
  // one march per rate yields the VLP point AND the calculated WHT
  const marchPts = rates.map((q) => {
    const m = gasMarch({ ...cfg, qGasMMscfd: q });
    return { q, pwfPsi: m.pwfPsi, whtF: m.whtF };
  });
  const vlp = marchPts.map(({ q, pwfPsi }) => ({ q, pwfPsi }));
  const op = gasOperatingPoint(cfg, ipr);
  const iprPwf = ipr.c != null ? (q) => pwfAtQGasCn(q, ipr) : (q) => pwfAtQGasJ(q, ipr);
  const whp = marchPts.map((p) => {
    const pwfIpr = iprPwf(p.q);
    return {
      q: p.q,
      whpPsi: pwfIpr - p.pwfPsi + cfg.thpPsi,
      pwfIprPsi: pwfIpr,
      pwfVlpPsi: p.pwfPsi,
      whtF: p.whtF,
    };
  });
  const opMarch = op.status === 'ok' ? gasMarch({ ...cfg, qGasMMscfd: op.qOp }) : null;
  return {
    computed: { prPsi: ipr.prPsi, perfTvdM: cfg.perfTvdM },
    ipr: {
      mode: ipr.c != null ? 'cn' : 'j',
      j: ipr.j ?? null, jTest: ipr.jTest ?? null, jSource: ipr.jSource ?? null,
      c: ipr.c ?? null, n: ipr.n ?? null,
      priPsi: ipr.priPsi, prPsi: ipr.prPsi,
    },
    aofMMscfd: aof,
    iprCurve: gasIprCurve(ipr),
    vlpCurve: vlp,
    whpCurve: whp,
    op: op.status === 'ok' ? { qMMscfd: op.qOp, pwfPsi: op.pwfPsi, whtF: opMarch.whtF } : null,
    opStatus: op.status,
    multiLayer: inflow
      ? {
          prAvgPsi: inflow.prAvgPsi,
          jFinal: inflow.ipr.j,
          blended: inflow.blended,
          warnings: inflow.warnings,
          layersAtOp:
            op.status === 'ok' ? multiLayerGasRates(op.pwfPsi, inflow.layers) : null,
        }
      : null,
  };
}

/**
 * Gas calibration — mirrors the oil workflow, Darcy Pr^2 dominant:
 *  1. resolve each test point's Pwf (input, or get_Pwf at its own THP);
 *  2. calculated J from the test on the squared-pressure basis (n = 1
 *     least-squares: geometric mean of per-point J = 1000 q/(Pri^2-Pwf^2));
 *  3. C & n fitted as the CALCULATED optional basis (needs >= 2 points);
 *  4. the ACTUAL K matched at the user's skin so J Darcy = J test
 *     (mu and Z evaluated at the current Pr, as the Darcy record does).
 */
export function gasCalibrate(f) {
  const cfg = buildGasCfg(f);
  const priPsi = num(f.priPsi);
  const prPsi = num(f.prPsi) ?? priPsi;
  const raw = (f.testPoints ?? [])
    .filter((p) => num(p.qMMscfd) != null)
    .map((p) => ({ qMMscfd: num(p.qMMscfd), pwfPsi: num(p.pwfPsi), thpPsi: num(p.thpPsi) }));
  if (raw.length === 0) return { error: 'enter at least one test point' };
  const points = raw.map((p) => {
    const pwfSource = p.pwfPsi != null ? 'input' : 'calculated';
    const pwfPsi =
      p.pwfPsi ??
      gasMarch({ ...cfg, thpPsi: p.thpPsi ?? cfg.thpPsi, qGasMMscfd: p.qMMscfd }).pwfPsi;
    return { qMMscfd: p.qMMscfd, pwfPsi, pwfSource };
  });

  const logs = points.map((p) => Math.log10((1000 * p.qMMscfd) / (priPsi ** 2 - p.pwfPsi ** 2)));
  const jTest = 10 ** (logs.reduce((a, b) => a + b, 0) / logs.length);

  const cn = points.length >= 2 ? fitCn(points, priPsi) : null;

  const pvt = gasPvt({ gasSg: cfg.gasSg, n2: cfg.n2, co2: cfg.co2, h2s: cfg.h2s, method: 'sour' }, prPsi, cfg.tresF);
  const matched = calibrateDarcyToTestGas(
    {
      jTest,
      darcy: {
        thicknessFt: num(f.thicknessFt),
        reFt: num(f.reFt),
        rwFt: num(f.rwFt),
        viscCp: pvt.viscosityCp,
        z: pvt.z,
        tresF: cfg.tresF,
      },
    },
    { skin: num(f.skin) ?? 0 }
  );
  // optional multi-layer fit: one scale factor on every layer K so the
  // exact commingled J_t equals the test J against PrAvg
  let mlFit = null;
  if (f.mlMode === 'multi' && f.iprMode !== 'cn') {
    const ml = gasMultiLayer(f, cfg);
    if (ml?.error) return ml;
    const inflow = ml.inflow;
    const cfgT = applyInflowFluids(cfg, inflow);
    const pointsMl = raw.map((p) => {
      const pwfSource = p.pwfPsi != null ? 'input' : 'calculated';
      const pwfPsi =
        p.pwfPsi ??
        gasMarch({ ...cfgT, thpPsi: p.thpPsi ?? cfgT.thpPsi, qGasMMscfd: p.qMMscfd }).pwfPsi;
      return { qMMscfd: p.qMMscfd, pwfPsi, pwfSource };
    });
    const logsMl = pointsMl.map((p) =>
      Math.log10((1000 * p.qMMscfd) / (inflow.prAvgPsi ** 2 - p.pwfPsi ** 2))
    );
    const jTestMl = 10 ** (logsMl.reduce((a, b) => a + b, 0) / logsMl.length);
    const scale = jTestMl / inflow.ipr.j;
    mlFit = {
      jTestMl,
      jFinal: inflow.ipr.j,
      scale,
      prAvgPsi: inflow.prAvgPsi,
      points: pointsMl,
      layers: (f.mlLayers ?? [])
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => num(r.permMd) != null && num(r.thicknessFt) != null && num(r.prPsi) != null)
        .map(({ r, i }) => ({ idx: i, kOld: num(r.permMd), kNew: num(r.permMd) * scale })),
    };
  }
  return {
    jTest,
    c: cn?.c ?? null,
    n: cn?.n ?? null,
    qMaxMMscfd: cn?.qMaxMMscfd ?? null,
    matchedPermMd: matched.matchedPermMd,
    skinUsed: num(f.skin) ?? 0,
    points,
    mlFit,
  };
}

export function gasSensitivity(f) {
  const cfg = buildGasCfg(f);
  const ipr = buildGasIpr(f, cfg);
  if (ipr.error) return ipr;
  const aof = ipr.c != null ? ipr.c * ipr.prPsi ** (2 * ipr.n) : aofGasJ(ipr);
  const rates = gasRateGrid(0.1, Math.max(aof * 0.999, 1));
  const sets = (f.vlpSets ?? []).map((s, i) => {
    const o = {};
    for (const k of ['thpPsi', 'cgrStbMMscf', 'wgrStbMMscf', 'tubingIdIn']) if (num(s[k]) != null) o[k] = num(s[k]);
    return { label: s.label || `VLP${i + 1}`, overrides: o };
  });
  const presList = (f.presList ?? []).map(num).filter((p) => p != null && p > 0);
  return {
    vlpFamily: vlpSensitivityGas(cfg, sets, { rates }),
    iprFamily: gasIprSensitivity(ipr, { presList: presList.length ? presList : undefined }),
  };
}

function interpGp(solved, tDays) {
  if (solved.length === 0) return null;
  if (tDays <= solved[0].tDays) return solved[0].gpBscf;
  for (let i = 1; i < solved.length; i++) {
    if (tDays <= solved[i].tDays) {
      const a = solved[i - 1];
      const b = solved[i];
      return a.gpBscf + ((b.gpBscf - a.gpBscf) * (tDays - a.tDays)) / (b.tDays - a.tDays);
    }
  }
  return solved[solved.length - 1].gpBscf;
}

/** Module 2 (gas): p/Z fit -> minimum connected GIIP, from one of two
 *  selectable pressure sources:
 *   'sithp'   — route 1: SITHP statics (zero-rate correlation), no IPR
 *               needed; production rows supply only the Gp integration;
 *   'flowing' — route 2 (default): Pres solver back-calculation from
 *               flowing data with the frozen calibrated IPR. */
export function gasReserve(f) {
  const cfg = buildGasCfg(f);
  const rows = (f.prodRows ?? [])
    .filter((r) => dateVal(r.date) != null && num(r.qMMscfd) != null)
    .map((r) => ({
      date: dateVal(r.date),
      qMMscfd: num(r.qMMscfd),
      thpPsi: num(r.thpPsi),
      pwfPsi: num(r.pwfPsi),
      cgrStbMMscf: num(r.cgrStbMMscf),
      wgrStbMMscf: num(r.wgrStbMMscf),
    }));
  // reject unparseable dates loudly — a NaN date would silently poison the
  // Gp integration and the p/Z fit
  for (let i = 0; i < rows.length; i++) {
    if (Number.isNaN(toDays(rows[i].date)))
      return { error: `row ${i + 1}: unparseable date "${rows[i].date}" — use dd/mm/yyyy hh:mm:ss or a day number` };
  }
  const src = f.presSource === 'prod' ? 'flowing' : (f.presSource ?? 'flowing');

  if (src === 'rlt') {
    const ipr = buildGasIpr(f, cfg);
    if (ipr.error) return ipr;
    if (rows.length < 3) return { error: 'reservoir limit needs at least 3 production rows' };
    const solved = gasPresSolver(cfg, ipr, rows);
    let rlt;
    try {
      rlt = reservoirLimitWorkbook(cfg, solved, {
        sg: num(f.rltSg) ?? 0.85,
        so: num(f.rltSo) ?? 0,
        sw: num(f.rltSw) ?? 0.15,
        cfPsi: num(f.rltCf) ?? 3e-6,
        coPsi: num(f.rltCo) ?? 1e-6,
        cwPsi: num(f.rltCw) ?? 1e-6,
        cgOverride: num(f.rltCg),
      });
    } catch (e) {
      return { error: e.message };
    }
    return {
      mode: 'rlt',
      rows: solved,
      rlt,
      fit: { giipBscf: rlt.giipBscf, pziPsi: null, slope: -rlt.slopePsiDay, warning: rlt.warning },
      lastGpBscf: solved[solved.length - 1].gpBscf,
      lastDay: solved[solved.length - 1].tDays,
      currentPresPsi: Math.min(...solved.map((s) => s.presPsi)),
    };
  }

  if (src === 'sithp') {
    // survey rows use the prod_data structure: Date | STHP | Gas rate (= 0)
    // | CGR | WGR; the static march uses well-model data throughout
    const rawSurveys = (f.sithpRows ?? []).filter(
      (r) => num(r.sithpPsi) != null && dateVal(r.date) != null
    );
    const warnings = [];
    for (let i = 0; i < rawSurveys.length; i++) {
      if ((num(rawSurveys[i].qMMscfd) ?? 0) !== 0)
        warnings.push(`survey row ${i + 1}: gas rate should be 0 for a static SITHP survey (rate ignored)`);
      if (Number.isNaN(toDays(dateVal(rawSurveys[i].date))))
        return { error: `survey row ${i + 1}: unparseable date "${rawSurveys[i].date}"` };
    }
    const sithpRows = rawSurveys.map((r) => ({
      date: dateVal(r.date),
      sithpPsi: num(r.sithpPsi),
      surfTempF: num(r.surfTempF),
      cgrStbMMscf: num(r.cgrStbMMscf),
      wgrStbMMscf: num(r.wgrStbMMscf),
    }));
    if (sithpRows.length < 2)
      return { error: 'route 2 needs at least 2 SITHP surveys with dates' };
    if (rows.length < 2)
      return { error: 'route 2 needs production rows (day + rate) in the prod table to integrate Gp' };
    try {
      const r = sithpReserve(cfg, sithpRows, rows);
      return {
        mode: 'sithp',
        rows: r.points,
        sithp: r.points,
        fit: r.fit,
        warnings,
        lastGpBscf: r.lastGpBscf,
        lastDay: r.lastDay,
        currentPresPsi: Math.min(...r.points.map((p) => p.presPsi)),
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  const ipr = buildGasIpr(f, cfg);
  if (ipr.error) return ipr;
  if (rows.length < 2) return { error: 'enter at least 2 production rows (day, rate, and THP or Pwf)' };
  const solved = gasPresSolver(cfg, ipr, rows);

  const sithp = (f.sithpRows ?? [])
    .filter((r) => num(r.sithpPsi) != null)
    .map((r) => {
      const s = staticPresFromSithp({ sithpPsi: num(r.sithpPsi), surfTempF: num(r.surfTempF) ?? 60, cfg });
      const gp = num(r.date) != null ? interpGp(solved, num(r.date)) : null;
      return { tDays: num(r.date), presPsi: s.presPsi, z: s.zRes, pOverZ: s.presPsi / s.zRes, gpBscf: gp, gradientPsiFt: s.gradientPsiFt };
    });

  // selection 1 fits the prod_data points ONLY (SITHP has its own
  // selection; its points are returned for chart overlay, not the fit)
  let fit;
  try {
    fit = giipFromPz(solved.map((s) => ({ gpBscf: s.gpBscf, pOverZ: s.pOverZ })));
  } catch (e) {
    return { error: e.message };
  }
  return {
    mode: 'flowing',
    rows: solved,
    sithp,
    fit,
    lastGpBscf: solved[solved.length - 1].gpBscf,
    lastDay: solved[solved.length - 1].tDays,
    // the workbook's "Current Pres" AH8 = MIN of the solved Pres column
    currentPresPsi: Math.min(...solved.map((s) => s.presPsi)),
  };
}

/** Module 3 (gas): coupled p/Z + nodal forecast with plateau. GIIP/pzi
 *  blank -> derived from the reserve fit (production rows required then). */
export function gasForecastApi(f) {
  const cfg = buildGasCfg(f);
  const ipr = buildGasIpr(f, cfg);
  if (ipr.error) return ipr;
  let giip = num(f.giipBscf);
  let pzi = num(f.pziPsi);
  let startGp = num(f.startGpBscf);
  let startPres = num(f.startPresPsi);
  // start date: input-or-calculated — a date string or day number, blank ->
  // the last prod-data date (workbook AH7 = MAX of the date column)
  let startDay = null;
  if (f.startDate != null && String(f.startDate).trim() !== '') {
    startDay = toDays(f.startDate);
    if (Number.isNaN(startDay))
      return { error: `unparseable forecast start date "${f.startDate}" — use d-MMM-yy, dd/mm/yyyy or a day number` };
  }
  // chain off selection 1 (the prod-data Pres solver): the workbook derives
  // start date / Current Pres / GIIP / CUM gas from that sheet's columns.
  // Also solved unconditionally so the chart can overlay history.
  const rsv = gasReserve({ ...f, presSource: 'prod' });
  let history = [];
  if (!rsv.error) {
    history = rsv.rows.map((r) => ({ tDays: r.tDays, qMMscfd: r.qMMscfd, presPsi: r.presPsi, gpBscf: r.gpBscf }));
    if (rsv.fit.giipBscf != null) {
      giip = giip ?? rsv.fit.giipBscf;
      pzi = pzi ?? rsv.fit.pziPsi;
    }
    startGp = startGp ?? rsv.lastGpBscf;
    startDay = startDay ?? rsv.lastDay;
    startPres = startPres ?? rsv.currentPresPsi; // workbook AH8: MIN of solved Pres
  }
  if (giip == null) return { error: 'GIIP not given and no production rows to fit it from' };
  if (pzi == null) pzi = ipr.priPsi / zAtRes(cfg, ipr.priPsi); // pzi at initial Pres
  const fc = gasForecast({
    marchCfg: cfg,
    ipr,
    giipBscf: giip,
    pziPsi: pzi,
    startGpBscf: startGp ?? 0,
    startDay: startDay ?? 0,
    startPresPsi: startPres,
    stepDays: num(f.stepDays) ?? 30,
    fthpPsi: num(f.forecastFthpPsi) ?? cfg.thpPsi,
    plateauMMscfd: num(f.plateauMMscfd),
    minRateMMscfd: num(f.minRateMMscfd) ?? 0.5,
    maxSteps: Math.min(num(f.maxSteps) ?? 60, 200),
  });
  return {
    ...fc,
    history,
    giipBscf: giip,
    pziPsi: pzi,
    startGpBscf: startGp ?? 0,
    startDay: startDay ?? 0,
    startPresPsi: startPres ?? null,
  };
}

/** Oil Module 2: minimum connected STOIIP. presSource: 'prod' (Havlena-Odeh
 *  MB on solver-derived Pres), 'static' (MB on measured memory-gauge Pres
 *  history), 'rlt' (reservoir limit). Well data and the matched IPR come
 *  from the oil Well model module. */
export function oilReserve(f) {
  if (f.fluid === 'water')
    return { error: 'Reserve estimate (solution-gas material balance) applies to oil wells — switch Well fluid to Oil' };
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const pvt = oilPvtBundle(cfg, pb);
  const rows = (f.prodRows ?? [])
    .filter((r) => dateVal(r.date) != null && num(r.qOilStbD) != null)
    .map((r) => ({
      date: dateVal(r.date),
      qOilStbD: num(r.qOilStbD),
      thpPsi: num(r.thpPsi),
      pwfPsi: num(r.pwfPsi),
      gorScfStb: num(r.gorScfStb),
      wcPct: num(r.wcPct),
    }));
  for (let i = 0; i < rows.length; i++) {
    if (Number.isNaN(toDays(rows[i].date)))
      return { error: `row ${i + 1}: unparseable date "${rows[i].date}" — use d-MMM-yy, dd/mm/yyyy hh:mm:ss or a day number` };
  }
  const src = f.presSource ?? 'prod';

  if (src === 'static') {
    const surveys = (f.staticRows ?? [])
      .filter((r) => dateVal(r.date) != null && num(r.presPsi) != null)
      .map((r) => ({ date: dateVal(r.date), presPsi: num(r.presPsi) }));
    for (let i = 0; i < surveys.length; i++) {
      if (Number.isNaN(toDays(surveys[i].date)))
        return { error: `survey row ${i + 1}: unparseable date "${surveys[i].date}"` };
    }
    if (surveys.length < 2) return { error: 'static route needs at least 2 measured Pres surveys with dates' };
    if (rows.length < 2) return { error: 'static route needs production rows (date + rate) to integrate Np/Gp' };
    const r = oilStaticMb(cfg, ipr, pvt, surveys, rows);
    return { mode: 'static', rows: r.points, fit: r.fit, pbPsi: pb };
  }

  if (rows.length < (src === 'rlt' ? 3 : 2))
    return { error: `enter at least ${src === 'rlt' ? 3 : 2} production rows (date, rate, and THP or Pwf)` };
  const solved = oilPresSolver(cfg, ipr, pvt, rows);

  if (src === 'rlt') {
    let rlt;
    try {
      rlt = reservoirLimitOil(cfg, solved, {
        sg: num(f.rltSg) ?? 0.1,
        so: num(f.rltSo) ?? 0.8,
        sw: num(f.rltSw) ?? 0.15,
        cfPsi: num(f.rltCf) ?? 3e-6,
        coPsi: num(f.rltCo) ?? 1e-6,
        cwPsi: num(f.rltCw) ?? 1e-6,
        cgOverride: num(f.rltCg),
      });
    } catch (e) {
      return { error: e.message };
    }
    return {
      mode: 'rlt',
      rows: solved,
      rlt,
      fit: { nAvgMMstb: rlt.stoiipMMstb, nSlopeMMstb: null, warning: rlt.warning },
      pbPsi: pb,
    };
  }

  return { mode: 'prod', rows: solved, fit: stoiipFit(solved), pbPsi: pb };
}

/** Oil Module 3: Tarner forecast. N grey = the Reserve MB average; start
 *  state grey = chained off the prod-data Pres solver (same pattern as the
 *  gas forecast). pwfMode 'vlp' (nodal at forecast FTHP) | 'fixed' (min Pwf,
 *  the sheet's active behavior). */
export function oilForecastApi(f) {
  if (f.fluid === 'water') return { error: 'the Tarner forecast applies to oil wells' };
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const pvt = oilPvtBundle(cfg, pb);
  let n = num(f.nMMstb);
  let startNp = num(f.startNpMMstb);
  let startPres = num(f.startPresPsi);
  let startDay = null;
  if (f.startDate != null && String(f.startDate).trim() !== '') {
    startDay = toDays(f.startDate);
    if (Number.isNaN(startDay))
      return { error: `unparseable forecast start date "${f.startDate}" — use d-MMM-yy, dd/mm/yyyy or a day number` };
  }
  // chain off Reserve selection 1 (Havlena-Odeh) and keep history for the chart
  let history = [];
  const rsv = oilReserve({ ...f, presSource: 'prod' });
  if (!rsv.error) {
    history = rsv.rows.map((r) => ({ tDays: r.tDays, qOilStbD: r.qOilStbD, presPsi: r.presPsi, npMMstb: r.npMMstb, gpBscf: r.gpBscf }));
    n = n ?? rsv.fit.nAvgMMstb ?? undefined;
    const last = rsv.rows[rsv.rows.length - 1];
    startNp = startNp ?? last.npMMstb;
    startDay = startDay ?? last.tDays;
    startPres = startPres ?? Math.min(...rsv.rows.map((r) => r.presPsi));
  }
  if (n == null || !(n > 0))
    return { error: 'STOIIP N not given and no production rows to derive it from — run the Reserve module first or type N' };
  const startGpMMscf = history.length ? history[history.length - 1].gpBscf * 1000 : 0;
  const fc = tarnerForecast({
    // the Tarner stream is oil+gas (the sheet's F8 W.C input, default 0) —
    // the march must not inherit the well model's producing water cut
    cfg: { ...cfg, wcPct: num(f.fcWcPct) ?? 0 },
    pvt,
    darcy: {
      permMd: num(f.permMd), thicknessFt: num(f.thicknessFt),
      reFt: num(f.reFt), rwFt: num(f.rwFt), skin: num(f.skin) ?? 0,
    },
    nMMstb: n,
    priPsi: ipr.priPsi,
    swi: num(f.swiFrac) ?? 0.15,
    cwPsi: num(f.tarCw) ?? 2.63e-6,
    cfPsi: num(f.tarCf) ?? 3.25e-6,
    startPresPsi: startPres ?? ipr.priPsi,
    startNpMMstb: startNp ?? 0,
    startGpMMscf,
    startDay: startDay ?? 0,
    stepDays: num(f.stepDays) ?? 30,
    maxSteps: Math.min(num(f.maxSteps) ?? 60, 200),
    pwfMode: f.pwfMode === 'fixed' ? 'fixed' : 'vlp',
    fthpPsi: num(f.forecastFthpPsi) ?? cfg.thpPsi,
    minPwfPsi: num(f.minPwfPsi) ?? 500,
    abandonQoStbD: num(f.abandonQoStbD) ?? 50,
  });
  return {
    ...fc,
    history,
    nMMstb: n,
    startDay: startDay ?? 0,
    startNpMMstb: startNp ?? 0,
    startPresPsi: startPres ?? ipr.priPsi,
    pbPsi: pb,
  };
}

/** Water injector nodal solve: available BHIP (march, friction subtracts)
 *  vs the injectivity line Pr + q/J. J is the Darcy J on water properties
 *  from the same IPR block (Pb = 0). */
export function waterInjector(f) {
  const cfg = buildOilCfg(f); // f.fluid === 'water' applies the water limits
  const ipr = buildOilIpr(f, cfg, 0);
  const model = { j: ipr.j, prPsi: ipr.prPsi };
  const op = injectorOperatingPoint(cfg, model);
  // curves on a shared rate grid: to ~1.5x the operating rate (or a probe span)
  const qTop = op.status === 'ok' ? op.qOp * 1.5 : 5000;
  const rates = [];
  for (let i = 1; i <= 12; i++) rates.push((qTop * i) / 12);
  const vlpCurve = rates.map((q) => {
    const m = waterInjectorMarch({ ...cfg, qOilStbD: q });
    return { q, pwfPsi: m.pwfPsi, bhtF: m.bhtF };
  });
  const injCurve = rates.map((q) => ({ q, pwfPsi: pwfAtQInj(q, model) }));
  // injection THP required to place each rate: THP - R(q)
  const thpCurve = rates.map((q, i) => ({
    q,
    thpReqPsi: cfg.thpPsi - (vlpCurve[i].pwfPsi - injCurve[i].pwfPsi),
    bhtF: vlpCurve[i].bhtF,
  }));
  const availAtZero = waterInjectorMarch({ ...cfg, qOilStbD: 1 }).pwfPsi;
  return {
    op: op.status === 'ok' ? { qBpd: op.qOp, pwfPsi: op.pwfPsi, bhtF: op.bhtF } : null,
    opStatus: op.status,
    deficitPsi: op.deficitPsi ?? null,
    jInj: model.j,
    prPsi: model.prPsi,
    availAtZeroPsi: availAtZero,
    injCurve,
    vlpCurve,
    thpCurve,
  };
}

/** Injection-test calibration: J_inj = q / (Pwf - Pr), Pwf input-or-marched
 *  at the test THP/rate; matched K back-solved through the water Darcy J. */
export function waterInjCalibrate(f) {
  const cfg = buildOilCfg(f);
  const prPsi = num(f.prPsi) ?? num(f.priPsi);
  const q = num(f.testQOilStbD);
  if (q == null || !(q > 0)) return { error: 'enter a test injection rate' };
  const pwfSource = num(f.testPwfPsi) != null ? 'input' : 'calculated';
  const pwf =
    num(f.testPwfPsi) ??
    waterInjectorMarch({ ...cfg, thpPsi: num(f.testThpPsi) ?? cfg.thpPsi, qOilStbD: q }).pwfPsi;
  if (!(pwf > prPsi))
    return { error: `test BHIP ${pwf.toFixed(1)} psi does not exceed Pr ${prPsi} — no injection at this test point` };
  const jTest = q / (pwf - prPsi);
  const darcy = oilDarcyAtPr(f, null, prPsi); // water branch: mu 0.5, Bw 1
  const matchedPermMd = permFromJOil({ j: jTest, ...darcy });
  return { jTest, testPwfPsi: pwf, pwfSource, matchedPermMd, skinUsed: num(f.skin) ?? 0 };
}

// ---- ESP stack (Oil well model_ESP_V5.01) ----

export function espPumps() {
  return { pumps: ESP_PUMPS.map((p) => p.name) };
}

/** Pump from the background catalog or a custom curve; null = manual dP. */
function buildEspPump(f) {
  const mode = f.espPumpMode ?? 'manual';
  if (mode === 'db') {
    const p = pumpByName(f.espPumpName);
    if (!p) return { error: `pump "${f.espPumpName}" not in the database` };
    return { pump: p };
  }
  if (mode === 'custom') {
    const points = (f.espCurve ?? [])
      .filter((r) => num(r.headFt) != null && num(r.rateBpd) != null)
      .map((r) => ({ headFt: num(r.headFt), rateBpd: num(r.rateBpd) }))
      .sort((a, b) => a.rateBpd - b.rateBpd);
    if (points.length < 3) return { error: 'custom pump needs at least 3 curve points (head, rate)' };
    return { pump: { name: f.espPumpName || 'Custom pump', refFreqHz: num(f.espRefFreqHz) ?? 60, points } };
  }
  return { pump: null };
}

const espOpts = (f) => ({
  stages: num(f.espStages) ?? 100,
  freqHz: num(f.espFreqHz) ?? 50,
  wearFactor: num(f.espWearFactor) ?? 0,
  sepEffPct: num(f.espSepEffPct) ?? 95,
  minIntakePsi: num(f.espMinIntakePsi) ?? 300,
});

/** Full ESP solve: coupled dP, traverse match at the intake, pump curves
 *  for the chart, and the results block shown beside. */
export function oilEsp(f) {
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const bp = buildEspPump(f);
  if (bp.error) return bp;
  if (!bp.pump) return { error: 'select a pump from the database or enter a custom curve (Manual ΔP uses Solve well)' };
  const opts = espOpts(f);
  const op = espOperatingPoint(cfg, ipr, bp.pump, opts);
  if (op.status !== 'ok')
    return { error: `no traverse match found (closest residual ${op.minAbsR?.toFixed(1)} psi at ${op.atQ?.toFixed(0)} stb/d) — check PI/Pres, stages or frequency`, opStatus: op.status };
  const freqs = [30, 35, 40, 45, 50, 55, 60];
  const family = freqs.map((hz) => ({
    freqHz: hz,
    points: pumpCurveAt(bp.pump, { ...opts, freqHz: hz }),
  }));
  const thrustLines = ['down', 'bep', 'up'].map((k) => ({
    key: k,
    points: freqs.map((hz) => {
      const fr = hz / bp.pump.refFreqHz;
      const p = bp.pump.points[THRUST[k]];
      return { rateBpd: p.rateBpd * fr, headFt: p.headFt * opts.stages * fr * fr * (1 - opts.wearFactor) };
    }),
  }));
  // FINAL model-match charts: IPR vs the coupled ESP-VLP + wellhead curve
  const oilFrac = 1 - cfg.wcPct / 100;
  const cap = Math.min(qMaxGross(ipr) * oilFrac * 0.98, 10000);
  const rates = oilRateGrid(Math.max(cap * 0.05, 50), cap);
  const vlpCurve = rates.map((q) => {
    const s = espSolveDp({ ...cfg, qOilStbD: q }, bp.pump, opts);
    return { q, pwfPsi: s.march.pwfPsi, whtF: s.march.whtF };
  });
  const whpCurve = vlpCurve.map((p) => {
    const pwfIpr = pwfAtQGross(p.q / oilFrac, ipr);
    return { q: p.q, whpPsi: pwfIpr - p.pwfPsi + cfg.thpPsi, pwfIprPsi: pwfIpr, pwfVlpPsi: p.pwfPsi, whtF: p.whtF };
  });
  return {
    op,
    pump: { name: bp.pump.name, refFreqHz: bp.pump.refFreqHz },
    opts,
    family,
    thrustLines,
    opPoint: { rateBpd: op.state.qGrossPumpBpd, headFt: op.headFt },
    iprCurve: iprCurve(ipr, { wcPct: cfg.wcPct }),
    vlpCurve,
    whpCurve,
    measured: {
      pintPsi: num(f.espMeasPintPsi) ?? null,
      pdisPsi: num(f.espMeasPdisPsi) ?? null,
      pumpTvdFt: (num(f.pumpTvdM) ?? 0) * 3.281,
    },
    pbPsi: pb,
    prPsi: ipr.prPsi,
    j: ipr.j,
  };
}

/** ESP Pres sensitivity: each future Pres gets the Darcy future J, then a
 *  FULL coupled ESP solve — the solved node and the ESP data at that node. */
export function oilEspSens(f) {
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const bp = buildEspPump(f);
  if (bp.error) return bp;
  if (!bp.pump) return { error: 'select a pump first' };
  const opts = espOpts(f);
  const pvt = oilPvtBundle(cfg, pb);
  const rsCur = solutionGorScfStb(ipr.prPsi, pvt);
  const presList = (f.presList ?? []).map(num).filter((p) => p != null && p > 0);
  const list = presList.length ? presList : [0.9, 0.8, 0.7].map((x) => ipr.prPsi * x);
  const cases = list.map((presPsi, i) => {
    const fj = futureOilJ(presPsi, { darcy: ipr.darcy, pvt, rsCurScfStb: rsCur });
    const rec = { ...withCurrentPr(ipr, presPsi), j: fj.j, jDarcy: fj.j, jSource: 'darcy' };
    const op = espOperatingPoint(cfg, rec, bp.pump, opts);
    return {
      label: `Pres${i + 1}=${Math.round(presPsi)} psi`,
      presPsi,
      j: fj.j,
      iprCurve: iprCurve(rec, { wcPct: cfg.wcPct }),
      opStatus: op.status,
      op:
        op.status === 'ok'
          ? {
              qOilStbD: op.qOilStbD,
              pwfPsi: op.pwfTraversePsi,
              pintPsi: op.pintTraversePsi,
              pdisPsi: op.pdisPsi,
              dpPsi: op.dpPsi,
              headFt: op.headFt,
              whtF: op.whtF,
              freeGasPct: op.state.freeGasPct,
              qGrossPumpBpd: op.state.qGrossPumpBpd,
              gradPsiFt: op.state.gradPsiFt,
              thrust: op.thrust.status,
            }
          : null,
    };
  });
  return { cases, pump: { name: bp.pump.name }, opts, basePrPsi: ipr.prPsi };
}

/** First run: match the stage count of the selected pump (new pump, wear 0). */
export function oilEspStages(f) {
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const bp = buildEspPump(f);
  if (bp.error) return bp;
  if (!bp.pump) return { error: 'select a pump first' };
  const q = num(f.testQOilStbD) ?? num(f.qOilStbD);
  if (!(q > 0)) return { error: 'enter a test oil rate' };
  try {
    const m = matchStages(cfg, ipr, bp.pump, {
      freqHz: num(f.espFreqHz) ?? 50,
      sepEffPct: num(f.espSepEffPct) ?? 95,
      testQOilStbD: q,
      minIntakePsi: num(f.espMinIntakePsi) ?? 300,
    });
    return { ...m, testQOilStbD: q };
  } catch (e) {
    return { error: e.message };
  }
}

/** Later life: wear from the measured Pint/Pdis couple + PI at constant
 *  Pres (the matched K carries the PI into the Darcy record). */
export function oilEspWear(f) {
  const cfg = buildOilCfg(f);
  const pb = oilPb(f, cfg);
  const ipr = buildOilIpr(f, cfg, pb);
  const bp = buildEspPump(f);
  if (bp.error) return bp;
  if (!bp.pump) return { error: 'select a pump first' };
  const pint = num(f.espMeasPintPsi);
  const pdis = num(f.espMeasPdisPsi);
  if (pint == null || pdis == null) return { error: 'enter the measured Pint AND Pdis' };
  if (!(pdis > pint)) return { error: 'measured Pdis must exceed Pint' };
  const opts = espOpts(f);
  try {
    const m = matchWearAndPi(cfg, ipr, bp.pump, {
      stages: opts.stages,
      freqHz: opts.freqHz,
      sepEffPct: opts.sepEffPct,
      measPintPsi: pint,
      measPdisPsi: pdis,
      qOilStbD: num(f.testQOilStbD) ?? num(f.qOilStbD),
    });
    const pvt = oilPvtBundle(cfg, pb);
    const darcy = oilDarcyAtPr(f, pvt, ipr.prPsi);
    const matchedPermMd = permFromJOil({ ...darcy, permMd: undefined, j: m.jMatched });
    return { ...m, matchedPermMd, prPsi: ipr.prPsi };
  } catch (e) {
    return { error: e.message };
  }
}

export function skinGuidance() {
  return { guidance: SKIN_GUIDANCE };
}

export const handlers = {
  'oil/nodal': oilNodal,
  'oil/calibrate': oilCalibrate,
  'oil/sensitivity': oilSensitivity,
  'oil/gaslift': oilGasLift,
  'oil/reserve': oilReserve,
  'oil/forecast': oilForecastApi,
  'water/injector': waterInjector,
  'water/injcalibrate': waterInjCalibrate,
  'esp/pumps': espPumps,
  'oil/esp': oilEsp,
  'oil/espstages': oilEspStages,
  'oil/espwear': oilEspWear,
  'oil/espsens': oilEspSens,
  'gas/nodal': gasNodal,
  'gas/calibrate': gasCalibrate,
  'gas/sensitivity': gasSensitivity,
  'gas/reserve': gasReserve,
  'gas/forecast': gasForecastApi,
  'skin-guidance': skinGuidance,
};
