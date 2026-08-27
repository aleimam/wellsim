// Tarner forecast — sub-formulas pinned to the workbook Tarner sheet cells,
// plus full-march sanity in both Pwf modes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kroTarner,
  krgTarner,
  j1Tarner,
  ctTermTarner,
  soFromMb,
  gpFromMb,
  gorTarner,
  tarnerForecast,
} from '../src/core/reserve/tarner.js';
import { bubblePointPsi } from '../src/core/pvt/oil.js';

function close(actual, expected, rel = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

test('rel-perm polynomials pinned to sheet cells', () => {
  close(kroTarner(0.849992946651004), 0.645107358613536); // AA16
  close(kroTarner(0.85001827749065), 0.645152751831721); // F16
  close(krgTarner(7.05334899597787e-6), 0.00510060213873274); // AB16
  close(krgTarner(-1.82774906499483e-5), 0.0051057722781774); // G16 (raw poly)
});

test('MB saturation, Gp, GOR and ct pinned to sheet row 16', () => {
  const ct = ctTermTarner(5292.95509109307, {
    priPsi: 5343, swi: 0.15, cwPsi: 2.63e-6, cfPsi: 3.25e-6,
  });
  close(ct, 0.000214574906483881, 1e-9); // R16
  close(
    soFromMb({ swi: 0.15, nMMstb: 16, npMMstb: 0.00356593893714073, bo: 1.26010221261134, boi: 1.26010221261134, ct }),
    0.849992946651004, 1e-12
  ); // Y16
  close(
    gpFromMb({ nMMstb: 16, npMMstb: 0.00356593893714073, rsi: 412, rs: 412, bo: 1.26010221261134, boi: 1.26010221261134, bg: 0.000669225658723945, ct }),
    1.21922646451984, 1e-9
  ); // O16
  close(
    gorTarner({ rs: 412, krg: 0.00510060213873274, kro: 0.645107358613536, muO: 0.468145482479709, muG: 0.0256412578652618, bo: 1.26010221261134, bg: 0.000669225658723945 }),
    683.809200885494, 1e-11
  ); // P16
  close(j1Tarner({ permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0 }),
    (0.00708 * 50 * 42.653) / (Math.log(1640.5 / 0.5104166667) - 0.75));
});

// the natural-well demo fluid
const PVT_IN = { rsiScfStb: 700, gasSg: 0.842, api: 46, tempF: 201 };
const PVT = { pbPsi: bubblePointPsi(PVT_IN), ...PVT_IN };
const CFG = {
  thpPsi: 300, qOilStbD: 2000, gorScfStb: 700, wcPct: 0, api: 46,
  gasSg: 0.842, rsiScfStb: 700, tresF: 201, oilViscCp: 6, waterSg: 1.05,
  tubingIdIn: 2.992, roughness: 0.00006, topPerfAhM: 2810, devStartM: 1910,
  devAngleDeg: 7, perfTvdM: 2802.3, soilTempF: 90, htcBtu: 3,
  tubingOdIn: 3.5, cpBtu: 0.51, matchHead: 1, matchFriction: 1,
};
const DARCY = { permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0 };

test('fixed-Pwf Tarner march: pressure declines, Np accumulates, GOR rises past Pb', () => {
  const f = tarnerForecast({
    cfg: CFG, pvt: PVT, darcy: DARCY, nMMstb: 15, priPsi: 3550,
    pwfMode: 'fixed', minPwfPsi: 500, stepDays: 30, maxSteps: 80,
  });
  assert.ok(f.rows.length > 10, `rows=${f.rows.length}`);
  for (let i = 1; i < f.rows.length; i++) {
    assert.ok(f.rows[i].presPsi <= f.rows[i - 1].presPsi + 1e-6, 'Pres must decline');
    assert.ok(f.rows[i].npMMstb > f.rows[i - 1].npMMstb, 'Np must grow');
  }
  const last = f.rows[f.rows.length - 1];
  assert.ok(last.soFrac < 0.85 && last.soFrac > 0.3, `So=${last.soFrac}`);
  // below Pb free gas builds and the producing GOR must exceed Rs
  const belowPb = f.rows.filter((r) => r.presPsi < PVT.pbPsi - 200);
  if (belowPb.length > 2) {
    const l = belowPb[belowPb.length - 1];
    assert.ok(l.gorScfStb > 700, `GOR ${l.gorScfStb} should exceed Rsi below Pb`);
    assert.ok(l.sgFrac > 0, 'free gas saturation must appear below Pb');
  }
  assert.ok(f.eurMMstb > 0.3 && f.eurMMstb < 15);
  assert.ok(['max-steps', 'abandoned', 'depleted', 'died'].includes(f.status));
});

test('VLP-coupled Tarner march: back-pressure respected, natural death when lift fails', () => {
  const f = tarnerForecast({
    cfg: { ...CFG, thpPsi: 150 }, pvt: PVT, darcy: DARCY, nMMstb: 50, priPsi: 3550,
    pwfMode: 'vlp', fthpPsi: 150, minPwfPsi: 500, stepDays: 30, maxSteps: 60,
  });
  assert.ok(f.rows.length > 10, `rows=${f.rows.length} status=${f.status}`);
  for (const r of f.rows) {
    assert.ok(r.pwfPsi >= 500 - 1e-6, 'Pwf floors at min Pwf');
    assert.ok(r.pwfPsi < r.presPsi, 'drawdown must be positive');
    assert.ok(r.converged, 'every step must converge');
  }
  // the marched Pwf must sit above the fixed-mode floor
  assert.ok(f.rows[0].pwfPsi > 500, 'VLP back-pressure should exceed the min-Pwf floor');
  // the natural well eventually dies (or the run caps out) — never nonsense
  assert.ok(['died', 'abandoned', 'max-steps', 'depleted'].includes(f.status));
  // rate must trend down over the life
  assert.ok(f.rows[f.rows.length - 1].qOilStbD < f.rows[0].qOilStbD / 2);
});
