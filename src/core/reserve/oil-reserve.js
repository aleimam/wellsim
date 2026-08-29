// Oil reserve estimate — workbook "Reserve Estimate From Early Oil
// Production V5.1". Three selections:
//   1. prod_data Solver: per-row Pwf (input-or-march), Pr by the composite-
//      Vogel closed-form inversion with the workbook's J_2 (future Darcy J
//      with mu*Bo at the iterated Pr — macro loops the paste 5x, we fixed-
//      point to convergence), then the Havlena-Odeh solution-gas MB:
//      F = Np*(Bo+(Rp-Rs)*Bg), Eo = Bo+(Rsi-Rs)*Bg-Boi, N = F/Eo per row.
//      Headline N = AVERAGE(F/Eo) (sheet AD1); SLOPE(F,Eo) as cross-check
//      (sheet V1) — a wide gap between them flags unstabilized data.
//   2. measured static Pres history (memory-gauge surveys, user input):
//      the same MB directly on the entered pressures — no IPR/VLP involved;
//      Np/Gp are integrated from the prod-data rates.
//   3. reservoir limit — the gas sheet's clone in oil units:
//      STOIP = qavg/(Ct*m)/1e6 MMstb, Ct = Cg*Sg+Co*So+Cw*Sw+Cf.
// Reservoir z is explicit Brill & Beggs (the sheet GoalSeeks it), with the
// oil family's sweet pseudo-criticals from the gas gravity.

import { oilMarch } from '../vlp/oil-march.js';
import { prFromTest } from '../ipr/oil-ipr.js';
import { futureOilJ } from '../nodal/sensitivity.js';
import { solutionGorScfStb, oilFvf } from '../pvt/oil.js';
import { gasPseudoCriticals, zFactorBrillBeggs } from '../pvt/gas.js';
import { toDays, bgCfScf } from './gas-reserve.js';

/** z at reservoir T for the solution gas — oil family (sweet pcrits). */
export function zAtResOil(cfg, pPsi) {
  const pc = gasPseudoCriticals({ gasSg: cfg.gasSg, method: 'sweet' });
  return zFactorBrillBeggs(pPsi / pc.ppc, (cfg.tresF + 460) / pc.tpc).z;
}

/** MB gas FVF, bbl/scf (sheet Y column): 0.0283*z*(T+460)/(p+14.5)/5.615. */
export function mbBgBblScf(tresF, z, pPsi) {
  return (0.0283 * z * (tresF + 460)) / (pPsi + 14.5) / 5.615;
}

/**
 * Pr from one flowing point — the macro's G-column inversion iterated with
 * J_2 (future Darcy J at the current iterate, A/B viscosity at the iterate's
 * Rs). Falls back to the frozen ipr.j when no Darcy record exists.
 */
export function prFromRowOil(ipr, pvt, { qGrossStbD, pwfPsi, prStart }) {
  let pr = prStart ?? ipr.prPsi;
  let j = ipr.j;
  for (let k = 0; k < 12; k++) {
    if (ipr.darcy) {
      j = futureOilJ(pr, {
        darcy: ipr.darcy,
        pvt,
        rsCurScfStb: solutionGorScfStb(pr, pvt),
      }).j;
    }
    const next = prFromTest({ qGrossStbD, pwfPsi, j, pbPsi: pvt.pbPsi });
    if (Math.abs(next - pr) < 1e-9) return { presPsi: next, j };
    pr = next;
  }
  return { presPsi: pr, j };
}

/**
 * prod_data Solver + Havlena-Odeh columns. rows: [{ date, thpPsi?,
 * qOilStbD, gorScfStb?, wcPct?, pwfPsi? }] — pwfPsi omitted -> oil march at
 * that row's THP/rate/GOR/WC. pvt: { pbPsi, rsiScfStb, gasSg, api, tempF }.
 * Gas cumulative uses Rsi above Pb, the producing GOR below (sheet W col).
 */
export function oilPresSolver(marchCfg, ipr, pvt, rows) {
  const boi = oilFvf(ipr.priPsi, pvt);
  const t0 = rows.length ? toDays(rows[0].date) : 0;
  let np = 0; // MMstb
  let gp = 0; // Bscf
  let prev = null;
  let prPrev = ipr.prPsi;
  return rows.map((r) => {
    const tDays = toDays(r.date);
    const wc = r.wcPct ?? marchCfg.wcPct;
    const gor = r.gorScfStb ?? marchCfg.gorScfStb;
    const pwfSource = r.pwfPsi != null ? 'input' : 'calculated';
    const pwfPsi =
      r.pwfPsi ??
      oilMarch({
        ...marchCfg,
        thpPsi: r.thpPsi ?? marchCfg.thpPsi,
        qOilStbD: r.qOilStbD,
        gorScfStb: gor,
        wcPct: wc,
      }).pwfPsi;
    const qGross = r.qOilStbD / (1 - wc / 100);
    const { presPsi } = prFromRowOil(ipr, pvt, { qGrossStbD: qGross, pwfPsi, prStart: prPrev });
    prPrev = presPsi;
    const z = zAtResOil(marchCfg, presPsi);
    const gorEff = presPsi >= pvt.pbPsi ? pvt.rsiScfStb : gor;
    if (prev) {
      const dt = tDays - prev.tDays;
      np += (dt * (r.qOilStbD + prev.q)) / 2 / 1e6;
      gp += (dt * (r.qOilStbD * gorEff + prev.q * prev.gorEff)) / 2 / 1e9;
    }
    prev = { tDays, q: r.qOilStbD, gorEff };
    const rs = solutionGorScfStb(presPsi, pvt);
    const bo = oilFvf(presPsi, pvt);
    const bg = mbBgBblScf(marchCfg.tresF, z, presPsi);
    const rp = np > 0 ? (gp * 1000) / np : rs; // scf/stb
    const f = np * (bo + (rp - rs) * bg); // MMbbl
    const eo = bo + bg * (pvt.rsiScfStb - rs) - boi;
    return {
      tDays,
      dtDays: tDays - t0,
      qOilStbD: r.qOilStbD,
      thpPsi: r.thpPsi ?? null,
      // the per-row stream the march actually used (row value, else the well
      // model default) — the forecast seeds its start state from the last one
      wcPct: wc,
      gorScfStb: gor,
      pwfPsi,
      pwfSource,
      presPsi,
      dpPsi: presPsi - pwfPsi,
      z,
      npMMstb: np,
      gpBscf: gp,
      rsScfStb: rs,
      bo,
      bgBblScf: bg,
      fMMbbl: f,
      eo,
      nMMstb: np > 0 && Math.abs(eo) > 1e-9 ? f / eo : null,
    };
  });
}

const lsqSlope = (xs, ys) => {
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
};

/**
 * The sheet's two N estimates: nAvg = AVERAGE of per-row F/Eo over the
 * informative rows (AD1, the headline) and nSlope = SLOPE(F, Eo) over all
 * points including the (0,0) initial anchor (V1).
 */
export function stoiipFit(points) {
  // rows with no production yet carry F = 0 by construction (the sheet's
  // row-5 anchor) — informative rows only, plus the exact (0,0) anchor for
  // the slope
  const informative = points.filter(
    (p) => Number.isFinite(p.fMMbbl) && Number.isFinite(p.eo) && (p.npMMstb ?? 0) > 0
  );
  const rows = informative.filter((p) => p.nMMstb != null);
  if (rows.length < 1)
    return { nAvgMMstb: null, nSlopeMMstb: null, warning: 'no depletion signal — no informative rows (Eo ~ 0 or no production)' };
  const nAvg = rows.reduce((a, p) => a + p.nMMstb, 0) / rows.length;
  const xs = [0, ...informative.map((p) => p.eo)];
  const ys = [0, ...informative.map((p) => p.fMMbbl)];
  const nSlope = lsqSlope(xs, ys);
  const out = { nAvgMMstb: nAvg, nSlopeMMstb: nSlope };
  if (nAvg <= 0) out.warning = 'negative N — check Pres trend and PVT inputs';
  return out;
}

/**
 * Selection 2 — measured static Pres history (memory-gauge surveys).
 * surveys: [{ date, presPsi }]; prodRows: [{ date, qOilStbD, gorScfStb? }]
 * give the Np/Gp integration (producing GOR capped at Rsi is NOT applied
 * here — the entered GOR is the produced ratio). An implicit initial anchor
 * (Pri, Np=0) opens the series.
 */
export function oilStaticMb(cfg, ipr, pvt, surveys, prodRows) {
  const pr0 = prodRows.map((r) => ({ t: toDays(r.date), q: r.qOilStbD, gor: r.gorScfStb ?? pvt.rsiScfStb }));
  const cum = [{ t: pr0[0].t, np: 0, gp: 0 }];
  for (let i = 1; i < pr0.length; i++) {
    const dt = pr0[i].t - pr0[i - 1].t;
    cum.push({
      t: pr0[i].t,
      np: cum[i - 1].np + (dt * (pr0[i].q + pr0[i - 1].q)) / 2 / 1e6,
      gp: cum[i - 1].gp + (dt * (pr0[i].q * pr0[i].gor + pr0[i - 1].q * pr0[i - 1].gor)) / 2 / 1e9,
    });
  }
  const interp = (t, key) => {
    if (t <= cum[0].t) return 0;
    for (let i = 1; i < cum.length; i++) {
      if (t <= cum[i].t) {
        const w = (t - cum[i - 1].t) / (cum[i].t - cum[i - 1].t);
        return cum[i - 1][key] + w * (cum[i][key] - cum[i - 1][key]);
      }
    }
    return cum[cum.length - 1][key]; // beyond the last prod row: hold cum
  };
  const boi = oilFvf(ipr.priPsi, pvt);
  const t0 = pr0[0].t;
  const points = surveys.map((s) => {
    const tDays = toDays(s.date);
    const presPsi = s.presPsi;
    const z = zAtResOil(cfg, presPsi);
    const np = interp(tDays, 'np');
    const gpB = interp(tDays, 'gp');
    const rs = solutionGorScfStb(presPsi, pvt);
    const bo = oilFvf(presPsi, pvt);
    const bg = mbBgBblScf(cfg.tresF, z, presPsi);
    const rp = np > 0 ? (gpB * 1000) / np : rs;
    const f = np * (bo + (rp - rs) * bg);
    const eo = bo + bg * (pvt.rsiScfStb - rs) - boi;
    return {
      tDays, dtDays: tDays - t0, presPsi, z, npMMstb: np, gpBscf: gpB,
      rsScfStb: rs, bo, bgBblScf: bg, fMMbbl: f, eo,
      nMMstb: np > 0 && Math.abs(eo) > 1e-9 ? f / eo : null,
    };
  });
  return { points, fit: stoiipFit(points) };
}

/**
 * Selection 3 — reservoir limit, the sheet clone in oil units:
 * m = -SLOPE(Pwf, t) over ALL rows, Cg from two Bg points (first and last
 * solved rows), Ct = Cg*Sg + Co*So + Cw*Sw + Cf (oil defaults Sg 0.1 /
 * So 0.8 / Sw 0.15), STOIP = qavg/(Ct*m)/1e6 MMstb.
 */
export function reservoirLimitOil(cfg, solvedRows, {
  sg = 0.1, so = 0.8, sw = 0.15,
  cfPsi = 3e-6, coPsi = 1e-6, cwPsi = 1e-6, cgOverride,
} = {}) {
  if (solvedRows.length < 3) throw new Error('reservoir limit needs at least 3 rows');
  const s = lsqSlope(solvedRows.map((r) => r.dtDays), solvedRows.map((r) => r.pwfPsi));
  const m = s == null ? null : -s;
  const a = solvedRows[0];
  const b = solvedRows[solvedRows.length - 1];
  const bg1 = bgCfScf(cfg.tresF, a.z, a.presPsi);
  const bg2 = bgCfScf(cfg.tresF, b.z, b.presPsi);
  const cg = cgOverride ?? (bg1 - bg2) / bg1 / (b.presPsi - a.presPsi);
  const ct = cg * sg + coPsi * so + cwPsi * sw + cfPsi;
  const qAvg = solvedRows.reduce((x, r) => x + r.qOilStbD, 0) / solvedRows.length;
  const out = {
    slopePsiDay: m, cg, ct, bg1, qAvgStbD: qAvg,
    stoiipMMstb: m > 0 ? qAvg / (ct * m) / 1e6 : null,
  };
  if (!(m > 0)) out.warning = 'Pwf not declining — no pss depletion slope';
  return out;
}
