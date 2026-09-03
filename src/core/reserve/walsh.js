// Walsh generalized-MB oil forecast — workbook "new oil reservoir forecast
// Final Walsh and turner variable Pwf_V1.1.xls", "Walsh" sheet port.
//
// Same two-residual structure as Tarner (per step the macro GoalSeeks
//   AE: Gp by the producing-GOR trapezoid  == Gp from the material balance
//   AF: assumed So                          == MB So
// solved for pressure P and saturation So), but with Walsh's volatile-oil
// generalized material balance:
//
//   Rv(P)  volatilized oil-gas ratio — the sheet's tuned 6th-order
//          polynomial (Walsh!AH column), /1000
//   Gp_MB (Walsh!O):
//     ( N*( Boi*(1-Rv*Rs) - (Bg-Rv*Bo)*Rsi - (Bo-Rs*Bg) ) + Np*Bo - Np*Rs*Bg )
//       / (Bo*Rv - Bg)  +  N*Boi/Bg * ct/(1-Swi)
//   So_MB (Walsh!Y):
//     (1-Swi) * ( (1-Np/N)*Bo*Bg - Boi*Rv*Bo ) / ( Boi*(Bg-Rv*Bo)*(1-ct) )
//   GOR   (Walsh!P):  Foo * ( Rs + (Krg/Kro)*(muO*Bo)/(muG*Bg) )
//   Foo   (Walsh!AI): 1 / ( 1 + (Bo*Krg*muO*Rv)/(Bg*Kro*muG) )
//
// Rates use the CONSTANT calibrated PI J (Walsh!I = $I$13 = J_2) on total
// mobility:  qt = J*lambda_t*(P-Pwf),  qo = qt*lambda_o/(lambda_t*Bo).
// Rel-perm: the same sheet polynomials as Tarner (identical coefficients).
//
// Workbook quirks preserved:
//   - muG = muO: the sheet's "Gas Visc" column (Walsh!W) reads the OIL
//     viscosity cell (BHP!AQ), so gas mobility and the GOR ratio use the
//     oil viscosity. Kept for parity.
//   - Bg in cf/scf (the march form, no /5.615) — the MB is written in it.
// PVT scheme: evaluated AT THE TRIAL PRESSURE inside the solve. Unlike
// Tarner, the Walsh Gp residual moves with pressure almost entirely
// through the PVT (Bg, Rs, Rv) — freezing it leaves no root — and the
// sheet's own PVT table follows the row's pressure. (The sheet reads that
// table at the parallel TARNER sheet's pressures, a shared-table
// convenience; WellSim uses Walsh's own pressure — documented deviation.)

import { brent } from '../solvers/brent.js';
import { operatingPoint } from '../nodal/nodal.js';
import { oilMarch } from '../vlp/oil-march.js';
import { solutionGorScfStb, oilFvf, oilViscosityCp } from '../pvt/oil.js';
import { mbBgBblScf, zAtResOil } from './oil-reserve.js';
import { kroTarner, krgTarner, ctTermTarner } from './tarner.js';

/** Volatilized oil-gas ratio Rv(P), bbl/scf (Walsh!AH), verbatim. */
export function rvWalsh(pPsi) {
  return (
    (1.045159231e-21 * pPsi ** 6 - 1.7363576978649e-17 * pPsi ** 5 +
      1.17482373317021e-13 * pPsi ** 4 - 4.10981307039167e-10 * pPsi ** 3 +
      7.87671754746064e-7 * pPsi ** 2 - 0.000776441401360544 * pPsi +
      0.332227112083792) / 1000
  );
}

/** Walsh MB cumulative gas, MMscf (Walsh!O col). n/np MMstb, bg bbl/scf. */
export function gpWalsh({ nMMstb, npMMstb, rsi, rs, bo, boi, bg, rv, ct, swi }) {
  return (
    (nMMstb * (boi * (1 - rv * rs) - (bg - rv * bo) * rsi - (bo - rs * bg)) +
      npMMstb * bo - npMMstb * rs * bg) / (bo * rv - bg) +
    ((nMMstb * boi) / bg) * (ct / (1 - swi))
  );
}

/** Walsh MB oil saturation (Walsh!Y col). */
export function soWalsh({ swi, nMMstb, npMMstb, bo, boi, bg, rv, ct }) {
  return (
    ((1 - swi) * ((1 - npMMstb / nMMstb) * bo * bg - boi * rv * bo)) /
    (boi * (bg - rv * bo) * (1 - ct))
  );
}

/** Walsh producing-GOR pair (Walsh!AI + P cols). */
export function gorWalsh({ rs, kro, krg, muO, muG, bo, bg, rv }) {
  const foo = 1 / (1 + (bo * krg * muO * rv) / (bg * kro * muG));
  return { foo, gor: foo * (rs + (krg / kro) * ((muO * bo) / (muG * bg))) };
}

/** PVT bundle at P — two sheet quirks preserved: muG = muO (Walsh!W reads
 *  the oil-visc cell), and Bg in cf/scf (BHP!AC = 0.0283*z*(T+460)/(P+14.5),
 *  the march form WITHOUT /5.615 — the Walsh MB is written in these units). */
function pvtAtWalsh(p, { pvt, cfg }) {
  const muO = oilViscosityCp(p, pvt);
  return {
    rs: solutionGorScfStb(p, pvt),
    bo: oilFvf(p, pvt),
    bg: mbBgBblScf(cfg.tresF, zAtResOil(cfg, p), p) * 5.615,
    muO,
    muG: muO,
    rv: rvWalsh(p),
  };
}

/** Saturation-dependent mobilities + Walsh GOR at a frozen PVT bundle. */
function mobWalsh(so, swi, f) {
  const sg = Math.max(0, 1 - swi - so);
  const kro = Math.max(kroTarner(so), 1e-9);
  const krg = Math.max(krgTarner(sg), 0);
  const { foo, gor } = gorWalsh({ rs: f.rs, kro, krg, muO: f.muO, muG: f.muG, bo: f.bo, bg: f.bg, rv: f.rv });
  return { sg, kro, krg, lambdaT: kro / f.muO + krg / f.muG, lambdaO: kro / f.muO, foo, gor };
}

/**
 * Walsh forecast march. opts (mirrors tarnerForecast):
 *   cfg    oil march config ('vlp' Pwf mode; Tres/gasSg for reservoir PVT)
 *   pvt    { pbPsi, rsiScfStb, gasSg, api, tempF }
 *   jStbDPsi  the constant calibrated PI (Walsh!$I$13 = J_2)
 *   nMMstb, priPsi, swi (0.15), cwPsi (2.63e-6), cfPsi (3.25e-6)
 *   startPresPsi (Pri), startNpMMstb (0), startGpMMscf (Np0*Rsi), startDay (0)
 *   stepDays (30), maxSteps (60)
 *   pwfMode 'vlp' | 'fixed'; fthpPsi (vlp mode); minPwfPsi (500)
 *   abandonQoStbD (50)
 * Returns { rows, status, eurMMstb, recoveryPct, j: jStbDPsi }.
 */
export function walshForecast(opts) {
  const {
    cfg, pvt, jStbDPsi, nMMstb, priPsi,
    march = oilMarch, // ESP: dP is solved per step, not an input
    swi = 0.15, cwPsi = 2.63e-6, cfPsi = 3.25e-6,
    stepDays = 30, maxSteps = 60,
    pwfMode = 'vlp', fthpPsi, minPwfPsi = 500,
    abandonQoStbD = 50,
  } = opts;
  if (!(nMMstb > 0)) throw new Error('walsh: STOIIP N must be > 0');
  if (!(jStbDPsi > 0)) throw new Error('walsh: PI J must be > 0');
  const ctx = { pvt, cfg };
  const boi = oilFvf(priPsi, pvt);
  const rsi = pvt.rsiScfStb;
  const ctOf = (p) => ctTermTarner(p, { priPsi, swi, cwPsi, cfPsi });
  const clampSo = (so) => Math.min(Math.max(so, 0.05), 1 - swi);

  let p = opts.startPresPsi ?? priPsi;
  let np = opts.startNpMMstb ?? 0;
  let gp = opts.startGpMMscf ?? np * rsi;
  const f0 = pvtAtWalsh(p, ctx);
  let so = clampSo(soWalsh({ swi, nMMstb, npMMstb: np, bo: f0.bo, boi, bg: f0.bg, rv: f0.rv, ct: ctOf(p) }));
  // the forecast continues the WELL, so it departs from the last measured
  // producing GOR when one is given; the MB value is the fallback
  let prevGor = opts.fcGorScfStb ?? opts.startGorScfStb ?? mobWalsh(so, swi, f0).gor;

  /** Pwf for the step (frozen PVT f): VLP-coupled, floored at minPwf.
   *  opts.pwfSeries (array, psi) overrides per step — used for sheet-parity
   *  runs that replay the workbook's macro-solved Pwf column. */
  const solvePwf = (pStart, soStart, f, gorForMarch, stepIdx) => {
    if (Array.isArray(opts.pwfSeries))
      return { pwfPsi: Math.max(opts.pwfSeries[Math.min(stepIdx, opts.pwfSeries.length - 1)], minPwfPsi) };
    if (pwfMode === 'fixed') return { pwfPsi: minPwfPsi };
    const m = mobWalsh(soStart, swi, f);
    const jo = (jStbDPsi * m.lambdaO) / f.bo;
    const qCap = jo * (pStart - minPwfPsi);
    if (!(qCap > 1)) return { pwfPsi: minPwfPsi, dead: true };
    const vlpPwf = (q) =>
      march({
        ...cfg,
        thpPsi: fthpPsi ?? cfg.thpPsi,
        qOilStbD: q,
        // the forecast stream GOR (an input, like W.C and THP) when given;
        // otherwise the MB GOR carried from the previous step
        gorScfStb: Math.max(opts.fcGorScfStb ?? gorForMarch, 1),
      }).pwfPsi;
    const iprPwf = (q) => pStart - q / jo;
    const op = operatingPoint({ iprPwf, vlpPwf, qMin: 10, qMax: qCap, samples: 25 });
    if (op.status === 'ok') return { pwfPsi: Math.max(iprPwf(op.qOp), minPwfPsi) };
    if (vlpPwf(qCap) - iprPwf(qCap) < 0) return { pwfPsi: minPwfPsi };
    return { pwfPsi: minPwfPsi, dead: true };
  };

  const rows = [];
  let status = 'max-steps';
  const startDay = opts.startDay ?? 0;

  // ANCHOR ROW at the start date itself — see the same note in tarner.js:
  // the loop books end-of-step states, so the series otherwise began one
  // step after the declared start and left a gap against the history.
  {
    const m0 = mobWalsh(so, swi, f0);
    const pw0 = solvePwf(p, so, f0, prevGor, 0);
    const qt0 = pw0.dead ? 0 : jStbDPsi * m0.lambdaT * Math.max(p - pw0.pwfPsi, 0);
    const qo0 = pw0.dead || !(m0.lambdaT > 0) ? 0 : (qt0 * m0.lambdaO) / (f0.bo * m0.lambdaT);
    rows.push({
      tDays: startDay,
      dtDays: 0,
      presPsi: p,
      pwfPsi: pw0.pwfPsi,
      qOilStbD: qo0,
      qtBblD: qt0,
      gorScfStb: prevGor,
      npMMstb: np,
      gpBscf: gp / 1000,
      soFrac: so,
      sgFrac: Math.max(0, 1 - swi - so),
      kro: m0.kro,
      krg: m0.krg,
      rv: f0.rv,
      foo: m0.foo,
      converged: true,
      anchor: true,
    });
  }

  for (let i = 0; i < maxSteps; i++) {
    // 1) PVT once per step at the nearest solved Walsh Pres, then step Pwf
    const f = pvtAtWalsh(p, ctx);
    const pw = solvePwf(p, so, f, prevGor, i);
    if (pw.dead) { status = 'died'; break; }
    const pwf = pw.pwfPsi;

    // 2) the GoalSeek pair with Pwf frozen and PVT evaluated AT THE TRIAL
    //    PRESSURE (the Walsh MB has no root otherwise): So by substitution
    //    (AF), P by Brent on the Gp residual (AE), rate coupled to pTry
    let pNew = p;
    let soNew = so;
    let converged = false;
    for (let k = 0; k < 25; k++) {
      const soK = soNew;
      const resid = (pTry) => {
        const fT = pvtAtWalsh(pTry, ctx);
        const m = mobWalsh(soK, swi, fT);
        const qoT = Math.max(((jStbDPsi * m.lambdaO) / fT.bo) * (pTry - pwf), 0);
        const npT = np + (qoT * stepDays) / 1e6;
        const gpInt = gp + ((prevGor + m.gor) / 2) * (npT - np);
        const gpMb = gpWalsh({ nMMstb, npMMstb: npT, rsi, rs: fT.rs, bo: fT.bo, boi, bg: fT.bg, rv: fT.rv, ct: ctOf(pTry), swi });
        return gpInt - gpMb;
      };
      const lo = Math.max(minPwfPsi * 0.25, 60);
      const rLo = resid(lo);
      const rHi = resid(p);
      let pSolved;
      if (rLo * rHi <= 0) pSolved = brent(resid, lo, p, { tol: 1e-7 }).root;
      else pSolved = Math.abs(rLo) < Math.abs(rHi) ? lo : p;
      const fS = pvtAtWalsh(pSolved, ctx);
      const mS = mobWalsh(soK, swi, fS);
      const npT = np + ((Math.max(((jStbDPsi * mS.lambdaO) / fS.bo) * (pSolved - pwf), 0)) * stepDays) / 1e6;
      const soMb = clampSo(soWalsh({ swi, nMMstb, npMMstb: npT, bo: fS.bo, boi, bg: fS.bg, rv: fS.rv, ct: ctOf(pSolved) }));
      const dP = Math.abs(pSolved - pNew);
      const dSo = Math.abs(soMb - soNew);
      pNew = pSolved;
      soNew = soMb;
      if (dP < 1e-6 && dSo < 1e-10) { converged = true; break; }
    }

    // 3) book the step at the converged state (PVT at the solved pressure)
    const fEnd = pvtAtWalsh(pNew, ctx);
    const mEnd = mobWalsh(soNew, swi, fEnd);
    const qt = jStbDPsi * mEnd.lambdaT * Math.max(pNew - pwf, 0);
    const qo = (qt * mEnd.lambdaO) / (fEnd.bo * mEnd.lambdaT);
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
      qtBblD: qt,
      gorScfStb: gorNew,
      npMMstb: npNew,
      gpBscf: gpNew / 1000,
      soFrac: soNew,
      sgFrac: Math.max(0, 1 - swi - soNew),
      kro: mEnd.kro,
      krg: mEnd.krg,
      rv: fEnd.rv,
      foo: mEnd.foo,
      converged,
    });
    p = pNew;
    so = soNew;
    np = npNew;
    gp = gpNew;
    prevGor = gorNew;
    if (p <= Math.max(minPwfPsi * 1.02, 120)) { status = 'depleted'; break; }
  }
  return { rows, status, eurMMstb: np, recoveryPct: (np / nMMstb) * 100, j: jStbDPsi };
}
