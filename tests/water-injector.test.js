// Water injector — downward march (head adds, friction subtracts), cold
// top-down temperatures, injectivity operating point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waterInjectorMarch,
  injectorOperatingPoint,
  qInjAtPwf,
  pwfAtQInj,
} from '../src/core/vlp/water-injector.js';
import { waterDensityLbft3 } from '../src/core/pvt/water.js';

const ICFG = {
  thpPsi: 1500, qOilStbD: 5000, waterSg: 1.05, tubingIdIn: 2.992,
  roughness: 0.00006, perfTvdM: 2802.3, devStartM: 1910, devAngleDeg: 7,
  tresF: 201, soilTempF: 90, injTempF: 80, htcBtu: 3, tubingOdIn: 3.5,
  cpBtu: 0.51, matchHead: 1, matchFriction: 1,
};

test('injector march: BHIP = THP + head - friction; friction grows with rate', () => {
  const m = waterInjectorMarch(ICFG);
  const tvdFt = ICFG.perfTvdM * 3.281;
  const headOnly = ICFG.thpPsi + (waterDensityLbft3(1.05) / 144) * tvdFt;
  assert.ok(m.pwfPsi < headOnly, `BHIP ${m.pwfPsi} must sit BELOW head-only ${headOnly} (friction subtracts)`);
  assert.ok(m.pwfPsi > headOnly * 0.9, 'friction should be a modest fraction of head');
  const m2 = waterInjectorMarch({ ...ICFG, qOilStbD: 15000 });
  assert.ok(m2.pwfPsi < m.pwfPsi, 'higher rate -> more friction -> lower BHIP');
  // exact energy balance: head on TVD, friction on AH
  const ahFt = m.stations[m.stations.length - 1].ahFt;
  const expected = ICFG.thpPsi + (waterDensityLbft3(1.05) / 144) * tvdFt - m.gradFricPsiFt * ahFt;
  assert.ok(Math.abs(m.pwfPsi - expected) < 1e-6);
});

test('injector temperatures: cold water warms top-down toward geothermal', () => {
  const m = waterInjectorMarch(ICFG);
  assert.ok(m.bhtF > ICFG.injTempF && m.bhtF < ICFG.tresF, `BHT ${m.bhtF}`);
  // temperatures must be monotone increasing down the hole
  for (let i = 1; i < m.stations.length; i++) assert.ok(m.stations[i].tF >= m.stations[i - 1].tF);
  // slower injection soaks up more heat
  const slow = waterInjectorMarch({ ...ICFG, qOilStbD: 500 });
  assert.ok(slow.bhtF > m.bhtF);
});

test('injectivity line and operating point are self-consistent', () => {
  const model = { j: 4, prPsi: 3550 };
  assert.equal(qInjAtPwf(3550, model), 0);
  assert.equal(qInjAtPwf(4050, model), 2000);
  assert.equal(pwfAtQInj(2000, model), 4050);
  const op = injectorOperatingPoint(ICFG, model);
  assert.equal(op.status, 'ok');
  // at the operating point: marched BHIP equals Pr + q/J
  const q = qInjAtPwf(op.pwfPsi, model);
  assert.ok(Math.abs(q - op.qOp) / op.qOp < 1e-5, `q ${q} vs op ${op.qOp}`);
  assert.ok(op.bhtF > ICFG.injTempF && op.bhtF < ICFG.tresF);
});

test('no-injection status when THP + head cannot reach Pr', () => {
  const op = injectorOperatingPoint({ ...ICFG, thpPsi: 10 }, { j: 4, prPsi: 5000 });
  assert.equal(op.status, 'no-injection');
  assert.ok(op.deficitPsi > 0);
});
