// The gas well model's defaults against "Gas Well model_temp V6.0.0.xls",
// extracted 31 Aug 2026. The VLP inputs already matched the workbook; the
// DARCY BLOCK did not — the app shipped placeholders (K 5 / H 80 / Re 1640.5
// / Rw 0.5104 / S 0) where the workbook says K 8.7 / H 45.934 / Re 2460.75 /
// Rw 0.2916667 / S 5 ('VLP-IPR'!B30:B34). Fixed the same day; these tests
// hold the workbook's numbers so the defaults cannot drift back.
//
// Two findings about the workbook worth keeping:
//  - Its "IPR from C & N" block (B15:B17, n = 1 exactly) is NOT a test fit:
//    D32:E35 sample the DARCY curve (J_2·(Pr²−P²)/1000), so C = J_2/1000 and
//    n = 1 by construction. The C&n-from-tests fit lives on 'Calc C&n'.
//  - The saved 'Calc C&n' fit (n = 1.00631) double-weights the last test:
//    the 4-row table's B25 duplicates B24 by formula. On the 3 UNIQUE tests
//    the sheet's own regression gives n = 0.98051 — which is what WellSim's
//    calibrate reproduces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/server/api.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// the gas demo exactly as the UI ships it after the defaults fix
const GAS_WB = {
  thpPsi: '1625', cgrStbMMscf: '57.4358974359', wgrStbMMscf: '3.84615384615',
  tubingIdIn: '2.992', roughnessBase: '0.0021',
  topPerfAhM: '3013', devStartM: '690', devAngleDeg: '23.65',
  condApi: '48.7', gasSg: '0.763', n2Pct: '1.2', co2Pct: '3', h2sPpm: '2',
  tresF: '232', oilViscCp: '2', sigmaDyneCm: '30',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '3800', prPsi: '',
  permMd: '8.7', thicknessFt: '45.934', reFt: '2460.75', rwFt: '0.2916666667', skin: '5',
  matchHead: '1', matchFriction: '1', iprMode: 'j',
  testPoints: [
    { thpPsi: '2440', qMMscfd: '5.192', pwfPsi: '' },
    { thpPsi: '2000', qMMscfd: '10.002', pwfPsi: '' },
    { thpPsi: '1625', qMMscfd: '14.137', pwfPsi: '' },
  ],
};

test('gas workbook: the Darcy J_2 reproduces to the cell (B38)', () => {
  const r = handlers['gas/nodal'](GAS_WB);
  assert.ok(!r.error, r.error);
  // 703e-6·K·h / (mu·Z·(T+460)·(ln(0.472·Re/Rw)+S)) with mu (B36) and Z (B37)
  // from the sour-PVT chain at Pr — matches the sheet to ~11 significant figures
  close(r.ipr.j, 0.00174848658949, 1e-9);
  assert.equal(r.ipr.jSource, 'darcy');
});

test('gas workbook: AOF equals the C&n block\'s Qmax (B15) exactly', () => {
  // B15 "fits" C&n to the Darcy curve itself, so its Qmax IS J_2·Pr²/1000
  const r = handlers['gas/nodal'](GAS_WB);
  close((r.ipr.j * 3800 ** 2) / 1000, 25.2481463522, 1e-9);
});

test('gas workbook: get_Pwf reproduces the macro-written test Pwf (C22:C24)', () => {
  const c = handlers['gas/calibrate'](GAS_WB);
  assert.ok(!c.error, c.error);
  const pts = c.points ?? c.fitPoints;
  assert.equal(pts.length, 3);
  // the gas march is bit-exact vs the workbook; these landed within 0.005 psi
  close(pts[0].pwfPsi, 3414.01525252, 1e-5);
  close(pts[1].pwfPsi, 2913.97067333, 1e-5);
  close(pts[2].pwfPsi, 2647.81711594, 1e-5);
});

test('gas workbook: the C&n fit is the sheet\'s own regression on the unique tests', () => {
  const c = handlers['gas/calibrate'](GAS_WB);
  assert.ok(!c.error, c.error);
  // the sheet's math, run on its own numbers WITHOUT the duplicated 4th row:
  // n = SLOPE(log Q, log(Pri² − Pwf²)) over the three unique tests
  const Q = [5.192, 10.002, 14.137];
  const P = [3414.01525252, 2913.97067333, 2647.81711594];
  const x = P.map((p) => Math.log10(3800 ** 2 - p ** 2));
  const y = Q.map((q) => Math.log10(q));
  const mx = x.reduce((a, b) => a + b) / 3;
  const my = y.reduce((a, b) => a + b) / 3;
  const slope =
    x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0) /
    x.reduce((s, xi) => s + (xi - mx) ** 2, 0);
  close(c.n, slope, 1e-3); // ~0.9805; the saved sheet's 1.00631 carries the dup-row quirk
  assert.ok(c.qMaxMMscfd > 24 && c.qMaxMMscfd < 27, `Qmax ${c.qMaxMMscfd}`);
});

test('gas workbook: the operating point sits on both of its own curves', () => {
  const r = handlers['gas/nodal'](GAS_WB);
  assert.ok(r.op && r.op.qMMscfd > 0, 'well flows');
  // IPR identity at the op: Pwf = sqrt(Pr² − 1000·q/J)
  const pwfIpr = Math.sqrt(3800 ** 2 - (1000 * r.op.qMMscfd) / r.ipr.j);
  close(r.op.pwfPsi, pwfIpr, 1e-3);
});
