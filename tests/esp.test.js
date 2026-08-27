// ESP stack — pump catalog, curve/affinity math, intake gas & separator
// block, coupled dP solve, operating point, and the two matches.
// Pins from Oil well model_ESP_V5.01 (demo: ESP B 538-3600, 145 stages,
// 50 Hz, wear 0, separator 95 %).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESP_PUMPS, pumpByName, THRUST } from '../src/core/vlp/esp-catalog.js';
import {
  pumpCurveAt,
  headAtRateFt,
  thrustStatus,
  espIntakeState,
  espSolveDp,
  espOperatingPoint,
  matchStages,
  matchWearAndPi,
} from '../src/core/vlp/esp.js';
import { createOilIpr } from '../src/core/ipr/oil-ipr.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// the workbook demo well (same cfg as the pinned ESP march tests)
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
const OPTS = { stages: 145, freqHz: 50, wearFactor: 0, sepEffPct: 95 };
// the workbook's PI-input IPR: PI 2.7 bbl/d/psi at constant Pres 2650
const IPR = createOilIpr({ jTest: 2.7, priPsi: 2650, pbPsi: 1911.80724408471, prPsi: 2650 });

test('catalog: 68 pumps, demo curve verbatim, thrust markers', () => {
  assert.equal(ESP_PUMPS.length, 68);
  assert.ok(PUMP, 'demo pump present');
  assert.equal(PUMP.refFreqHz, 60);
  assert.deepEqual(PUMP.points[0], { headFt: 64, rateBpd: 0 });
  assert.deepEqual(PUMP.points[5], { headFt: 54.5, rateBpd: 3000 }); // BEP
  assert.deepEqual(PUMP.points[10], { headFt: 0, rateBpd: 5700 });
  assert.equal(THRUST.bep, 5);
});

test('affinity + stages scaling pinned (ESP!E21, H21)', () => {
  const at60 = pumpCurveAt(PUMP, { stages: 145, freqHz: 60 });
  close(at60[0].headFt, 9280); // E21 = 64*145
  const at30 = pumpCurveAt(PUMP, { stages: 145, freqHz: 30 });
  close(at30[0].headFt, 2320); // H21 = (30/60)^2*9280
  close(at30[1].rateBpd, 250); // I22 = 500*(30/60)
});

test('theoretical head + dP pinned (ESP!AK23, B4)', () => {
  const curve = pumpCurveAt(PUMP, OPTS);
  const head = headAtRateFt(curve, 3332.4373630216); // B10 Qgross @ pump
  close(head, 4303.97372559841, 1e-9); // AK23
  close(head * 0.307891727757973, 1325.15790659941, 1e-9); // B4 (grad = BJ39)
});

test('intake state pinned to the BHP 63-69 block', () => {
  // the workbook block at its converged intake (Pint 1397.59, station T)
  const s = espIntakeState(CFG, { pIntakePsi: 1397.59061968516, tIntakeF: 230, sepEffPct: 95 });
  // Rs/Bo/Bg at intake are Standing-metric at the station temperature — the
  // sheet used the march station T (~229 F near TD); at Tres the values pin
  // within a small band
  close(s.rs, 263.65928755432, 0.02); // AV65
  close(s.bo, 1.20509194767988, 0.01); // AU65
  close(s.bgBblScf, 0.00213260471943437, 0.03); // AX65
  close(s.qGrossPumpNoSepBpd, 5327.94119025296, 0.03); // BD65
  close(s.qGrossPumpBpd, 3332.4373630216, 0.03); // BD69
  close(s.freeGasPct, 12.3552316154176, 0.05); // BE65
  close(s.sepCutPct, 11.3675469229856, 0.06); // BE74
  close(s.gradPsiFt, 0.307891727757973, 0.03); // BJ39
  assert.equal(s.sepRequired, true); // BF65 (>10 %)
  // no separator: gassier, lighter column
  const s0 = espIntakeState(CFG, { pIntakePsi: 1397.59061968516, tIntakeF: 230, sepEffPct: 0 });
  assert.ok(s0.gradPsiFt < s.gradPsiFt);
  close(s0.gradPsiFt, 0.204440252648098, 0.03); // BJ38
});

test('coupled dP solve converges near the workbook operating state', () => {
  const sol = espSolveDp(CFG, PUMP, OPTS);
  assert.ok(sol.converged, 'dP fixed point must converge');
  close(sol.dpPsi, 1325.15790659941, 0.06); // march drift band
  close(sol.tubingGasScfD, 872994.209827361, 0.08); // BHP!P10
  close(sol.march.intakePsi, 1397.59061968516, 0.06);
  close(sol.march.dischargePsi, 2722.74852628457, 0.06);
});

test('ESP operating point: traverses meet at the intake (PI 2.7, Pres const)', () => {
  const op = espOperatingPoint(CFG, IPR, PUMP, OPTS);
  assert.equal(op.status, 'ok');
  // the workbook demo ran at 2565 stb/d with a ~6 psi residual mismatch;
  // our converged match lands in the same neighbourhood
  close(op.qOilStbD, 2565, 0.08);
  assert.ok(Math.abs(op.pintTraversePsi - op.pintIprPsi) < 0.5, 'intake match must close');
  assert.ok(op.pdisPsi > op.pintTraversePsi);
  close(op.dpPsi, op.pdisPsi - op.pintTraversePsi, 1e-6);
  assert.equal(op.thrust.status, 'ok');
  assert.ok(op.state.sepRequired);
});

test('stage match (new pump, wear 0) recovers the installed stage count with the design proof', () => {
  const m = matchStages(CFG, IPR, PUMP, { freqHz: 50, sepEffPct: 95, testQOilStbD: 2565 });
  assert.ok(m.stages >= 120 && m.stages <= 175, `stages=${m.stages}`); // 145 +- march drift
  // design proof at the default 300 psi floor: the demo intake (~1390 psi)
  // clears it comfortably
  assert.equal(m.capped, false);
  assert.equal(m.designOk, true);
  assert.ok(m.intakePsi > 300, `intake=${m.intakePsi}`);
});

test('design floor caps the stage count when the match would starve the intake', () => {
  // an artificially high floor forces the cap branch
  const m = matchStages(CFG, IPR, PUMP, {
    freqHz: 50, sepEffPct: 95, testQOilStbD: 2565, minIntakePsi: 1500,
  });
  assert.equal(m.capped, true);
  assert.ok(m.stages < m.stagesMatch, `capped ${m.stages} must undercut the match ${m.stagesMatch}`);
  // the capped design proves the floor: intake at/above 1500 psi
  assert.ok(m.intakePsi >= 1500 - 2, `intake=${m.intakePsi}`);
});

test('ESP API: final charts and the Pres-sensitivity cases with solved nodes', async () => {
  const { oilEsp, oilEspSens } = await import('../src/server/api.js');
  const F = {
    thpPsi: 160, qOilStbD: 2565, wcPct: 5, gorScfStb: 384, api: 32,
    gasSg: 0.812, rsiScfStb: 384, tresF: 230, oilViscCp: 6, waterSg: 1.05,
    tubingIdIn: 2.992, roughness: 0.00006, topPerfAhM: 3240, devStartM: 1500,
    devAngleDeg: 0, soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
    priPsi: 2650, prPsi: 2650, permMd: 54.816, thicknessFt: 42.653,
    reFt: 1640.5, rwFt: 0.5104166667, skin: 0, matchHead: 1, matchFriction: 1,
    liftType: 'esp', pumpTvdM: 2985, espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
    espStages: 145, espFreqHz: 50, espWearFactor: 0, espSepEffPct: 95,
  };
  const r = oilEsp(F);
  assert.ok(!r.error, r.error);
  assert.ok(r.iprCurve.length > 5 && r.vlpCurve.length > 5 && r.whpCurve.length > 5);
  assert.ok(r.op.designFloor.ok, 'demo intake clears the 300 psi floor');
  const s = oilEspSens({ ...F, presList: [2400, 2100] });
  assert.ok(!s.error, s.error);
  assert.equal(s.cases.length, 2);
  for (const c of s.cases) {
    assert.ok(c.j > 0);
    if (c.op) {
      assert.ok(c.op.qOilStbD > 0 && c.op.pintPsi > 0 && c.op.dpPsi > 0);
      assert.ok(c.op.pdisPsi > c.op.pintPsi);
    }
  }
  // lower Pres -> lower solved rate
  const ok = s.cases.filter((c) => c.op);
  if (ok.length === 2) assert.ok(ok[1].op.qOilStbD < ok[0].op.qOilStbD);
});

test('manual-dP ESP nodal returns the traverse with the dP step at pump depth', async () => {
  const { oilNodal } = await import('../src/server/api.js');
  const r = oilNodal({
    thpPsi: 160, qOilStbD: 2565, wcPct: 5, gorScfStb: 384, api: 32,
    gasSg: 0.812, rsiScfStb: 384, tresF: 230, oilViscCp: 6, waterSg: 1.05,
    tubingIdIn: 2.992, roughness: 0.00006, topPerfAhM: 3240, devStartM: 1500,
    devAngleDeg: 0, soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
    priPsi: 2650, prPsi: 2650, permMd: 54.816, thicknessFt: 42.653,
    reFt: 1640.5, rwFt: 0.5104166667, skin: 0, matchHead: 1, matchFriction: 1,
    liftType: 'esp', pumpTvdM: 2985, pumpDpPsi: 1325.158,
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.espTraverse, 'espTraverse expected in manual-dP mode');
  const t = r.espTraverse;
  // the input dP appears as a same-depth step in the station list
  const pumpFt = 2985 * 3.281;
  const atPump = t.stations.filter((s) => Math.abs(s.tvdFt - pumpFt) < 0.5);
  assert.equal(atPump.length, 2, 'discharge AND intake stations at pump depth');
  close(atPump[0].pPsi - atPump[1].pPsi, 1325.158, 1e-9);
  close(t.dischargePsi - t.intakePsi, 1325.158, 1e-9);
  assert.ok(t.backStations.length >= 3);
});

test('wear + PI match from the measured Pint/Pdis couple', () => {
  const m = matchWearAndPi(CFG, IPR, PUMP, {
    stages: 145, freqHz: 50, sepEffPct: 95,
    measPintPsi: 1392, measPdisPsi: 2720, qOilStbD: 2565,
  });
  // demo gauges sit on the new-pump curve: wear ~ 0, PI ~ 2.7
  assert.ok(Math.abs(m.wearFactor) < 0.08, `wear=${m.wearFactor}`);
  close(m.dpMeasPsi, 1328);
  close(m.jMatched, 2.7, 0.15);
});
