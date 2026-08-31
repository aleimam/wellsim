// Natural oil — the shipped defaults ARE "Oil well model Natural_V3.1.7.xls",
// verified cell by cell on 31 Aug 2026 (author decision: natural stays on the
// DARCY basis, defaults as the workbook). Every UI default matched the
// workbook already — THP 700 (I5), GOR 5000 (I6), WC 50 (I7), trajectory
// 2810/1910/7 (D3:D5), API 46, gg 0.842, Rsi 700, Tres 201, Pres 3550 (B3),
// K 50 / H 42.653 / Re 1640.5 / Rw 0.5104166667 / S 0 (B30:B34), roughness
// 0.00006 (BHP!S6), test 2100 @ 700 (B22/A22) — including the demo's GOR
// 5000 vs Rsi 700 inconsistency, which is the workbook's own (I6 vs B5).
// These tests pin the IPR arithmetic that follows from those inputs, so a
// future defaults edit that drifts from the workbook fails here.

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

// the natural demo exactly as the UI ships it (Darcy basis — the default)
const NAT_WB = {
  iprBasis: 'darcy',
  thpPsi: '700', wcPct: '50', gorScfStb: '5000', tubingIdIn: '2.992', roughness: '0.00006',
  topPerfAhM: '2810', devStartM: '1910', devAngleDeg: '7',
  api: '46', gasSg: '0.842', rsiScfStb: '700', tresF: '201',
  oilViscCp: '6', waterSg: '1.05', pbPsi: '',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '3550', prPsi: '',
  permMd: '50', thicknessFt: '42.653', reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
  matchHead: '1', matchFriction: '1',
  testQOilStbD: '2100', testThpPsi: '700', testPwfPsi: '',
  liftType: 'natural',
};

test('natural workbook: Pb and the Darcy J_2 are exact', () => {
  const r = handlers['oil/nodal'](NAT_WB);
  assert.ok(!r.error, r.error);
  close(r.pbPsi, 1920.00761413, 1e-9); // 'VLP-IPR'!B2
  // B38 J_2 = 0.00708*K*H/(mu*Bo*(ln(Re/Rw)-0.75+S)) with the workbook's own
  // mu (B35 = 0.305393) and Bo (B36 = 1.428792) at Pr — our correlations
  // reproduce those cells, so the J must land on the workbook's value
  close(r.ipr.jDarcy, 4.72389052864, 1e-6);
  assert.equal(r.ipr.jSource, 'darcy', 'natural stays Darcy-based (author decision)');
});

test('natural workbook: the Jones J from the test point (B16) is exact', () => {
  // B16 reads the macro-written test Pwf (C22 = 2661.29425223) at Qgross
  // B19 = 4200 (= 2100 / (1 - 50%)) — the QC value the calibrate button shows
  const j = jFromTest({
    qGrossStbD: 4200,
    pwfPsi: 2661.29425223,
    priPsi: 3550,
    pbPsi: 1920.00761413,
  });
  close(j, 4.72597371013, 1e-9);
});

test('natural workbook: Qmax (B15) follows from the Jones J exactly', () => {
  // B15 = F27 = 12744.3597787 gross — composite Vogel at J = B16, straight
  // segment to Pb plus the Vogel tail
  const J = 4.72597371013;
  const pb = 1920.00761413;
  const qmax = J * (3550 - pb) + (J * pb) / 1.8;
  close(qmax, 12744.3597787, 1e-9);
});

test('natural workbook: the two J records agree the way the author left them', () => {
  // the author had already matched K = 50 by hand: Darcy 4.7239 vs Jones
  // 4.7260 — within half a percent. The demo must keep telling that story.
  const r = handlers['oil/nodal'](NAT_WB);
  const jJones = 4.72597371013;
  assert.ok(
    Math.abs(r.ipr.jDarcy - jJones) / jJones < 0.005,
    `Darcy ${r.ipr.jDarcy} vs Jones ${jJones} drifted apart`
  );
});
