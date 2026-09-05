// ESP stack — Oil well model_ESP_V5.01 port. The pump catalog lives in the
// background (esp-catalog.js, 68 pumps verbatim); a custom pump curve is an
// equally valid input.
//
// Pump math (ESP sheet): per-stage head x stages at the reference frequency,
// affinity to the operating frequency (head x (f/f0)^2, rate x f/f0), wear
// applied as x(1-wear); theoretical head read from the operating curve at
// Qgross @ PUMP conditions; dP = head x composite gradient at the pump.
//
// Intake gas & separator (BHP AU:BL 63-69, quirks preserved): at intake P,T
// the TOTAL gas (free + solution counted as vapor) loads the pump when no
// separator; the separator removes its efficiency cut of that total. Water
// volume carries the sheet's x1.01 factor. The gas separator is default ON.
//
// The match couple (user directive): Pres is USER JUDGMENT, held constant;
// the traverses must meet at the pump — bottom-up (Pwf from the IPR marched
// up to the intake) equals top-down (THP marched down through the pump).
// PI is the IPR match factor; the FIRST run matches the STAGE COUNT of the
// selected pump at wear = 0 (new pump); wear is matched later so the dP
// across the pump reproduces a measured Pint/Pdis couple.

import { brent } from '../solvers/brent.js';
import {
  oilMarch,
  espBackMarch,
  deriveOilFlow,
  resolveOilPvt,
  oilFraction,
} from './oil-march.js';
import { pwfAtQGross, jFromTest, qMaxGross } from '../ipr/oil-ipr.js';
import { solutionGorScfStb, oilFvf } from '../pvt/oil.js';
import { zFactorBrillBeggs } from '../pvt/gas.js';
import { AIR_LB_PER_SCF, LIQ_LB_PER_FT3 } from './common.js';
import { THRUST } from './esp-catalog.js';

/** Operating curve: total head vs rate at stages/frequency/wear.
 *  pump: { refFreqHz, points: [{headFt, rateBpd}] } (per-stage). */
export function pumpCurveAt(pump, { stages, freqHz, wearFactor = 0 }) {
  const fr = freqHz / pump.refFreqHz;
  return pump.points.map((p) => ({
    rateBpd: p.rateBpd * fr,
    headFt: p.headFt * stages * fr * fr * (1 - wearFactor),
  }));
}

/** Head at a rate on an operating curve — linear interpolation (the sheet's
 *  fraction interp), end-segment extrapolation floored at zero. */
export function headAtRateFt(curve, qBpd) {
  const pts = curve;
  if (qBpd <= pts[0].rateBpd) return pts[0].headFt;
  for (let i = 1; i < pts.length; i++) {
    if (qBpd <= pts[i].rateBpd) {
      const w = (qBpd - pts[i - 1].rateBpd) / (pts[i].rateBpd - pts[i - 1].rateBpd);
      return pts[i - 1].headFt + w * (pts[i].headFt - pts[i - 1].headFt);
    }
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const w = (qBpd - a.rateBpd) / (b.rateBpd - a.rateBpd);
  return Math.max(a.headFt + w * (b.headFt - a.headFt), 0);
}

/** Thrust window at the operating frequency (limits scale with f/f0). */
export function thrustStatus(pump, freqHz, qBpd) {
  const fr = freqHz / pump.refFreqHz;
  const down = pump.points[THRUST.down].rateBpd * fr;
  const up = pump.points[THRUST.up].rateBpd * fr;
  if (qBpd < down) return { status: 'down-thrust', downBpd: down, upBpd: up };
  if (qBpd > up) return { status: 'up-thrust', downBpd: down, upBpd: up };
  return { status: 'ok', downBpd: down, upBpd: up };
}

/**
 * Fluid state at the pump intake (BHP AU:BL 63-69, quirks verbatim).
 * Returns volumes (bbl/d), the composite gradient (psi/ft), Qgross @ pump
 * with and without separation, and the free-gas diagnostics.
 */
export function espIntakeState(cfg, { pIntakePsi, tIntakeF, sepEffPct }) {
  const flow = deriveOilFlow(cfg);
  const pvt = resolveOilPvt(cfg, tIntakeF);
  // A Water Well is the oil march at its limiting case (fluid:'water',
  // API 10, WC 100), and on that tab cfg.qOilStbD carries the GROSS WATER
  // rate, not an oil rate — deriveOilFlow encodes exactly that: qo = 0,
  // qw = cfg.qOilStbD. Reading cfg.qOilStbD here as oil counted the water a
  // SECOND time as a phantom oil phase, so the pump curve was read at ~2x
  // the real rate (head 169 ft instead of 5608 ft on the demo, and a false
  // up-thrust). Found 31 Aug 2026; the oil tabs were never affected.
  const qo = cfg.fluid === 'water' ? 0 : cfg.qOilStbD;
  const rs = solutionGorScfStb(pIntakePsi, pvt);
  const bo = oilFvf(pIntakePsi, pvt);
  const z = zFactorBrillBeggs(pIntakePsi / pvt.ppc, (tIntakeF + 460) / pvt.tpc).z;
  const bgBblScf = ((0.0283 * z * (tIntakeF + 460)) / (pIntakePsi + 14.5)) / 5.615;
  const vw = flow.qw * 1.01; // BC65 quirk
  const vo = qo * bo;
  const freeGasBbl = Math.max(cfg.gorScfStb - rs, 0) * qo * bgBblScf;
  const solnVaporBbl = Math.min(rs, cfg.gorScfStb) * qo * bgBblScf;
  const totalGasBbl = freeGasBbl + solnVaporBbl; // BB65: ALL gas as vapor
  const sep = sepEffPct ?? 0;
  const gasEffBbl = sep > 0 ? totalGasBbl * (1 - sep / 100) : totalGasBbl;
  const vtNoSep = vw + vo + totalGasBbl;
  const vt = vw + vo + gasEffBbl;
  const freeGasPct = (freeGasBbl / vtNoSep) * 100; // BE65 / X24
  const freeGasSepBbl = freeGasBbl * (1 - sep / 100); // AZ69
  const freeGasPctSep = (freeGasSepBbl / vt) * 100; // BE69
  // the sheet's BE74: the tubing GLR is cut by the free-gas-fraction
  // reduction the separator achieves (percentage POINTS, BE65 - BE69)
  const sepCutPct = freeGasPct - freeGasPctSep;
  // masses (BHP S17/S18/S19). SHEET QUIRK kept: the no-separator row's gas
  // mass BI65 = S18 = 0.0765*gg*P10 — the SEPARATED tubing gas — while the
  // separator row's BI69 uses the post-separation total vapor as scf.
  const massW = flow.qw * (cfg.waterSg ?? 1.05) * LIQ_LB_PER_FT3 * 5.615;
  const massO = qo * (141.5 / (131.5 + cfg.api)) * LIQ_LB_PER_FT3 * 5.615;
  const gasScfTotal = qo * cfg.gorScfStb;
  const tubingGasScf = gasScfTotal * (1 - sepCutPct / 100); // P10
  const massGNoSep = AIR_LB_PER_SCF * cfg.gasSg * tubingGasScf; // BI65 = S18
  const massGSep = AIR_LB_PER_SCF * cfg.gasSg * gasScfTotal * (1 - sep / 100); // BI69
  const gradOf = (mass, v) => ((mass / v / 5.615) / 62.42) * 0.433; // BL col
  const gradNoSepPsiFt = gradOf(massW + massO + massGNoSep, vtNoSep); // BL65 / BJ38
  const gradSepPsiFt = gradOf(massW + massO + massGSep, vt); // BL69
  return {
    rs, bo, z, bgBblScf,
    vwBbl: vw, voBbl: vo, freeGasBbl, totalGasBbl,
    qGrossPumpBpd: vt,
    qGrossPumpNoSepBpd: vtNoSep,
    freeGasPct,
    freeGasPctSep,
    sepCutPct,
    sepRequired: freeGasPct > 10, // BF65 rule (>10% -> separator required)
    gradNoSepPsiFt,
    gradSepPsiFt,
    gradPsiFt: sep > 0 ? gradSepPsiFt : gradNoSepPsiFt, // BJ39 switch
  };
}

/** March config with the pump dP and the SEPARATED tubing gas (sheet P10 =
 *  total gas x (1 - BE74/100), BE74 from the intake state). */
const espCfg = (cfg, dpPsi, tubingGasScfD) => ({
  ...cfg,
  esp: {
    ...cfg.esp,
    pumpDpPsi: dpPsi,
    tubingGasScfD: tubingGasScfD ?? cfg.qOilStbD * cfg.gorScfStb,
  },
});

/**
 * The coupled dP solve at a GIVEN rate (Excel's iterative calculation):
 * dP -> march -> intake P,T -> Qgross@pump & gradient -> head(curve) ->
 * dP', to convergence. Returns { dpPsi, march, state, headFt }.
 */
export function espSolveDp(cfg, pump, { stages, freqHz, wearFactor = 0, sepEffPct = 95, pwfIprPsi = null }) {
  const curve = pumpCurveAt(pump, { stages, freqHz, wearFactor });
  let dp = curve[THRUST.bep].headFt * 0.35; // sane start: BEP head x typical gradient
  let tubingGas = cfg.qOilStbD * cfg.gorScfStb; // first pass: no separation
  let out = null;
  for (let k = 0; k < 60; k++) {
    const c = espCfg(cfg, dp, tubingGas);
    const m = oilMarch(c);
    const pumpIdx = m.stations.findIndex((s) => s.pPsi === m.intakePsi);
    const tPump = m.stations[pumpIdx >= 0 ? pumpIdx : m.stations.length - 3].tF; // N65 = N49
    // sheet rows 63-69 evaluate the intake state at the IPR-side back-march
    // intake M65 = max(D65, 100) (equal to the top-down intake once the
    // traverses match); without an IPR anchor, the top-down intake is used
    let pip = null;
    if (pwfIprPsi != null) pip = espBackMarch(c, pwfIprPsi).pipPsi;
    const stateP = Math.max(pip ?? m.intakePsi, 100); // M65 floor
    const state = espIntakeState(cfg, { pIntakePsi: stateP, tIntakeF: tPump, sepEffPct });
    const headFt = headAtRateFt(curve, state.qGrossPumpBpd);
    const dpNew = headFt * state.gradPsiFt;
    const tubingGasNew = cfg.qOilStbD * cfg.gorScfStb * (1 - state.sepCutPct / 100); // P10/BE74
    out = { dpPsi: dpNew, tubingGasScfD: tubingGasNew, march: m, state, headFt, pipIprPsi: pip };
    if (Math.abs(dpNew - dp) < 1e-6 && Math.abs(tubingGasNew - tubingGas) < 1e-3) {
      return { ...out, converged: true };
    }
    dp = dp + 0.7 * (dpNew - dp); // light damping
    tubingGas = tubingGasNew;
  }
  return { ...out, converged: false };
}

/**
 * ESP operating point: the rate at which the bottom-up traverse (Pwf from
 * the IPR at CONSTANT Pres, marched up to the intake) meets the top-down
 * one (THP down through the pump with the coupled dP).
 */
/**
 * The pump's complete state AT A SOLVED NODE — the numbers an engineer
 * signs off on: what the pump is, how it is run, what it delivers there,
 * and whether the duty point is inside its envelope.
 *
 * Hydraulic horsepower is the fluid power the pump adds:
 *   HHP = q[bbl/d] * dP[psi] / 58766   (58766 = 1 hp in bbl-psi/day)
 * Shaft/motor power needs the pump's efficiency curve, which the workbook
 * database does not carry — so only the hydraulic duty is reported.
 */
export function espSolutionPoint(pump, opts, solve) {
  const th = thrustStatus(pump, opts.freqHz, solve.state.qGrossPumpBpd);
  const fr = opts.freqHz / pump.refFreqHz;
  return {
    pumpName: pump.name,
    stages: opts.stages,
    freqHz: opts.freqHz,
    refFreqHz: pump.refFreqHz,
    wearFactor: opts.wearFactor ?? 0,
    sepEffPct: opts.sepEffPct ?? 0,
    headFt: solve.headFt,
    headPerStageFt: opts.stages > 0 ? solve.headFt / opts.stages : null,
    dpPsi: solve.dpPsi,
    qGrossPumpBpd: solve.state.qGrossPumpBpd,
    qGrossPumpNoSepBpd: solve.state.qGrossPumpNoSepBpd,
    gradPsiFt: solve.state.gradPsiFt,
    freeGasPct: solve.state.freeGasPct,
    freeGasPctSep: solve.state.freeGasPctSep,
    sepRequired: solve.state.sepRequired ?? null,
    thrust: th.status,
    thrustDownBpd: th.downBpd,
    thrustBepBpd: pump.points[THRUST.bep].rateBpd * fr,
    thrustUpBpd: th.upBpd,
    hydraulicHp: (solve.state.qGrossPumpBpd * solve.dpPsi) / 58766,
    dpConverged: solve.converged ?? null,
  };
}

export function espOperatingPoint(cfg, ipr, pump, opts) {
  const oilFrac = oilFraction(cfg);
  const R = (q) => {
    const c = { ...cfg, qOilStbD: q };
    const pwfIpr = pwfAtQGross(q / oilFrac, ipr);
    if (!(pwfIpr > 0)) return { r: NaN };
    // the IPR anchor rides inside the dP fixed point (sheet rows 63-69
    // evaluate the intake state at the back-march intake M65)
    const sol = espSolveDp(c, pump, { ...opts, pwfIprPsi: pwfIpr });
    return { r: sol.march.intakePsi - sol.pipIprPsi, sol, pwfIpr, pipIpr: sol.pipIprPsi };
  };
  const qMax = Math.min(qMaxGross(ipr) * oilFrac * 0.98, 12000);
  // A degenerate IPR (no Pres, no PI, no geometry) gives a NaN open-flow
  // potential. Everything downstream is then NaN, so say so here rather than
  // reporting a NaN residual at a NaN rate and implicating the pump.
  if (!Number.isFinite(qMax) || qMax <= 0) return { status: 'no-ipr' };
  const qMin = Math.max(qMax * 0.02, 50);
  const n = 15;
  const qs = [];
  for (let i = 0; i <= n; i++) qs.push(qMin + ((qMax - qMin) * i) / n);
  const rs = qs.map((q) => R(q).r);
  let root = null;
  for (let i = 1; i <= n; i++) {
    if (Number.isNaN(rs[i - 1]) || Number.isNaN(rs[i])) continue;
    if (rs[i - 1] * rs[i] <= 0) {
      root = brent((q) => R(q).r, qs[i - 1], qs[i], { tol: 1e-4 }).root; // highest crossing kept
    }
  }
  if (root == null) {
    // pick the closest residual among the FINITE ones only -- comparing NaNs
    // silently leaves best at 0 and reports that NaN as the answer
    let best = -1;
    for (let i = 0; i < rs.length; i++)
      if (Number.isFinite(rs[i]) && (best < 0 || Math.abs(rs[i]) < Math.abs(rs[best]))) best = i;
    if (best < 0) return { status: 'no-ipr' }; // the IPR gave no flowing pressure at any rate
    return { status: 'no-match', minAbsR: rs[best], atQ: qs[best] };
  }
  const fin = R(root);
  const m = fin.sol.march;
  const th = thrustStatus(pump, opts.freqHz, fin.sol.state.qGrossPumpBpd);
  const back = espBackMarch(
    espCfg({ ...cfg, qOilStbD: root }, fin.sol.dpPsi, fin.sol.tubingGasScfD),
    fin.pwfIpr
  );
  const minIntakePsi = opts.minIntakePsi ?? 300;
  return {
    backStations: back.stations.map((s) => ({ tvdFt: s.tvdFt, pPsi: s.pPsi })),
    designFloor: { minIntakePsi, ok: m.intakePsi >= minIntakePsi },
    status: 'ok',
    qOilStbD: root,
    qGrossStbD: root / oilFrac,
    pwfTraversePsi: m.pwfPsi,
    pwfIprPsi: fin.pwfIpr,
    pintTraversePsi: m.intakePsi,
    pintIprPsi: fin.pipIpr,
    pdisPsi: m.dischargePsi,
    dpPsi: fin.sol.dpPsi,
    headFt: fin.sol.headFt,
    whtF: m.whtF,
    state: fin.sol.state,
    thrust: th,
    stations: m.stations.map((s) => ({ tvdFt: s.tvdFt, pPsi: s.pPsi })),
    dpConverged: fin.sol.converged,
  };
}

/**
 * FIRST-RUN stage match (user directive): new pump, wear = 0 — solve the
 * stage count so the traverses meet at the KNOWN test rate. Pint(IPR) is
 * stage-independent; Pint(traverse) falls as stages (dP) grow.
 */
export function matchStages(cfg, ipr, pump, { freqHz, sepEffPct = 95, testQOilStbD, testPwfPsi = null, minIntakePsi = 300 }) {
  const c = { ...cfg, qOilStbD: testQOilStbD };
  const oilFrac = oilFraction(cfg);
  // Pwf at the test point: calculated from the IPR at the test rate (the
  // greyed cell) unless the user typed a measured value, which then anchors
  // the traverse match instead — the workbook pattern, macro-written cell,
  // user-overwritable.
  const pwfIpr = testPwfPsi ?? pwfAtQGross(testQOilStbD / oilFrac, ipr);
  if (!(pwfIpr > 0)) throw new Error('matchStages: test rate exceeds the IPR AOF');
  const solveAt = (stages) =>
    espSolveDp(c, pump, { stages, freqHz, wearFactor: 0, sepEffPct, pwfIprPsi: pwfIpr });
  const R = (stages) => {
    const sol = solveAt(stages);
    return sol.march.intakePsi - sol.pipIprPsi;
  };
  // too few stages -> small dP -> high traverse intake -> R > 0; the FIRST
  // downward crossing is the physical stage count (far off-curve states can
  // create spurious high-stage roots)
  const grid = [];
  // The floor was 5 until 31 Aug 2026. A low stage count is a real answer —
  // a booster on a well that nearly flows unaided needs only a handful — and
  // the floor was reporting those as "no match". It surfaced when the water
  // double-count was fixed: the strong test well (Pri 4800, natural flow
  // 1836 stb/d) matches 2000 stb/d at ~3 stages, and had only appeared to
  // need more because the phantom oil phase doubled the pump loading.
  for (let s = 1; s <= 800; s = Math.round(s * 1.25) + 1) grid.push(s);
  let prevS = grid[0];
  let prevR = R(prevS);
  for (let i = 1; i < grid.length; i++) {
    const r = R(grid[i]);
    if (prevR > 0 && r <= 0) {
      const { root } = brent(R, prevS, grid[i], { tol: 1e-4 });
      // DESIGN PROOF (user directive): the designed stage count must keep
      // every stage-dependent march pressure above the floor — the minimum
      // sits at the pump intake (above the pump the profile is THP-fixed;
      // below it pressures rise), so the proof binds there
      const intakeAtMatch = solveAt(root).march.intakePsi;
      if (intakeAtMatch >= minIntakePsi) {
        return {
          stagesExact: root,
          stages: Math.round(root),
          pwfIprPsi: pwfIpr,
          intakePsi: intakeAtMatch,
          minIntakePsi,
          designOk: true,
          capped: false,
        };
      }
      // intake would dip under the floor: cap the design at the stage
      // count where intake == floor (intake falls as stages grow)
      const g = (stages) => solveAt(stages).march.intakePsi - minIntakePsi;
      const { root: cap } = brent(g, 5, root, { tol: 1e-4 });
      return {
        stagesExact: cap,
        stages: Math.floor(cap),
        stagesMatchExact: root,
        stagesMatch: Math.round(root),
        pwfIprPsi: pwfIpr,
        intakePsi: solveAt(Math.floor(cap)).march.intakePsi,
        minIntakePsi,
        designOk: true,
        capped: true,
      };
    }
    prevS = grid[i];
    prevR = r;
  }
  // Nothing crossed. Before sending the user off to adjust the reservoir
  // inputs, rule out the one cause no stage count can fix: a duty point
  // past the RIGHT-HAND END of the pump curve. headAtRateFt floors
  // extrapolated head at zero, so beyond the last catalog point the pump
  // develops no head at ANY stage count and the traverses can never meet.
  // The remedy is a bigger pump, a higher frequency or a lower rate — never
  // PI or Pres, which is exactly where this message used to point.
  const fr = freqHz / pump.refFreqHz;
  const qCurveMaxBpd = pump.points[pump.points.length - 1].rateBpd * fr;
  const qDutyBpd = solveAt(grid[0]).state.qGrossPumpBpd;
  if (qDutyBpd > qCurveMaxBpd)
    throw new Error(
      `matchStages: ${pump.name} cannot pass this rate. The test point puts ` +
        `${qDutyBpd.toFixed(0)} bbl/d through the pump, past the ` +
        `${qCurveMaxBpd.toFixed(0)} bbl/d end of its curve at ${freqHz} Hz, where it ` +
        `develops no head at any stage count. Choose a larger pump, raise the ` +
        `frequency, or lower the test rate.`
    );
  throw new Error('matchStages: no stage count in [1, 800] closes the traverse match — check PI/Pres and the test rate');
}

/**
 * Wear + PI match from a measured Pint/Pdis couple (user directive):
 * wear = 1 - dP(measured)/dP(theoretical at the measured intake state);
 * PI from the target Pwf that back-marches down from the measured Pint,
 * with Pres kept CONSTANT (user judgment).
 */
export function matchWearAndPi(cfg, ipr, pump, {
  stages, freqHz, sepEffPct = 95, measPintPsi, measPdisPsi, qOilStbD,
}) {
  const c = { ...cfg, qOilStbD };
  // temperature at the pump from the current march settings
  const sol0 = espSolveDp(c, pump, { stages, freqHz, wearFactor: 0, sepEffPct });
  const pumpIdx = sol0.march.stations.findIndex((s) => s.pPsi === sol0.march.intakePsi);
  const tPump = sol0.march.stations[pumpIdx >= 0 ? pumpIdx : sol0.march.stations.length - 3].tF;
  const state = espIntakeState(c, { pIntakePsi: measPintPsi, tIntakeF: tPump, sepEffPct });
  const curve0 = pumpCurveAt(pump, { stages, freqHz, wearFactor: 0 });
  const dpTheo = headAtRateFt(curve0, state.qGrossPumpBpd) * state.gradPsiFt;
  const dpMeas = measPdisPsi - measPintPsi;
  const wearFactor = 1 - dpMeas / dpTheo;
  // PI: Pwf* such that the bottom-up march from Pwf* reaches the measured
  // Pint, then the general equation at CONSTANT Pres gives J
  const cE = espCfg(c, dpMeas, qOilStbD * cfg.gorScfStb * (1 - state.sepCutPct / 100));
  const g = (pwf) => espBackMarch(cE, pwf).pipPsi - measPintPsi;
  const { root: pwfTarget } = brent(g, Math.max(measPintPsi * 0.6, 60), measPintPsi * 2 + 500, { tol: 1e-7 });
  const oilFrac = oilFraction(cfg);
  const jMatched = jFromTest({
    qGrossStbD: qOilStbD / oilFrac,
    pwfPsi: pwfTarget,
    priPsi: ipr.prPsi, // Pres constant — the working reservoir pressure
    pbPsi: ipr.pbPsi,
  });
  return { wearFactor, dpMeasPsi: dpMeas, dpTheoPsi: dpTheo, pwfTargetPsi: pwfTarget, jMatched, freeGasPct: state.freeGasPct };
}

/**
 * Separator-efficiency match from a measured Pint/Pdis couple — the wear
 * match's sibling: the SAME observation (dP = Pdis - Pint) solving a DIFFERENT
 * unknown. Wear is HELD (the input; 0 = new pump) and the separator efficiency
 * eta is solved so the theoretical dP at the measured intake state reproduces
 * the measured dP. One measured dP fixes one unknown — never both.
 *
 * dP is monotonic in eta (the separator's cut shrinks Qgross@pump, so the head
 * is read lower on the curve, AND removes gas from the mixture, so the
 * composite gradient rises; dP = head x gradient), so Brent on [0, 100] is
 * sound; eta enters non-linearly, unlike wear's closed-form ratio.
 *
 * Returns the solved eta, the full sweep (dP vs eta), the gas-lock boundary
 * (the eta below which Qgross@pump runs off the curve and the pump delivers no
 * head), the free gas before/after separation, the PI from a Pwf measured at
 * the perfs when given (the back-march from Pint is then a consistency check),
 * and a plain-words diagnosis for the out-of-range cases: a measured dP above
 * the eta = 100 curve cannot be gas (stages / frequency / PI); below the
 * eta = 0 curve it is wear, or worse.
 *
 * Above bubble point the sheet's vapour accounting still yields an eta effect
 * (quirk preserved); the match is allowed there and freeGasPct says how much
 * TRUE free gas is present.
 */
export function matchSepEff(cfg, ipr, pump, {
  stages, freqHz, wearFactor = 0, measPintPsi, measPdisPsi, qOilStbD,
  testPwfPsi = null, sweepStepPct = 5,
}) {
  const c = { ...cfg, qOilStbD };
  const dpMeas = measPdisPsi - measPintPsi;
  // temperature at the pump from the current march settings (as the wear match)
  const sol0 = espSolveDp(c, pump, { stages, freqHz, wearFactor, sepEffPct: 95 });
  const pumpIdx = sol0.march.stations.findIndex((s) => s.pPsi === sol0.march.intakePsi);
  const tPump = sol0.march.stations[pumpIdx >= 0 ? pumpIdx : sol0.march.stations.length - 3].tF;
  const curve = pumpCurveAt(pump, { stages, freqHz, wearFactor }); // wear HELD
  const stateAt = (eta) => espIntakeState(c, { pIntakePsi: measPintPsi, tIntakeF: tPump, sepEffPct: eta });
  const dpAt = (eta) => { const s = stateAt(eta); return headAtRateFt(curve, s.qGrossPumpBpd) * s.gradPsiFt; };

  // the sweep — the explicit view of how dP answers to eta
  const sweep = [];
  for (let eta = 0; eta <= 100 + 1e-9; eta += sweepStepPct) {
    const s = stateAt(eta);
    sweep.push({ sepEffPct: eta, dpPsi: headAtRateFt(curve, s.qGrossPumpBpd) * s.gradPsiFt, qGrossPumpBpd: s.qGrossPumpBpd, freeGasPctSep: s.freeGasPctSep });
  }
  const dp0 = dpAt(0), dp100 = dpAt(100);
  const dpLo = Math.min(dp0, dp100), dpHi = Math.max(dp0, dp100);

  // gas-lock boundary: the eta below which the pump delivers no head, refined by
  // bisection between the last zero-dP sweep point and the first positive one
  let gasLockBelowPct = null;
  {
    let lastZero = -1, firstPos = -1;
    for (let i = 0; i < sweep.length; i++) { if (sweep[i].dpPsi > 1e-9) { firstPos = i; break; } lastZero = i; }
    if (firstPos < 0) gasLockBelowPct = 100; // no head at ANY separation
    else if (lastZero >= 0) {
      let lo = sweep[lastZero].sepEffPct, hi = sweep[firstPos].sepEffPct;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (dpAt(mid) <= 1e-9) lo = mid; else hi = mid; }
      gasLockBelowPct = hi;
    }
  }

  // solve, or name why it cannot
  let status, sepEffPct = null, gapPsi = 0;
  if (dpMeas > dpHi) { status = 'above-range'; gapPsi = dpMeas - dpHi; }
  else if (dpMeas < dpLo) { status = 'below-range'; gapPsi = dpMeas - dpLo; }
  else {
    const { root } = brent((e) => dpAt(e) - dpMeas, 0, 100, { tol: 1e-6 });
    sepEffPct = root; status = 'ok';
  }
  const etaUsed = sepEffPct ?? (dpMeas > dpHi ? (dp100 >= dp0 ? 100 : 0) : (dp0 <= dp100 ? 0 : 100));
  const state = stateAt(etaUsed);
  const nearGasLock = status === 'ok' && gasLockBelowPct != null && gasLockBelowPct < 100 && (sepEffPct - gasLockBelowPct) < 5;

  // PI: Pwf* such that the bottom-up march from Pwf* reaches the measured Pint,
  // using the matched separation for the tubing gas (as the wear match does)
  const cE = espCfg(c, dpMeas, qOilStbD * cfg.gorScfStb * (1 - state.sepCutPct / 100));
  const g = (pwf) => espBackMarch(cE, pwf).pipPsi - measPintPsi;
  const { root: pwfBackPsi } = brent(g, Math.max(measPintPsi * 0.6, 60), measPintPsi * 2 + 500, { tol: 1e-7 });
  const oilFrac = oilFraction(cfg);
  // a Pwf measured at the perfs is the better PI anchor; the back-march then
  // becomes a consistency check on the below-pump gradient / gauge data
  const pwfForJ = testPwfPsi ?? pwfBackPsi;
  const jMatched = jFromTest({ qGrossStbD: qOilStbD / oilFrac, pwfPsi: pwfForJ, priPsi: ipr.prPsi, pbPsi: ipr.pbPsi });

  const f0 = (v) => Math.round(v);
  let diagnosis =
    status === 'ok'
      ? `Separator efficiency ${sepEffPct.toFixed(1)} % reproduces the measured dP of ${f0(dpMeas)} psi with wear held at ${wearFactor}.`
      : status === 'above-range'
        ? `Even perfect separation (100 %) delivers only ${f0(dpHi)} psi against a measured ${f0(dpMeas)} psi — a ${f0(gapPsi)} psi surplus gas cannot explain. Check stages, frequency or PI, not the separator.`
        : `Even with no separation (0 %) the pump delivers ${f0(dpLo)} psi against a measured ${f0(dpMeas)} psi — a ${f0(-gapPsi)} psi shortfall gas cannot explain. That is wear (or worse), not the separator.`;
  if (nearGasLock)
    diagnosis += ` Note: the match sits within 5 points of the gas-lock threshold (${gasLockBelowPct.toFixed(1)} %) — a small loss of separation would stall the pump.`;

  return {
    status, sepEffPct, wearHeld: wearFactor,
    dpMeasPsi: dpMeas, dpAtEta0Psi: dp0, dpAtEta100Psi: dp100, gapPsi,
    sweep, gasLockBelowPct, nearGasLock,
    tPumpF: tPump,
    freeGasPct: state.freeGasPct, // TRUE free gas at the intake, before separation
    freeGasPctSep: state.freeGasPctSep, // after the matched separation
    qGrossPumpBpd: state.qGrossPumpBpd,
    intakeAbovePb: cfg.pbPsi != null ? measPintPsi >= cfg.pbPsi : null,
    pwfBackPsi, testPwfPsi,
    pwfCheckPsi: testPwfPsi != null ? pwfBackPsi - testPwfPsi : null, // back-march minus measured
    pwfUsedForJ: pwfForJ, jMatched,
    diagnosis,
  };
}
