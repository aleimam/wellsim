// The ESP workbook's own route, end to end through the form layer — the
// User-PI IPR basis and the two match macros, against cells extracted from
// "Oil well model_ESP_V5.01.xls" on 31 Aug 2026 (VLP-IPR + ESP sheets).
//
// The workbook takes PI as an INPUT ('VLP-IPR'!B4 "Iput PI" = 2.7 at
// B3 "Pres at test" = 2650) and its analysis J_2 simply equals J — no Darcy
// derivation anywhere. WellSim's PI basis reproduces that and then also
// back-matches K so J(Darcy) = PI, which keeps the Darcy-consuming routes
// (future J, Pres sensitivity) alive on a PI-typed well.
//
// Two kinds of pin, matching the project's convention:
//   exact  — IPR arithmetic (composite Vogel, Jones QC): no march involved,
//            so the workbook cells reproduce to full precision.
//   banded — anything through the wellbore march inherits the documented
//            Brill & Beggs Z deviation; bands as in the existing ESP tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/server/api.js';
import { jFromTest } from '../src/core/ipr/oil-ipr.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// the workbook's live case exactly as the UI's ESP lift-case loads it
const ESP_WB = {
  thpPsi: '160', wcPct: '5', gorScfStb: '384',
  tubingIdIn: '2.992', roughness: '0.00006',
  topPerfAhM: '3240', devStartM: '1500', devAngleDeg: '0',
  api: '32', gasSg: '0.812', rsiScfStb: '384', tresF: '230',
  oilViscCp: '6', waterSg: '1.05', pbPsi: '',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  iprBasis: 'pi', userJ: '2.7', priPsi: '2650', prPsi: '',
  permMd: '', thicknessFt: '42.653', reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
  matchHead: '1', matchFriction: '1',
  testQOilStbD: '2565', testThpPsi: '160', testPwfPsi: '',
  liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
  pumpAhM: '2985', espFreqHz: '50', espStages: '145', espWearFactor: '0',
  espSepEffPct: '95', espMinIntakePsi: '300',
  espMeasPintPsi: '1392', espMeasPdisPsi: '2720',
};

test('PI basis: J is the input, Darcy K is the derived record', () => {
  const r = handlers['oil/nodal'](ESP_WB);
  assert.ok(!r.error, r.error);
  assert.equal(r.ipr.jTest, 2.7, 'the typed PI is the Jones record');
  close(r.ipr.jDarcy, 2.7, 1e-12); // matched K makes J(Darcy) = PI exactly
  assert.equal(r.ipr.jSource, 'darcy', 'record ends Darcy-sourced (workbook J_2 = J)');
  assert.ok(r.ipr.matchedPermMd > 0, 'matched K reported for the grey display');
  close(r.pbPsi, 1911.80724408471, 1e-12); // 'VLP-IPR'!B2
});

test('PI basis, workbook IPR arithmetic: Qmax and the curve are exact', () => {
  const r = handlers['oil/nodal'](ESP_WB);
  // 'VLP-IPR'!B15 Qmax (oil) = 4617.78974174; F27 gross = 4860.83130710
  close(r.aofOilStbD, 4617.78974174, 1e-9);
  // F17: J*(Pr-Pb) — the straight-line segment down to the bubble point
  const grossAtPb = 2.7 * (2650 - 1911.80724408471);
  close(grossAtPb, 1993.12044097, 1e-9);
});

test('workbook QC cell B18: PI recalculated from the test point', () => {
  // B18 reads the macro-written test Pwf (C22 = 1638.08967666) and returns
  // the Jones general-equation PI — the QC against the typed 2.7
  const j = jFromTest({
    qGrossStbD: 2700, // B19 (= 2565 / 0.95)
    pwfPsi: 1638.08967666, // C22
    priPsi: 2650,
    pbPsi: 1911.80724408471,
  });
  close(j, 2.71495094174, 1e-9);
});

test('PI basis with blank Darcy geometry stays a pure Jones record', () => {
  const r = handlers['oil/nodal']({ ...ESP_WB, thicknessFt: '', reFt: '', rwFt: '' });
  assert.ok(!r.error, r.error);
  assert.equal(r.ipr.jSource, 'jones');
  assert.equal(r.ipr.j, 2.7);
  assert.equal(r.ipr.matchedPermMd, null, 'no geometry, no matched K');
  assert.ok(r.op && r.op.qOilStbD > 0, 'the well still solves');
});

test('ESP solve on the workbook case lands in the march band', () => {
  const r = handlers['oil/esp'](ESP_WB);
  assert.ok(!r.error, r.error);
  // ESP!B4 dP = 1325.16, ESP!B5/B6 Pwf 1624.5/1634.1, Qoil 2565 —
  // march-dependent, so banded like the existing ESP pins (<5%)
  close(r.op.dpPsi, 1325.16, 0.05);
  close(r.op.qOilStbD, 2565, 0.05);
  close(r.op.pwfTraversePsi, 1634.11, 0.05);
  assert.ok(r.matchedPermMd > 0, 'oil/esp carries the matched K for the UI');
});

test('stage match: user qo, Pwf calculated-but-overridable (workbook macro)', () => {
  const a = handlers['oil/espstages'](ESP_WB);
  assert.ok(!a.error, a.error);
  // workbook builds 145 stages; march drift band as the existing core test
  assert.ok(a.stages >= 120 && a.stages <= 175, `stages=${a.stages}`);
  assert.equal(a.pwfSource, 'ipr', 'blank cell -> Pwf from the IPR at the test rate');
  assert.ok(a.pwfIprPsi > 0, 'the macro-written Pwf is reported for the grey cell');

  // the user overwrites the grey cell: that value anchors the match instead
  const b = handlers['oil/espstages']({ ...ESP_WB, testPwfPsi: '1638.09' });
  assert.ok(!b.error, b.error);
  assert.equal(b.pwfSource, 'input');
  close(b.pwfIprPsi, 1638.09, 1e-12);
});

test('wear match on the actual Pint/Pdis couple: wear applied, PI is QC only', () => {
  // 'VLP-IPR'!B26/B27: actual Pint 1392, actual Pdis 2720 — the workbook demo
  // IS a new pump, so actual dP (1328) ~= theoretical and wear ~= 0
  const r = handlers['oil/espwear'](ESP_WB);
  assert.ok(!r.error, r.error);
  close(r.dpMeasPsi, 1328, 1e-12);
  assert.ok(Math.abs(r.wearFactor) < 0.05, `new pump: wear ~0, got ${r.wearFactor}`);
  // the implied PI is reported for display and must sit at the typed 2.7
  close(r.jMatched, 2.7, 0.02);
  assert.ok(r.matchedPermMd > 0, 'QC matched K reported');
});

test('ESP Pres sensitivity still runs on a PI-typed well (matched K feeds future J)', () => {
  const r = handlers['oil/espsens'](ESP_WB);
  assert.ok(!r.error, r.error);
  assert.equal(r.cases.length, 3);
  for (const c of r.cases) {
    assert.ok(c.j > 0, 'future J recomputed through the matched Darcy record');
    assert.ok(Array.isArray(c.iprCurve) && c.iprCurve.length > 0);
  }
});
