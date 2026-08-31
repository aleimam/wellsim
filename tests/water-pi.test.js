// The User-PI basis on the Water Well tab — no source workbook here (the
// water tab is WellSim's own extension), so these pin the METHOD: a typed J
// drives the linear water IPR (Pb = 0), the matched K closes the loop with
// the Darcy demo, and both water lifts run on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/server/api.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

const WATER_PI = {
  fluid: 'water', iprBasis: 'pi', userJ: '4.12',
  thpPsi: '200', tubingIdIn: '2.992', roughness: '0.00006',
  topPerfAhM: '2810', devStartM: '1910', devAngleDeg: '7',
  waterSg: '1.05', gasSg: '0.842', tresF: '201', injTempF: '90',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '4800', prPsi: '', permMd: '', thicknessFt: '42.653', reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
  matchHead: '1', matchFriction: '1',
  api: '10', wcPct: '100', gorScfStb: '0', rsiScfStb: '0', pbPsi: '0',
  testQOilStbD: '2000', testThpPsi: '200', testPwfPsi: '',
};

test('water PI: typed J drives the linear IPR and K closes the demo loop', () => {
  const r = handlers['oil/nodal']({ ...WATER_PI, liftType: 'natural' });
  assert.ok(!r.error, r.error);
  close(r.ipr.j, 4.12, 1e-12);
  close(r.ipr.jDarcy, 4.12, 1e-12);
  // the demo water well's Darcy J at K = 50 is ~4.12, so the matched K from
  // typing that J back must land on ~50 — the round trip through
  // permFromJOil closes (water: mu 0.5 cp hardcoded, Bw = 1)
  close(r.ipr.matchedPermMd, 50, 0.01);
  // linear IPR: AOF = J * Pr exactly (Pb = 0, no Vogel bend)
  close(r.aofOilStbD, 4.12 * 4800, 1e-9);
  assert.ok(r.op && r.op.qOilStbD > 0, 'the well flows');
});

test('water PI: the ESP lift solves and the stage match anchors on it', () => {
  const espForm = {
    ...WATER_PI, liftType: 'esp',
    espPumpMode: 'db', espPumpName: 'ESP B 538-3600', pumpTvdM: '2985', pumpAhM: '2985',
    espFreqHz: '50', espStages: '145', espWearFactor: '0', espSepEffPct: 0,
    espMinIntakePsi: '300',
  };
  const r = handlers['oil/nodal'](espForm);
  assert.ok(!r.error, r.error);
  assert.ok(r.esp && r.esp.pumpDpPsi > 0, 'coupled pump dP solved');

  const m = handlers['oil/espstages'](espForm);
  assert.ok(!m.error, m.error);
  assert.ok(m.stages > 0, `stages ${m.stages}`);
  assert.equal(m.pwfSource, 'ipr');
  // linear IPR anchor: Pwf = Pr - q/J exactly
  close(m.pwfIprPsi, 4800 - 2000 / 4.12, 1e-9);

  // and the typed-Pwf override works on water too
  const o = handlers['oil/espstages']({ ...espForm, testPwfPsi: '4300' });
  assert.equal(o.pwfSource, 'input');
  close(o.pwfIprPsi, 4300, 1e-12);
});

test('water PI: gas lift runs on the typed J', () => {
  const r = handlers['oil/nodal']({
    ...WATER_PI, liftType: 'gaslift',
    injDepthTvdM: '2490.92', injRateMMscfd: '0.4',
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.op && r.op.qOilStbD > 0, 'lifted water well flows');
  close(r.ipr.j, 4.12, 1e-12);
});

test('water: a custom pump curve drives the ESP, thrust read from rows 4/6/8', () => {
  // The UI gained a custom-pump entry on the water tab (31 Aug 2026) — the
  // same 11-row per-stage table as oil, with the thrust markers at the FIXED
  // positions the physics reads (THRUST: index 3 down, 5 BEP, 7 up). This
  // pins the form contract the water custom table submits.
  const curve = [
    { headFt: '64', rateBpd: '0' },      // 0
    { headFt: '62.3', rateBpd: '500' },  // 1
    { headFt: '61', rateBpd: '1000' },   // 2
    { headFt: '60', rateBpd: '1500' },   // 3 <- down-thrust limit
    { headFt: '57', rateBpd: '2500' },   // 4
    { headFt: '54.5', rateBpd: '3000' }, // 5 <- BEP
    { headFt: '50', rateBpd: '3500' },   // 6
    { headFt: '34', rateBpd: '4600' },   // 7 <- up-thrust limit
    { headFt: '24', rateBpd: '5000' },   // 8
    { headFt: '10', rateBpd: '5500' },   // 9
    { headFt: '0', rateBpd: '5700' },    // 10
  ];
  const r = handlers['oil/nodal']({
    ...WATER_PI, liftType: 'esp',
    espPumpMode: 'custom', espPumpName: 'My water pump', espRefFreqHz: '60',
    espCurve: curve, pumpTvdM: '2985', pumpAhM: '2985',
    espFreqHz: '50', espStages: '145', espWearFactor: '0', espSepEffPct: 0,
  });
  assert.ok(!r.error, r.error);
  assert.equal(r.esp.pumpName, 'My water pump');
  assert.ok(r.esp.pumpDpPsi > 0, 'coupled dP solved from the custom curve');
  assert.ok(r.esp.thrust, 'thrust status read from the marker rows');
  // the thrust window comes from rows 3 and 7 scaled by 50/60
  assert.ok(r.op && r.op.qOilStbD > 0, 'well flows on the custom pump');
});
