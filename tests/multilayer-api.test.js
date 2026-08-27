// Multi-layer Darcy IPR through the API — oil and gas nodal solves with the
// optional layer block (core collapse itself is pinned in multilayer.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oilNodal, gasNodal, oilCalibrate, gasCalibrate } from '../src/server/api.js';

const OIL_BASE = {
  thpPsi: 700, qOilStbD: 2100, wcPct: 50, gorScfStb: 5000, tubingIdIn: 2.992,
  roughness: 0.00006, topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7,
  api: 46, gasSg: 0.842, rsiScfStb: 700, tresF: 201, oilViscCp: 6,
  waterSg: 1.05, soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
  priPsi: 3550, permMd: 50, thicknessFt: 42.653, reFt: 1640.5,
  rwFt: 0.5104166667, skin: 0, matchHead: 1, matchFriction: 1, liftType: 'natural',
};

const GAS_BASE = {
  thpPsi: 1625, qGasMMscfd: 14.137, cgrStbMMscf: 57.4358974, wgrStbMMscf: 3.8461538,
  tubingIdIn: 2.992, roughnessBase: 0.0021, topPerfAhM: 3013, devStartM: 690,
  devAngleDeg: 23.65, condApi: 48.7, gasSg: 0.763, n2Pct: 1.2, co2Pct: 3,
  h2sPpm: 2, tresF: 232, oilViscCp: 2, sigmaDyneCm: 30, soilTempF: 90,
  htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51, priPsi: 3800, permMd: 5,
  thicknessFt: 80, reFt: 1640.5, rwFt: 0.5104166667, skin: 0,
  matchHead: 1, matchFriction: 1, iprMode: 'j',
};

test('oil nodal with 2 Darcy layers: PrAvg between layer Prs, layers sum to the op rate', () => {
  const r = oilNodal({
    ...OIL_BASE,
    mlMode: 'multi',
    mlLayers: [
      { permMd: 50, thicknessFt: 42.653, skin: 0, prPsi: 3550, wcPct: 50, gorScfStb: 5000 },
      { permMd: 20, thicknessFt: 30, skin: 0, prPsi: 3000, wcPct: 60, gorScfStb: 4000 },
    ],
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.multiLayer, 'multiLayer block expected');
  assert.ok(r.multiLayer.prAvgPsi > 3000 && r.multiLayer.prAvgPsi < 3550, `PrAvg=${r.multiLayer.prAvgPsi}`);
  assert.equal(r.computed.prPsi, r.multiLayer.prAvgPsi);
  assert.ok(r.multiLayer.blended.wcPct > 50 && r.multiLayer.blended.wcPct < 60);
  assert.equal(r.opStatus, 'ok');
  const t = r.multiLayer.layersAtOp.totals;
  // the equivalent J is matched at the solution point, so the layer sum at
  // the op Pwf tracks the equivalent-record rate within a few percent
  const qEq = r.op.qOilStbD;
  assert.ok(Math.abs(t.qOilStbD - qEq) / qEq < 0.1, `layers ${t.qOilStbD} vs op ${qEq}`);
  assert.equal(r.multiLayer.layersAtOp.layers.length, 2);
});

test('oil multi-layer needs at least 2 layers', () => {
  const r = oilNodal({ ...OIL_BASE, mlMode: 'multi', mlLayers: [{ permMd: 50, thicknessFt: 40, prPsi: 3550 }] });
  assert.ok(/at least 2 layers/.test(r.error));
});

test('gas nodal with 2 Darcy layers: exact collapse — layers sum equals the op rate', () => {
  const r = gasNodal({
    ...GAS_BASE,
    mlMode: 'multi',
    mlLayers: [
      { permMd: 5, thicknessFt: 80, skin: 0, prPsi: 3800, cgrStbMMscf: 57.4, wgrStbMMscf: 3.8 },
      { permMd: 3, thicknessFt: 50, skin: 0, prPsi: 3300, cgrStbMMscf: 40, wgrStbMMscf: 2 },
    ],
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.multiLayer, 'multiLayer block expected');
  assert.ok(r.multiLayer.prAvgPsi > 3300 && r.multiLayer.prAvgPsi < 3800, `PrAvg=${r.multiLayer.prAvgPsi}`);
  assert.equal(r.opStatus, 'ok');
  const t = r.multiLayer.layersAtOp.totals;
  // gas J-form collapse is exact at EVERY Pwf
  const rel = Math.abs(t.qMMscfd - r.op.qMMscfd) / r.op.qMMscfd;
  assert.ok(rel < 1e-6, `layers ${t.qMMscfd} vs op ${r.op.qMMscfd} (rel ${rel})`);
  assert.ok(r.multiLayer.blended.cgrStbMMscf > 40 && r.multiLayer.blended.cgrStbMMscf < 57.4);
});

test('oil multi-layer fit to Jones: scaled layer Ks land the total J on the test J', () => {
  const layers = [
    { permMd: 50, thicknessFt: 42.653, skin: 0, prPsi: 3550, wcPct: 50, gorScfStb: 5000 },
    { permMd: 20, thicknessFt: 30, skin: 0, prPsi: 3000, wcPct: 60, gorScfStb: 4000 },
  ];
  const f = { ...OIL_BASE, mlMode: 'multi', mlLayers: layers, testQOilStbD: 2100, testThpPsi: 700 };
  const cal = oilCalibrate(f);
  assert.ok(!cal.error, cal.error);
  assert.ok(cal.mlFit, 'mlFit expected');
  assert.ok(cal.mlFit.scale > 0);
  assert.equal(cal.mlFit.layers.length, 2);
  // apply the solved Ks and re-solve: total J must equal the Jones J exactly
  const scaled = layers.map((l, i) => ({ ...l, permMd: cal.mlFit.layers[i].kNew }));
  const r = oilNodal({ ...OIL_BASE, mlMode: 'multi', mlLayers: scaled });
  assert.ok(!r.error, r.error);
  const rel = Math.abs(r.multiLayer.jFinal - cal.mlFit.jTestMl) / cal.mlFit.jTestMl;
  assert.ok(rel < 1e-6, `jFinal ${r.multiLayer.jFinal} vs jTestMl ${cal.mlFit.jTestMl} (rel ${rel})`);
  // PrAvg is scale-invariant
  assert.ok(Math.abs(r.multiLayer.prAvgPsi - cal.mlFit.prAvgPsi) < 1e-6);
});

test('gas multi-layer fit to the test J: exact by linearity', () => {
  const layers = [
    { permMd: 5, thicknessFt: 80, skin: 0, prPsi: 3800, cgrStbMMscf: 57.4, wgrStbMMscf: 3.8 },
    { permMd: 3, thicknessFt: 50, skin: 0, prPsi: 3300, cgrStbMMscf: 40, wgrStbMMscf: 2 },
  ];
  const f = {
    ...GAS_BASE, mlMode: 'multi', mlLayers: layers,
    testPoints: [{ qMMscfd: 14.137, thpPsi: 1625 }],
  };
  const cal = gasCalibrate(f);
  assert.ok(!cal.error, cal.error);
  assert.ok(cal.mlFit, 'mlFit expected');
  const scaled = layers.map((l, i) => ({ ...l, permMd: cal.mlFit.layers[i].kNew }));
  const r = gasNodal({ ...GAS_BASE, mlMode: 'multi', mlLayers: scaled });
  assert.ok(!r.error, r.error);
  const rel = Math.abs(r.multiLayer.jFinal - cal.mlFit.jTestMl) / cal.mlFit.jTestMl;
  assert.ok(rel < 1e-9, `jFinal ${r.multiLayer.jFinal} vs jTestMl ${cal.mlFit.jTestMl} (rel ${rel})`);
});

test('gas C&n mode ignores the multi-layer block (no exact collapse)', () => {
  const r = gasNodal({
    ...GAS_BASE,
    iprMode: 'cn', cValue: 0.005, nValue: 0.9,
    mlMode: 'multi',
    mlLayers: [
      { permMd: 5, thicknessFt: 80, prPsi: 3800 },
      { permMd: 3, thicknessFt: 50, prPsi: 3300 },
    ],
  });
  assert.ok(!r.error, r.error);
  assert.equal(r.multiLayer, null);
});
