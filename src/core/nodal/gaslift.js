// Gas-lift performance — the classic operating-rate vs injection-rate curve
// (the workbook's injection-rate sensitivity, taken to its conclusion): for
// each injection rate, solve the full nodal operating point with the
// two-zone gas-lift march (total GLR above the injection depth, formation
// GLR below), then report the optimum and the incremental response.
//
// A well that is dead without lift simply reports 'no-intersection' at the
// low-injection points and 'ok' once the column is light enough — the curve
// shows the kick-off requirement directly.

import { oilOperatingPoint } from './nodal.js';

/**
 * cfg: an oil march config WITH gasLift.injDepthTvdM set (injRateMMscfd is
 * swept). inflowOrIpr: IPR record or inflow object.
 * injRatesMMscfd defaults to 0..2 in 0.2 steps.
 * Returns { points: [{injRateMMscfd, qOilStbD, pwfPsi, status}],
 *   optimum, incremental: [{injRateMMscfd, dQdInjStbPerMMscf}] }.
 */
export function gasLiftPerformance(
  cfg,
  inflowOrIpr,
  { injRatesMMscfd, qMinStbD = 50, capStbD = 10000, samples = 25 } = {}
) {
  if (cfg.gasLift?.injDepthTvdM == null)
    throw new Error('gasLiftPerformance: cfg.gasLift.injDepthTvdM is required (the sweep varies the injection rate at that depth)');
  const rates = injRatesMMscfd ?? Array.from({ length: 11 }, (_, i) => i * 0.2);

  const points = rates.map((r) => {
    const c = { ...cfg, gasLift: { ...cfg.gasLift, injRateMMscfd: r } };
    const op = oilOperatingPoint(c, inflowOrIpr, { qMinStbD, capStbD, samples });
    return op.status === 'ok'
      ? { injRateMMscfd: r, qOilStbD: op.qOp, pwfPsi: op.pwfPsi, status: 'ok' }
      : { injRateMMscfd: r, qOilStbD: null, pwfPsi: null, status: op.status };
  });

  let optimum = null;
  for (const p of points) {
    if (p.status === 'ok' && (optimum == null || p.qOilStbD > optimum.qOilStbD)) optimum = p;
  }

  const incremental = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.status === 'ok' && b.status === 'ok' && b.injRateMMscfd > a.injRateMMscfd) {
      incremental.push({
        injRateMMscfd: b.injRateMMscfd,
        dQdInjStbPerMMscf: (b.qOilStbD - a.qOilStbD) / (b.injRateMMscfd - a.injRateMMscfd),
      });
    }
  }
  return { points, optimum, incremental };
}
