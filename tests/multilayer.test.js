// Multi-layer IPR tests — behaviors from the "4. Multi Layer Oil IPR" deck.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOilIpr, qGrossAtPwf, qMaxGross } from '../src/core/ipr/oil-ipr.js';
import { createGasIpr, qGasAtPwfJ } from '../src/core/ipr/gas-ipr.js';
import {
  multiLayerOilRates,
  multiLayerOilCurve,
  prAvgOil,
  equivalentOilIpr,
  multiLayerGasRates,
  equivalentGasIpr,
} from '../src/core/ipr/multilayer.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual}`
  );
}

const L1 = {
  name: 'A',
  ipr: createOilIpr({ j: 2, priPsi: 3000, pbPsi: 100 }),
  wcPct: 20,
  gorScfStb: 500,
};
const L2 = {
  name: 'B',
  ipr: createOilIpr({ j: 3, priPsi: 2600, pbPsi: 100 }),
  wcPct: 60,
  gorScfStb: 200,
};

test('rate summation and fluid blending (Qt = sum Qi, WC/GOR/GLR blends)', () => {
  const r = multiLayerOilRates(2000, [L1, L2]);
  const q1 = 2 * 1000; // linear region
  const q2 = 3 * 600;
  close(r.totals.qGrossStbD, q1 + q2);
  const qw = q1 * 0.2 + q2 * 0.6;
  close(r.totals.qWaterStbD, qw);
  close(r.totals.wcPct, (qw / (q1 + q2)) * 100);
  const gas = q1 * 0.8 * 500 + q2 * 0.4 * 200;
  close(r.totals.qGasScfD, gas);
  close(r.totals.gorScfStb, gas / (q1 * 0.8 + q2 * 0.4));
  close(r.totals.glrScfStb, gas / (q1 + q2));
  assert.equal(r.warnings.length, 0);
});

test('two identical layers double the single-layer curve exactly', () => {
  const single = createOilIpr({ j: 2, priPsi: 3000, pbPsi: 1500 });
  const twin = [{ ipr: single, wcPct: 30, gorScfStb: 400 }, { ipr: single, wcPct: 30, gorScfStb: 400 }];
  for (const pwf of [2500, 1500, 800, 0]) {
    close(multiLayerOilRates(pwf, twin).totals.qGrossStbD, 2 * qGrossAtPwf(pwf, single));
  }
  const eq = equivalentOilIpr(twin, { pwfSolutionPsi: 1000 });
  close(eq.prAvgPsi, 3000);
  close(eq.ipr.j, 2 * 2); // one final J = exactly twice the layer J
  close(qMaxGross(eq.ipr), 2 * qMaxGross(single));
});

test('theoretical average reservoir pressure (linear layers: J-weighted mean)', () => {
  close(prAvgOil([L1, L2]), (2 * 3000 + 3 * 2600) / 5, 1e-6); // 2760
});

test('crossflow: weak layer takes fluid, slide-7 pathologies flagged, clamp option', () => {
  const r = multiLayerOilRates(2800, [L1, L2]); // above layer B's Pr
  assert.ok(r.layers[1].qGrossStbD < 0);
  assert.ok(r.warnings.some((w) => w.includes('crossflow')));
  close(r.totals.qGrossStbD, 2 * 200 + 3 * -200);
  // clamped: injecting layer shut
  const c = multiLayerOilRates(2800, [L1, L2], { allowCrossflow: false });
  close(c.totals.qGrossStbD, 2 * 200);
  // slide-7 "WC < 0": strong dry producer, weak wet layer taking fluid —
  // net gross positive but net water negative
  const dry = { ipr: createOilIpr({ j: 5, priPsi: 3000, pbPsi: 100 }), wcPct: 0, gorScfStb: 500 };
  const wet = { ipr: createOilIpr({ j: 3, priPsi: 2600, pbPsi: 100 }), wcPct: 90, gorScfStb: 0 };
  const p = multiLayerOilRates(2800, [dry, wet]);
  assert.ok(p.totals.qGrossStbD > 0);
  assert.ok(p.totals.wcPct < 0, `wc=${p.totals.wcPct}`);
  assert.ok(p.warnings.some((w) => w.includes('outside [0,100]')));
});

test('equivalent single IPR reproduces the composite at the solution point', () => {
  const eq = equivalentOilIpr([L1, L2], { pwfSolutionPsi: 1800 });
  const trueTotals = multiLayerOilRates(1800, [L1, L2]).totals;
  close(qGrossAtPwf(1800, eq.ipr), trueTotals.qGrossStbD, 1e-9); // exact at match point
  close(eq.wcPct, trueTotals.wcPct);
  close(eq.gorScfStb, trueTotals.gorScfStb);
  assert.ok(eq.prAvgPsi > 2600 && eq.prAvgPsi < 3000);
  // and stays a reasonable approximation elsewhere on the curve
  const q0 = multiLayerOilRates(500, [L1, L2]).totals.qGrossStbD;
  const qe = qGrossAtPwf(500, eq.ipr);
  assert.ok(Math.abs(qe - q0) / q0 < 0.05, `${qe} vs ${q0}`);
});

test('multi-layer curve spans max Pr to zero and is monotone', () => {
  const curve = multiLayerOilCurve([L1, L2], { points: 20 });
  close(curve[0].pwfPsi, 3000);
  close(curve[curve.length - 1].pwfPsi, 0);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].qGrossStbD > curve[i - 1].qGrossStbD);
});

test('gas multi-layer: summation, CGR/WGR blend, exact closed-form equivalent', () => {
  const G1 = { ipr: createGasIpr({ j: 2e-3, priPsi: 3800 }), cgrStbMMscf: 60, wgrStbMMscf: 4 };
  const G2 = { ipr: createGasIpr({ j: 1e-3, priPsi: 3200 }), cgrStbMMscf: 10, wgrStbMMscf: 20 };
  const r = multiLayerGasRates(2500, [G1, G2]);
  const q1 = qGasAtPwfJ(2500, G1.ipr);
  const q2 = qGasAtPwfJ(2500, G2.ipr);
  close(r.totals.qMMscfd, q1 + q2);
  close(r.totals.cgrStbMMscf, (q1 * 60 + q2 * 10) / (q1 + q2));
  close(r.totals.wgrStbMMscf, (q1 * 4 + q2 * 20) / (q1 + q2));

  const eq = equivalentGasIpr([G1, G2]);
  close(eq.jFinal, 3e-3);
  close(eq.prAvgPsi, Math.sqrt((2e-3 * 3800 ** 2 + 1e-3 * 3200 ** 2) / 3e-3));
  // exact collapse: equivalent equals the sum at EVERY pwf
  for (const pwf of [3000, 2000, 1000, 0]) {
    close(qGasAtPwfJ(pwf, eq.ipr), qGasAtPwfJ(pwf, G1.ipr) + qGasAtPwfJ(pwf, G2.ipr), 1e-9);
  }
});
