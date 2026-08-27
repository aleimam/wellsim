// Nodal analysis: VLP curves on the workbooks' rate grids, the IPR/VLP
// operating point (bottomhole node), and the wellhead PQ curve
// (WHP = Pwf_IPR - Pwf_VLP + THP, gas 'VLP-IPR'!P16 convention).
//
// The operating-point solve replaces the workbooks' visual chart
// intersection: sample the rate axis, bracket every sign change of
// R(q) = Pwf_VLP(q) - Pwf_IPR(q), and polish each with Brent. When the
// curves cross more than once (gassy friction-dominated wells), the
// highest-rate crossing is the hydraulically stable operating point.

import { brent } from '../solvers/brent.js';
import { oilMarch, oilFraction } from '../vlp/oil-march.js';
import { gasMarch } from '../vlp/gas-march.js';
import { pwfAtQGross, qMaxGross } from '../ipr/oil-ipr.js';
import { pwfAtQGasJ, pwfAtQGasCn, aofGasJ } from '../ipr/gas-ipr.js';

/** Oil VLP-rate grid exactly as the VLP_solver macro builds I16:I28:
 *  [q0, q0+D/30, q0+D/30+D/11, ..., q0+D/30+10D/11, cap], D = cap-q0. */
export function oilRateGrid(qMinStbD, capStbD) {
  const d = capStbD - qMinStbD;
  const q1 = qMinStbD + d / 30;
  const grid = [qMinStbD, q1];
  for (let i = 1; i <= 10; i++) grid.push(q1 + (d / 11) * i);
  grid.push(capStbD);
  return grid;
}

/** Gas VLP-rate grid as the gas VLP macro builds I16:I28:
 *  [q0, q0+D/50, q0+D/11, q0+2D/11, ..., q0+10D/11, cap]. */
export function gasRateGrid(qMinMMscfd, capMMscfd) {
  const d = capMMscfd - qMinMMscfd;
  const grid = [qMinMMscfd, qMinMMscfd + d / 50];
  for (let i = 1; i <= 10; i++) grid.push(qMinMMscfd + (d / 11) * i);
  grid.push(capMMscfd);
  return grid;
}

/** Oil VLP point: Pwf from the march at an OIL rate (BHP!C8 basis). */
export function oilVlpPwf(cfg, qOilStbD) {
  return oilMarch({ ...cfg, qOilStbD }).pwfPsi;
}

/** Gas VLP point. */
export function gasVlpPwf(cfg, qGasMMscfd) {
  return gasMarch({ ...cfg, qGasMMscfd }).pwfPsi;
}

/** VLP curve over a rate grid. vlpPwf: (q) => psi. */
export function vlpCurve(vlpPwf, rates) {
  return rates.map((q) => ({ q, pwfPsi: vlpPwf(q) }));
}

/**
 * Generic operating point. iprPwf/vlpPwf: (q) => psi over [qMin, qMax].
 * Returns { status: 'ok', qOp, pwfPsi, roots: [{q, pwfPsi}] } or
 * { status: 'no-intersection', minAbsR, atQ }.
 */
export function operatingPoint({ iprPwf, vlpPwf, qMin, qMax, samples = 25, tol = 1e-6 }) {
  const R = (q) => vlpPwf(q) - iprPwf(q);
  const qs = [];
  for (let i = 0; i <= samples; i++) qs.push(qMin + ((qMax - qMin) * i) / samples);
  const rs = qs.map(R);

  const roots = [];
  for (let i = 1; i < qs.length; i++) {
    if (Number.isNaN(rs[i - 1]) || Number.isNaN(rs[i])) continue;
    if (rs[i - 1] === 0) roots.push(qs[i - 1]);
    else if (rs[i - 1] * rs[i] < 0) {
      const { root, converged } = brent(R, qs[i - 1], qs[i], { tol });
      if (converged) roots.push(root);
    }
  }
  if (rs[rs.length - 1] === 0) roots.push(qs[qs.length - 1]);

  if (roots.length === 0) {
    let best = 0;
    for (let i = 1; i < rs.length; i++) if (Math.abs(rs[i]) < Math.abs(rs[best])) best = i;
    return { status: 'no-intersection', minAbsR: rs[best], atQ: qs[best] };
  }
  const qOp = roots[roots.length - 1]; // stable (highest-rate) crossing
  return {
    status: 'ok',
    qOp,
    pwfPsi: iprPwf(qOp),
    roots: roots.map((q) => ({ q, pwfPsi: iprPwf(q) })),
  };
}

/** Accept either a bare IPR record or an inflow object (createOilInflow /
 *  createGasInflow) — the inflow's active `ipr` is used. */
function toIpr(inflowOrIpr) {
  return inflowOrIpr.ipr ?? inflowOrIpr;
}

/**
 * Oil-well nodal solve (natural or gas-lift): intersects the composite
 * Vogel IPR with the march, both on the OIL-rate axis.
 * inflowOrIpr: an IPR record { j, prPsi, pbPsi } (gross basis) or an inflow
 * object from createOilInflow (single or multi-layer). cfg: the march
 * config (wcPct links the two bases). capStbD defaults to the workbook's
 * 10000 cap.
 */
export function oilOperatingPoint(cfg, inflowOrIpr, { qMinStbD = 50, capStbD = 10000, samples = 25 } = {}) {
  const ipr = toIpr(inflowOrIpr);
  const oilFrac = oilFraction(cfg); // water well: rate axis IS gross liquid
  const aofOil = qMaxGross(ipr) * oilFrac;
  const qMax = Math.min(aofOil * 0.999, capStbD);
  const iprPwf = (qOil) => pwfAtQGross(qOil / oilFrac, ipr);
  const vlpPwf = (qOil) => oilVlpPwf(cfg, qOil);
  return { ...operatingPoint({ iprPwf, vlpPwf, qMin: qMinStbD, qMax, samples }), aofOilStbD: aofOil };
}

/** Gas-well nodal solve. model: an IPR record ({j, prPsi} or {c, n, prPsi})
 *  or an inflow object from createGasInflow. */
export function gasOperatingPoint(cfg, inflowOrModel, { qMinMMscfd = 0.1, samples = 25 } = {}) {
  const model = toIpr(inflowOrModel);
  const iprPwf =
    model.c != null ? (q) => pwfAtQGasCn(q, model) : (q) => pwfAtQGasJ(q, model);
  const aof = model.c != null
    ? model.c * model.prPsi ** (2 * model.n)
    : aofGasJ(model);
  const qMax = aof * 0.999;
  const vlpPwf = (q) => gasVlpPwf(cfg, q);
  return { ...operatingPoint({ iprPwf, vlpPwf, qMin: qMinMMscfd, qMax, samples }), aofMMscfd: aof };
}

/**
 * Wellhead PQ curve (gas 'VLP-IPR'!O:Q convention, also the oil WHP CURVE
 * chart): WHP(q) = Pwf_IPR(q) - Pwf_VLP(q) + THP. Positive WHP means the
 * well flows at this rate with wellhead pressure to spare; WHP = THP at the
 * operating rate.
 */
export function whpCurve({ iprPwf, vlpPwf, thpPsi, rates }) {
  return rates.map((q) => ({
    q,
    whpPsi: iprPwf(q) - vlpPwf(q) + thpPsi,
    pwfIprPsi: iprPwf(q),
    pwfVlpPsi: vlpPwf(q),
  }));
}
