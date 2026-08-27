// Water well — the oil march at its limiting case (fluid:'water'):
// API 10 (SG = 1.000), w.c. 100 %, GOR 0. qOilStbD is the WATER rate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oilMarch, deriveOilFlow, validateOilCfg, oilFraction } from '../src/core/vlp/oil-march.js';
import { oilOperatingPoint } from '../src/core/nodal/nodal.js';
import { createOilIpr, iprCurve, qGrossAtPwf } from '../src/core/ipr/oil-ipr.js';
import { ashryHeadFactor } from '../src/core/vlp/ashry.js';
import { waterDensityLbft3 } from '../src/core/pvt/water.js';

const WCFG = {
  fluid: 'water',
  thpPsi: 200, qOilStbD: 2000, gorScfStb: 0, wcPct: 100, api: 10,
  gasSg: 0.842, rsiScfStb: 0, pbPsi: 0, tresF: 201, oilViscCp: 6,
  waterSg: 1.05, tubingIdIn: 2.992, roughness: 0.00006,
  topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7, perfTvdM: 2802.3,
  soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
  matchHead: 1, matchFriction: 1,
};

test('water flow derivation: rate is gross water, no oil, no gas', () => {
  const f = deriveOilFlow(WCFG);
  assert.equal(f.qw, 2000);
  assert.equal(f.qL, 2000);
  assert.equal(f.yw, 1);
  assert.equal(f.gasFormationScfD, 0);
  assert.equal(f.liqSg, 1.05); // pure water column at water SG
  assert.equal(f.muLCp, 0.5); // the sheets' hardcoded water viscosity
  assert.equal(oilFraction(WCFG), 1);
});

test('wc = 100 rejected for oil, accepted for fluid:"water"', () => {
  assert.throws(() => validateOilCfg({ ...WCFG, fluid: undefined }), /wcPct must be < 100/);
  assert.doesNotThrow(() => validateOilCfg(WCFG));
});

test('water march: single-phase water column — head-dominated Pwf, WHT calculated', () => {
  const m = oilMarch(WCFG);
  // pure-water hydrostatic estimate with the Ashry limiting factor
  const tvdFt = WCFG.perfTvdM / 0.3048;
  const grad = (waterDensityLbft3(1.05) / 144) * ashryHeadFactor(0, 100);
  const headOnly = WCFG.thpPsi + grad * tvdFt;
  assert.ok(m.pwfPsi >= headOnly - 1, `pwf ${m.pwfPsi} vs head-only ${headOnly}`);
  assert.ok(m.pwfPsi < headOnly * 1.06, `pwf ${m.pwfPsi} should be close to head-only ${headOnly} (friction small)`);
  assert.ok(Number.isFinite(m.whtF) && m.whtF > WCFG.soilTempF && m.whtF < WCFG.tresF);
  // friction monotonicity: more water -> higher Pwf (single phase, no gas lift effect)
  const m2 = oilMarch({ ...WCFG, qOilStbD: 6000 });
  assert.ok(m2.pwfPsi > m.pwfPsi);
});

test('water IPR is pure linear (Pb = 0) and the nodal solve lands on it', () => {
  // Pr must beat the static water column (~4300 psi at 2800 mTVD) for
  // natural flow — a water well is head-dominated
  const ipr = createOilIpr({ j: 2.5, priPsi: 4800, pbPsi: 0, prPsi: 4800 });
  // linear everywhere
  assert.equal(qGrossAtPwf(3000, ipr), 2.5 * 1800);
  const curve = iprCurve(ipr);
  assert.equal(curve.length, 11); // fanned grid, no duplicate zeros
  const pwfs = curve.map((p) => p.pwfPsi);
  assert.equal(new Set(pwfs).size, pwfs.length);
  const op = oilOperatingPoint(WCFG, ipr, { capStbD: 8000 });
  assert.equal(op.status, 'ok');
  // operating point consistency: IPR rate at op Pwf equals the op rate (gross basis)
  const qIpr = qGrossAtPwf(op.pwfPsi, ipr);
  assert.ok(Math.abs(qIpr - op.qOp) / op.qOp < 1e-6);
});
