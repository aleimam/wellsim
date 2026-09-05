// Separator-efficiency match — golden tests on the workbook demo ESP well
// (Oil well model_ESP_V5.01: ESP B 538-3600, 145 stages, 50 Hz, separator
// 95 %). The demo gauges Pint 1392 / Pdis 2720 sit on the NEW-pump curve at
// sep = 95 %, so solving for eta with wear held at 0 must recover ~95 %.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSepEff } from '../src/core/vlp/esp.js';
import { pumpByName } from '../src/core/vlp/esp-catalog.js';
import { createOilIpr } from '../src/core/ipr/oil-ipr.js';
import * as api from '../src/server/api.js';

const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };
const CFG = {
  ...HEAT,
  thpPsi: 160, qOilStbD: 2565, gorScfStb: 384, wcPct: 5, api: 32,
  gasSg: 0.812, tresF: 230, perfTvdM: 3240, devStartM: 1500, devAngleDeg: 0,
  tubingIdIn: 2.992, roughness: 0.00006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 384, pbPsi: 1911.80724408471, matchHead: 1, matchFriction: 1,
  esp: { pumpTvdM: 2985, pumpDpPsi: 0 },
};
const PUMP = pumpByName('ESP B 538-3600');
const IPR = createOilIpr({ jTest: 2.7, priPsi: 2650, pbPsi: 1911.80724408471, prPsi: 2650 });
const BASE = { stages: 145, freqHz: 50, measPintPsi: 1392, measPdisPsi: 2720, qOilStbD: 2565 };
const run = (o = {}) => matchSepEff(CFG, IPR, PUMP, { ...BASE, ...o });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}±${tol}, got ${a}`);

test('sep match: demo gauges at wear 0 recover the workbook separator (~95 %)', () => {
  const m = run({ wearFactor: 0 });
  assert.equal(m.status, 'ok');
  near(m.sepEffPct, 95.16, 0.3, 'eta');
  near(m.sepEffPct, 95, 1.0, 'eta vs the workbook 95 %');
  assert.equal(m.dpMeasPsi, 1328);
  near(m.dpAtEta100Psi, 1421.6, 1.0, 'dP at 100 %');
  near(m.jMatched, 2.7, 0.02, 'PI');
  near(m.freeGasPct, 12.35, 0.1, 'true free gas at intake');
  assert.ok(m.freeGasPctSep < 1.5, 'free gas after separation');
  assert.equal(m.intakeAbovePb, false);
  assert.equal(m.nearGasLock, false);
});

test('sep match: sweep is monotonic non-decreasing and exposes the gas-lock regime', () => {
  const m = run();
  for (let i = 1; i < m.sweep.length; i++)
    assert.ok(m.sweep[i].dpPsi >= m.sweep[i - 1].dpPsi - 1e-6, `dP dipped at eta ${m.sweep[i].sepEffPct}`);
  assert.equal(m.sweep[0].dpPsi, 0); // no head at 0 % — gas-locked
  assert.ok(m.sweep[m.sweep.length - 1].dpPsi > 1400);
  assert.ok(m.gasLockBelowPct > 25 && m.gasLockBelowPct <= 30, `gas-lock boundary ${m.gasLockBelowPct}`);
});

test('sep match: a worn pump needs MORE separation for the same dP', () => {
  const eta0 = run({ wearFactor: 0 }).sepEffPct;
  const m5 = run({ wearFactor: 0.05 });
  assert.equal(m5.status, 'ok');
  assert.ok(m5.sepEffPct > eta0, `wear 0.05 -> eta ${m5.sepEffPct} should exceed ${eta0}`);
});

test('sep match: wear held 0.10 leaves no eta that fits -> above-range, named', () => {
  const m = run({ wearFactor: 0.10 });
  assert.equal(m.status, 'above-range');
  assert.equal(m.sepEffPct, null);
  near(m.gapPsi, 48.6, 1.0, 'surplus');
  assert.match(m.diagnosis, /Even perfect separation/);
  assert.match(m.diagnosis, /stages, frequency or PI/);
});

test('sep match: a low dP is a valid LOW-efficiency match, not an error', () => {
  const m = run({ measPdisPsi: 1700 }); // dP 308
  assert.equal(m.status, 'ok');
  near(m.sepEffPct, 39.6, 0.3, 'eta');
});

test('sep match: a Pwf measured at the perfs anchors PI and gives a consistency check', () => {
  const m0 = run();
  const m = run({ testPwfPsi: m0.pwfBackPsi });
  near(m.pwfCheckPsi, 0, 1e-6, 'pwf check');
  near(m.jMatched, m0.jMatched, 1e-9, 'PI');
  const mOff = run({ testPwfPsi: m0.pwfBackPsi + 50 });
  near(mOff.pwfCheckPsi, -50, 1e-6, 'pwf check');
  assert.ok(mOff.jMatched !== m0.jMatched, 'PI follows the MEASURED Pwf');
});

test('api: oil/espsepeff holds the wear input and writes nothing itself', () => {
  assert.ok(api.handlers['oil/espsepeff'], 'route registered');
  // the same form the other ESP API tests use (esp.test.js ESP_WELL + GEOM)
  const f = {
    thpPsi: '160', wcPct: '5', gorScfStb: '384', tubingIdIn: '2.992', roughness: '0.00006',
    topPerfAhM: '3240', devStartM: '1500', devAngleDeg: '0', api: '32', gasSg: '0.812',
    rsiScfStb: '384', tresF: '230', oilViscCp: '6', waterSg: '1.05', pbPsi: '',
    soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51', priPsi: '3550',
    iprMode: 'pi', userPresPsi: '2650', userJ: '2.7', matchHead: '1', matchFriction: '1',
    liftType: 'esp', espPumpMode: 'db', espStages: '145', espFreqHz: '50',
    pumpAhM: '2985', espSepEffPct: '95', testThpPsi: '160', testPwfPsi: '',
    prPsi: '2650', permMd: '50', thicknessFt: '42.653', reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
    espPumpName: 'ESP B 538-3600', qOilStbD: '2565', testQOilStbD: '2565',
    espWearFactor: '0', espMeasPintPsi: '1392', espMeasPdisPsi: '2720',
  };
  const r = api.handlers['oil/espsepeff'](f);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.status, 'ok');
  near(r.sepEffPct, 95.16, 0.5, 'eta via the API');
  assert.equal(r.wearHeld, 0);
  assert.ok(r.sweep.length >= 20);
});
