// Multi-layer IPR — "4. Multi Layer Oil IPR" and the gas deck's multi-layer
// slide. Each layer keeps its OWN full IPR record (two-Pr / two-J structure
// included) plus its own WC and GOR (oil) or CGR/WGR (gas); the commingled
// well sums rates at a common flowing pressure and blends the fluid ratios:
//   Qt = Q1 + Q2 + ...          WC_t = Qw_t/Qgross_t
//   GOR_t = gas_t/Qoil_t        GLR_t = gas_t/Qgross_t
//
// A layer whose Pr is below the common Pwf takes fluid IN (negative rate —
// crossflow). The deck's slide-7 "open discussion" pathologies (Qgross_t <
// Qoil_t, WC_t < 0) arise exactly then; they are detected and reported as
// warnings, and allowCrossflow: false clamps injecting layers to zero
// (no-crossflow / check-valve assumption).
//
// The "one final J" (deck slide 6): the commingled system collapses to ONE
// equivalent IPR — the Theoretical Average Reservoir Pressure is the Pwf at
// which Qt = 0 (the commingled static pressure a gauge would stabilize at),
// and the final J comes from the general equation at a chosen Solution
// Point (a Pwf near expected operation). For gas J-form layers the
// equivalent is exact and closed-form: J_t = sum(J_i),
// PrAvg = sqrt(sum(J_i*Pr_i^2)/sum(J_i)).

import { qGrossAtPwf, jFromTest, createOilIpr } from './oil-ipr.js';
import { qGasAtPwfJ, qGasAtPwfCn, createGasIpr } from './gas-ipr.js';
import { brent } from '../solvers/brent.js';

// ---------------- OIL ----------------

/** One oil layer at a common Pwf. layer: { ipr, wcPct, gorScfStb, name? }. */
export function oilLayerRates(pwfPsi, layer) {
  const qGross = qGrossAtPwf(pwfPsi, layer.ipr);
  const qw = (qGross * layer.wcPct) / 100;
  const qo = qGross - qw;
  return { name: layer.name, qGrossStbD: qGross, qWaterStbD: qw, qOilStbD: qo, qGasScfD: qo * layer.gorScfStb };
}

/**
 * Commingled totals at a common Pwf.
 * Returns { layers, totals: { qGrossStbD, qOilStbD, qWaterStbD, qGasScfD,
 * wcPct, gorScfStb, glrScfStb }, warnings }.
 */
export function multiLayerOilRates(pwfPsi, layers, { allowCrossflow = true } = {}) {
  const warnings = [];
  const per = layers.map((l) => {
    let r = oilLayerRates(pwfPsi, l);
    if (r.qGrossStbD < 0) {
      warnings.push(`layer ${l.name ?? '?'}: crossflow (Pwf ${pwfPsi.toFixed(0)} > Pr ${l.ipr.prPsi.toFixed(0)})`);
      if (!allowCrossflow) r = { ...r, qGrossStbD: 0, qWaterStbD: 0, qOilStbD: 0, qGasScfD: 0 };
    }
    return r;
  });
  const t = per.reduce(
    (a, r) => ({
      qGrossStbD: a.qGrossStbD + r.qGrossStbD,
      qOilStbD: a.qOilStbD + r.qOilStbD,
      qWaterStbD: a.qWaterStbD + r.qWaterStbD,
      qGasScfD: a.qGasScfD + r.qGasScfD,
    }),
    { qGrossStbD: 0, qOilStbD: 0, qWaterStbD: 0, qGasScfD: 0 }
  );
  const totals = {
    ...t,
    wcPct: t.qGrossStbD !== 0 ? (t.qWaterStbD / t.qGrossStbD) * 100 : null,
    gorScfStb: t.qOilStbD !== 0 ? t.qGasScfD / t.qOilStbD : null,
    glrScfStb: t.qGrossStbD !== 0 ? t.qGasScfD / t.qGrossStbD : null,
  };
  if (totals.wcPct != null && (totals.wcPct < 0 || totals.wcPct > 100))
    warnings.push(`blended WC ${totals.wcPct.toFixed(1)}% outside [0,100] (slide-7 pathology: crossflow distorts the blend)`);
  if (t.qGrossStbD < t.qOilStbD)
    warnings.push('Qgross total < Qoil total (slide-7 pathology)');
  return { layers: per, totals, warnings };
}

/** Composite IPR curve from max layer Pr down to 0. */
export function multiLayerOilCurve(layers, { points = 25, allowCrossflow = true } = {}) {
  const top = Math.max(...layers.map((l) => l.ipr.prPsi));
  const curve = [];
  for (let i = 0; i <= points; i++) {
    const pwf = top * (1 - i / points);
    curve.push({ pwfPsi: pwf, ...multiLayerOilRates(pwf, layers, { allowCrossflow }).totals });
  }
  return curve;
}

/**
 * Per-layer IPR curves on the SAME Pwf grid as the composite, for plotting
 * each layer beside the total.
 *
 * Both come from ONE call to multiLayerOilRates per grid point rather than a
 * second implementation, so at every Pwf the layer rates sum to the total by
 * construction — including under allowCrossflow: false, where the clamp has
 * to apply identically to both or the picture lies.
 *
 * A layer whose Pr sits below the grid Pwf carries a NEGATIVE rate. That is
 * crossflow, and it is returned rather than clipped: a curve crossing into
 * the negative half is the plainest statement that the well is pushing fluid
 * INTO that layer, and hiding it would make the total look unexplained.
 */
export function multiLayerOilCurves(layers, { points = 25, allowCrossflow = true } = {}) {
  const top = Math.max(...layers.map((l) => l.ipr.prPsi));
  const per = layers.map((l) => ({
    name: l.name,
    prPsi: l.ipr.prPsi,
    j: l.ipr.j,
    wcPct: l.wcPct,
    gorScfStb: l.gorScfStb,
    curve: [],
  }));
  const total = [];
  for (let i = 0; i <= points; i++) {
    const pwfPsi = top * (1 - i / points);
    const r = multiLayerOilRates(pwfPsi, layers, { allowCrossflow });
    r.layers.forEach((lr, k) => per[k].curve.push({ pwfPsi, ...lr }));
    total.push({ pwfPsi, ...r.totals });
  }
  return { layers: per, total };
}

/** Theoretical Average Reservoir Pressure (deck slide 6): the Pwf at which
 *  the commingled total rate is zero — crossflow included by definition. */
export function prAvgOil(layers) {
  const qt = (pwf) => multiLayerOilRates(pwf, layers).totals.qGrossStbD;
  const prs = layers.map((l) => l.ipr.prPsi);
  const lo = Math.min(...prs);
  const hi = Math.max(...prs);
  if (lo === hi) return lo;
  return brent(qt, lo, hi, { tol: 1e-9 }).root;
}

/**
 * Collapse the layers into ONE equivalent IPR record — "one final J".
 * pwfSolutionPsi: the Solution Point (deck slide 6) where the equivalent
 * general-equation J is matched to the true composite rate; defaults to
 * half the theoretical average pressure. pbPsi defaults to the highest
 * layer Pb (curvature starts earliest). The blended WC/GOR at the solution
 * point are returned — they are the fluid inputs the VLP march needs.
 * Returns { ipr, prAvgPsi, pwfSolutionPsi, totalsAtSolution, wcPct,
 * gorScfStb, warnings }.
 */
export function equivalentOilIpr(layers, { pwfSolutionPsi, pbPsi } = {}) {
  const prAvg = prAvgOil(layers);
  const pwfSol = pwfSolutionPsi ?? prAvg / 2;
  const pb = pbPsi ?? Math.max(...layers.map((l) => l.ipr.pbPsi));
  const { totals, warnings } = multiLayerOilRates(pwfSol, layers);
  if (!(totals.qGrossStbD > 0))
    throw new Error('equivalentOilIpr: no net inflow at the solution Pwf — choose a lower pwfSolutionPsi');
  const jFinal = jFromTest({ qGrossStbD: totals.qGrossStbD, pwfPsi: pwfSol, priPsi: prAvg, pbPsi: pb });
  return {
    ipr: createOilIpr({ jTest: jFinal, priPsi: prAvg, pbPsi: pb }),
    prAvgPsi: prAvg,
    pwfSolutionPsi: pwfSol,
    totalsAtSolution: totals,
    wcPct: totals.wcPct,
    gorScfStb: totals.gorScfStb,
    warnings,
  };
}

// ---------------- GAS ----------------

/** One gas layer at a common Pwf. layer: { ipr ({j}|{c,n} record),
 *  cgrStbMMscf, wgrStbMMscf, name? }. */
export function gasLayerRates(pwfPsi, layer) {
  const q =
    layer.ipr.c != null ? qGasAtPwfCn(pwfPsi, layer.ipr) : qGasAtPwfJ(pwfPsi, layer.ipr);
  return {
    name: layer.name,
    qMMscfd: q,
    qCondStbD: q * layer.cgrStbMMscf,
    qWaterStbD: q * layer.wgrStbMMscf,
  };
}

/** Commingled gas totals with blended CGR/WGR (gas deck multi-layer slide). */
export function multiLayerGasRates(pwfPsi, layers, { allowCrossflow = true } = {}) {
  const warnings = [];
  const per = layers.map((l) => {
    let r = gasLayerRates(pwfPsi, l);
    if (r.qMMscfd < 0) {
      warnings.push(`layer ${l.name ?? '?'}: crossflow (Pwf ${pwfPsi.toFixed(0)} > Pr ${l.ipr.prPsi.toFixed(0)})`);
      if (!allowCrossflow) r = { ...r, qMMscfd: 0, qCondStbD: 0, qWaterStbD: 0 };
    }
    return r;
  });
  const t = per.reduce(
    (a, r) => ({
      qMMscfd: a.qMMscfd + r.qMMscfd,
      qCondStbD: a.qCondStbD + r.qCondStbD,
      qWaterStbD: a.qWaterStbD + r.qWaterStbD,
    }),
    { qMMscfd: 0, qCondStbD: 0, qWaterStbD: 0 }
  );
  return {
    layers: per,
    totals: {
      ...t,
      cgrStbMMscf: t.qMMscfd !== 0 ? t.qCondStbD / t.qMMscfd : null,
      wgrStbMMscf: t.qMMscfd !== 0 ? t.qWaterStbD / t.qMMscfd : null,
    },
    warnings,
  };
}

/**
 * Exact closed-form equivalent for J-form gas layers:
 * Qt = sum(J_i (Pr_i^2 - p^2))/1000 = (sum J_i)(PrAvg^2 - p^2)/1000 with
 * PrAvg = sqrt(sum(J_i Pr_i^2)/sum(J_i)) — the collapse is exact at every
 * Pwf, not just a match point. Throws for C&n layers (no exact collapse).
 */
export function equivalentGasIpr(layers) {
  if (layers.some((l) => l.ipr.c != null))
    throw new Error('equivalentGasIpr: exact collapse needs J-form layers (C&n layers have no closed-form equivalent)');
  const jT = layers.reduce((a, l) => a + l.ipr.j, 0);
  const prAvg = Math.sqrt(layers.reduce((a, l) => a + l.ipr.j * l.ipr.prPsi ** 2, 0) / jT);
  return { ipr: createGasIpr({ jTest: jT, priPsi: prAvg }), prAvgPsi: prAvg, jFinal: jT };
}
