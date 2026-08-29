// Tarner saturation-tracking oil forecast — workbook "Tarner" sheet port.
// Per time step the sheet GoalSeeks two residuals (macro loops the pair 5x):
//   AE: Gp integrated over Np with the trapezoid of the producing GOR must
//       equal Gp from the material balance          -> solved by pressure P
//   AF: the assumed oil saturation must equal the MB saturation
//       So_MB = (1-Swi)*(N-Np)*Bo / (N*Boi*(1-ct*dp)) -> solved by So
// WellSim alternates the same two updates deterministically to convergence
// (So by direct substitution, P by Brent).
//
// Rates come from the mobility Darcy PI (Tarner!I13, no mu*B):
//   J1 = 0.00708*K*h/(ln(Re/Rw)-0.75+S)
//   qt = J1*lambda_t*(P-Pwf),  lambda_t = Kro/mu_o + Krg/mu_g
//   qo = qt*(Kro/mu_o)/(Bo*lambda_t)   [= J1*(Kro/mu_o)/Bo * (P-Pwf)]
//   GOR = Rs + (Krg/Kro)*(mu_o*Bo)/(mu_g*Bg)
// Rel-perm: the sheet's hardcoded 6th-order polynomials Kro(So), Krg(Sg).
//
// Forecast Pwf source: 'vlp' (nodal against the real oil march at the
// forecast FTHP — the author's commented-out intent) or 'fixed' (the
// sheet's active behavior: a constant minimum Pwf).
//
// PVT scheme (updated 2026-08-28, per the training material — Tarner
// slides: "all the PVT data must be evaluated at the assumed reservoir
// pressure p2"): Rs/Bo/Bg/mu are evaluated AT THE TRIAL PRESSURE inside
// the solve, the same policy as the Walsh method. (History: the saved
// sheet froze PVT at initial values; an earlier port evaluated at the
// previous step's converged pressure.) Pwf stays frozen per step, and the
// rate stays coupled to the trial pressure, like the sheet's K/M columns
// under GoalSeek.

import { brent } from '../solvers/brent.js';
import { operatingPoint } from '../nodal/nodal.js';
import { oilMarch } from '../vlp/oil-march.js';
import { solutionGorScfStb, oilFvf, oilViscosityCp } from '../pvt/oil.js';
import {
  gasPseudoCriticals,
  gasViscosityBaseCp,
  dempseyLnRatio,
} from '../pvt/gas.js';
import { mbBgBblScf, zAtResOil } from './oil-reserve.js';

/** Sheet rel-perm polynomials (Tarner!F16 / G16), verbatim. */
export function kroTarner(so) {
  return (
    -8.38190317154e-9 * so ** 6 + 1.771375536919e-8 * so ** 5 -
    2.24276445806e-8 * so ** 4 + 1.415932551026e-8 * so ** 3 +
    1.24444443593566 * so ** 2 - 0.323555551551901 * so + 0.021031110321869
  );
}
export function krgTarner(sg) {
  return (
    -7.45058059692e-9 * sg ** 6 + 2.23517417908e-9 * sg ** 5 -
    2.7939677238e-10 * sg ** 4 - 1.860782504082e-8 * sg ** 3 +
    2.040816336171 * sg ** 2 - 0.204081636387841 * sg + 0.00510204149620779
  );
}

/** Mobility Darcy PI (Tarner!I13): no mu*B — mobility enters through lambda. */
export function j1Tarner({ permMd, thicknessFt, reFt, rwFt, skin = 0 }) {
  return (0.00708 * permMd * thicknessFt) / (Math.log(reFt / rwFt) - 0.75 + skin);
}

/** Rock+water compressibility term (Tarner!R col):
 *  ct = (Cw*Swi + Cf)/(1 - Swi) * (Pri - P). */
export function ctTermTarner(pPsi, { priPsi, swi, cwPsi, cfPsi }) {
  return ((cwPsi * swi + cfPsi) / (1 - swi)) * (priPsi - pPsi);
}

/** MB oil saturation (Tarner!Y col). np, n in MMstb. */
export function soFromMb({ swi, nMMstb, npMMstb, bo, boi, ct }) {
  return ((1 - swi) * ((nMMstb - npMMstb) * bo)) / (nMMstb * boi * (1 - ct));
}

/** MB cumulative gas, MMscf (Tarner!O col). */
export function gpFromMb({ nMMstb, npMMstb, rsi, rs, bo, boi, bg, ct }) {
  return (
    nMMstb * (rsi - rs) -
    (nMMstb * boi - (nMMstb - npMMstb) * bo) / bg +
    (nMMstb * boi * ct) / bg +
    npMMstb * rs
  );
}

/** Producing GOR, scf/stb (Tarner!P col). */
export function gorTarner({ rs, krg, kro, muO, muG, bo, bg }) {
  return rs + (krg / kro) * ((muO * bo) / (muG * bg));
}

/** Gas viscosity at reservoir T (local Tpr, sweet pcrits — the PVT sheet). */
export function muGasAtRes(cfg, pPsi) {
  const pc = gasPseudoCriticals({ gasSg: cfg.gasSg, method: 'sweet' });
  const tpr = (cfg.tresF + 460) / pc.tpc;
  return (
    (gasViscosityBaseCp(cfg.gasSg, cfg.tresF) / tpr) *
    Math.exp(dempseyLnRatio(pPsi / pc.ppc, tpr))
  );
}

/** Pressure-dependent PVT bundle — evaluated once per step at the nearest
 *  solved Pres and held through that step's solve. */
function pvtAt(p, { pvt, cfg }) {
  return {
    rs: solutionGorScfStb(p, pvt),
    bo: oilFvf(p, pvt),
    bg: mbBgBblScf(cfg.tresF, zAtResOil(cfg, p), p),
    muO: oilViscosityCp(p, pvt),
    muG: muGasAtRes(cfg, p),
  };
}

/** Saturation-dependent mobility at a frozen PVT bundle. */
function mobAt(so, swi, f) {
  const sg = Math.max(0, 1 - swi - so);
  const kro = Math.max(kroTarner(so), 1e-9);
  const krg = Math.max(krgTarner(sg), 0);
  return {
    sg, kro, krg,
    lambdaT: kro / f.muO + krg / f.muG,
    lambdaO: kro / f.muO,
    gor: gorTarner({ rs: f.rs, krg, kro, muO: f.muO, muG: f.muG, bo: f.bo, bg: f.bg }),
  };
}

/**
 * Tarner forecast march. opts:
 *   cfg    oil march config ('vlp' Pwf mode; also Tres/gasSg for reservoir PVT)
 *   pvt    { pbPsi, rsiScfStb, gasSg, api, tempF }
 *   darcy  { permMd, thicknessFt, reFt, rwFt, skin } -> J1
 *   nMMstb, priPsi, swi (0.15), cwPsi (2.63e-6), cfPsi (3.25e-6)
 *   startPresPsi (Pri), startNpMMstb (0), startGpMMscf (0), startDay (0)
 *   stepDays (30), maxSteps (60)
 *   pwfMode 'vlp' | 'fixed'; fthpPsi (vlp mode); minPwfPsi (500)
 *   abandonQoStbD (50)
 * Returns { rows, status, eurMMstb, recoveryPct, j1 }.
 */
export function tarnerForecast(opts) {
  const {
    cfg, pvt, darcy, nMMstb, priPsi,
    swi = 0.15, cwPsi = 2.63e-6, cfPsi = 3.25e-6,
    stepDays = 30, maxSteps = 60,
    pwfMode = 'vlp', fthpPsi, minPwfPsi = 500,
    abandonQoStbD = 50,
  } = opts;
  if (!(nMMstb > 0)) throw new Error('tarner: STOIIP N must be > 0');
  const j1 = j1Tarner(darcy);
  const ctx = { pvt, cfg, swi };
  const boi = oilFvf(priPsi, pvt);
  const rsi = pvt.rsiScfStb;
  const ctOf = (p) => ctTermTarner(p, { priPsi, swi, cwPsi, cfPsi });
  const clampSo = (so) => Math.min(Math.max(so, 0.05), 1 - swi);

  let p = opts.startPresPsi ?? priPsi;
  let np = opts.startNpMMstb ?? 0;
  let gp = opts.startGpMMscf ?? 0;
  const f0 = pvtAt(p, ctx);
  let so = clampSo(soFromMb({ swi, nMMstb, npMMstb: np, bo: f0.bo, boi, ct: ctOf(p) }));
  // the forecast continues the WELL, so it departs from the last measured
  // producing GOR when one is given; the MB value is the fallback
  let prevGor = opts.fcGorScfStb ?? opts.startGorScfStb ?? mobAt(so, swi, f0).gor;

  /** Pwf for the step at the beginning-of-step state and frozen PVT f. */
  const solvePwf = (pStart, soStart, f, gorForMarch) => {
    if (pwfMode === 'fixed') return { pwfPsi: minPwfPsi };
    const m = mobAt(soStart, swi, f);
    const jo = (j1 * m.lambdaO) / f.bo;
    const qCap = jo * (pStart - minPwfPsi);
    if (!(qCap > 1)) return { pwfPsi: minPwfPsi, dead: true };
    const vlpPwf = (q) =>
      oilMarch({
        ...cfg,
        thpPsi: fthpPsi ?? cfg.thpPsi,
        qOilStbD: q,
        // the forecast stream GOR (an input, like W.C and THP) when given;
        // otherwise the MB GOR carried from the previous step
        gorScfStb: Math.max(opts.fcGorScfStb ?? gorForMarch, 1),
      }).pwfPsi;
    const iprPwf = (q) => pStart - q / jo;
    // sample + bracket + Brent, highest-rate (stable) crossing
    const op = operatingPoint({ iprPwf, vlpPwf, qMin: 10, qMax: qCap, samples: 25 });
    if (op.status === 'ok') return { pwfPsi: iprPwf(op.qOp) };
    // VLP entirely below the inflow line: min-Pwf drawdown cap; above: dead
    if (vlpPwf(qCap) - iprPwf(qCap) < 0) return { pwfPsi: minPwfPsi };
    return { pwfPsi: minPwfPsi, dead: true };
  };

  const rows = [];
  let status = 'max-steps';
  const startDay = opts.startDay ?? 0;

  // ANCHOR ROW at the start date itself. The loop books end-of-step states,
  // so without this the series began one step AFTER the declared start and
  // the forecast chart did not join the history it continues. Booking the
  // start state changes no physics — it is the state the first step departs
  // from — and it lets the reader compare the modelled rate at the anchor
  // with the last measured rate.
  {
    const m0 = mobAt(so, swi, f0);
    const pw0 = solvePwf(p, so, f0, prevGor);
    const qo0 = pw0.dead ? 0 : Math.max(((j1 * m0.lambdaO) / f0.bo) * (p - pw0.pwfPsi), 0);
    rows.push({
      tDays: startDay,
      dtDays: 0,
      presPsi: p,
      pwfPsi: pw0.pwfPsi,
      qOilStbD: qo0,
      gorScfStb: prevGor,
      npMMstb: np,
      gpBscf: gp / 1000,
      soFrac: so,
      sgFrac: Math.max(0, 1 - swi - so),
      kro: m0.kro,
      krg: m0.krg,
      converged: true,
      anchor: true,
    });
  }

  for (let i = 0; i < maxSteps; i++) {
    // 1) PVT at the beginning-of-step pressure for the Pwf solve
    const f = pvtAt(p, ctx);
    const pw = solvePwf(p, so, f, prevGor);
    if (pw.dead) { status = 'died'; break; }
    const pwf = pw.pwfPsi;

    // 2) the macro's GoalSeek pair with Pwf frozen and PVT evaluated AT THE
    //    TRIAL PRESSURE (training-material policy): So by substitution (AF),
    //    P by Brent on the Gp residual (AE), rate coupled to pTry
    let pNew = p;
    let soNew = so;
    let converged = false;
    for (let k = 0; k < 25; k++) {
      const soK = soNew;
      const resid = (pTry) => {
        const fT = pvtAt(pTry, ctx);
        const m = mobAt(soK, swi, fT);
        const qoT = Math.max(((j1 * m.lambdaO) / fT.bo) * (pTry - pwf), 0);
        const npT = np + (qoT * stepDays) / 1e6;
        const gpInt = gp + ((prevGor + m.gor) / 2) * (npT - np);
        const gpMb = gpFromMb({ nMMstb, npMMstb: npT, rsi, rs: fT.rs, bo: fT.bo, boi, bg: fT.bg, ct: ctOf(pTry) });
        return gpInt - gpMb;
      };
      const lo = Math.max(minPwfPsi * 0.25, 60);
      const rLo = resid(lo);
      const rHi = resid(p);
      let pSolved;
      if (rLo * rHi <= 0) pSolved = brent(resid, lo, p, { tol: 1e-7 }).root;
      else pSolved = Math.abs(rLo) < Math.abs(rHi) ? lo : p;
      const fS = pvtAt(pSolved, ctx);
      const mS = mobAt(soK, swi, fS);
      const npT = np + (Math.max(((j1 * mS.lambdaO) / fS.bo) * (pSolved - pwf), 0) * stepDays) / 1e6;
      const soMb = clampSo(soFromMb({ swi, nMMstb, npMMstb: npT, bo: fS.bo, boi, ct: ctOf(pSolved) }));
      const dP = Math.abs(pSolved - pNew);
      const dSo = Math.abs(soMb - soNew);
      pNew = pSolved;
      soNew = soMb;
      if (dP < 1e-6 && dSo < 1e-10) { converged = true; break; }
    }

    // 3) book the step at the converged state (rate and PVT at the solved P,
    //    exactly as the sheet's M column reads at the GoalSeek'd H)
    const fEnd = pvtAt(pNew, ctx);
    const mEnd = mobAt(soNew, swi, fEnd);
    const qo = Math.max(((j1 * mEnd.lambdaO) / fEnd.bo) * (pNew - pwf), 0);
    if (qo < abandonQoStbD) { status = qo <= 0 ? 'died' : 'abandoned'; break; }
    const npNew = np + (qo * stepDays) / 1e6;
    if (npNew >= nMMstb * 0.999) { status = 'depleted'; break; }
    const gorNew = mEnd.gor;
    const gpNew = gp + ((prevGor + gorNew) / 2) * (npNew - np);
    rows.push({
      tDays: startDay + (i + 1) * stepDays,
      dtDays: (i + 1) * stepDays,
      presPsi: pNew,
      pwfPsi: pwf,
      qOilStbD: qo,
      gorScfStb: gorNew,
      npMMstb: npNew,
      gpBscf: gpNew / 1000,
      soFrac: soNew,
      sgFrac: Math.max(0, 1 - swi - soNew),
      kro: mEnd.kro,
      krg: mEnd.krg,
      converged,
    });
    p = pNew;
    so = soNew;
    np = npNew;
    gp = gpNew;
    prevGor = gorNew;
    if (p <= Math.max(minPwfPsi * 1.02, 120)) { status = 'depleted'; break; }
  }
  return { rows, status, eurMMstb: np, recoveryPct: (np / nMMstb) * 100, j1 };
}
