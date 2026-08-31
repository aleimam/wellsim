// The GasLift workbook's saved case through the form layer — the PI basis
// carrying the workbook's SOLVED Jones J as the input (author directive,
// 31 Aug 2026), against cells extracted from
// "Oil well model_GasLift_V3.1.7.xls" VLP-IPR on the same day.
//
// Unlike the ESP workbook there is NO PI input cell here: B16 J = 1.07896794858
// is CALCULATED from the test point (B19 Qgross 1820 at C22 Pwf 3313.2, Pres
// B3 = 5000), and the author hand-tuned the Darcy K (B30 = 16.37) until J_2
// (B38 = 1.07856) matched it. The PI basis automates exactly that: type the
// Jones J, get the matched K — which must land where the author's hand did.

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

// the workbook's saved case exactly as the UI's Gas lift case loads it
const GL_WB = {
  liftType: 'gaslift', iprBasis: 'pi', userJ: '1.07896794858',
  thpPsi: '300', wcPct: '25', gorScfStb: '412', tubingIdIn: '2.992', roughness: '0.0006',
  topPerfAhM: '3380', devStartM: '2400', devAngleDeg: '24.6',
  api: '33', gasSg: '0.812', rsiScfStb: '442', tresF: '251', oilViscCp: '6', waterSg: '1.05', pbPsi: '',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '5000', prPsi: '', permMd: '', thicknessFt: '65.62', reFt: '1640.5', rwFt: '0.2916666667', skin: '0',
  matchHead: '1', matchFriction: '1',
  testQOilStbD: '1365', testThpPsi: '300', testPwfPsi: '',
  injDepthTvdM: '2490.92', injRateMMscfd: '0',
};

test('GL workbook: Pb, AOF and the Jones QC are exact', () => {
  const r = handlers['oil/nodal'](GL_WB);
  assert.ok(!r.error, r.error);
  close(r.pbPsi, 2185.18736342052, 1e-9); // B2
  // B15 Qmax is GROSS here (=F27); the response reports oil at WC 25
  close(r.aofOilStbD / 0.75, 4346.95213098, 1e-9);
  // B16: the workbook's own J from its test point — the number the user types
  const j = jFromTest({ qGrossStbD: 1820, pwfPsi: 3313.20290616, priPsi: 5000, pbPsi: 2185.18736342052 });
  close(j, 1.07896794858, 1e-9);
});

test('GL workbook: matched K lands on the author\'s hand-tuned 16.37', () => {
  // B30 K = 16.37 was tuned by hand until J_2 matched the Jones J; the PI
  // basis back-solves the same K in closed form. The author rounded to 2 dp,
  // and mu*Bo run through our pinned correlations — 0.1% covers both.
  const r = handlers['oil/nodal'](GL_WB);
  assert.equal(r.ipr.jTest, 1.07896794858);
  close(r.ipr.jDarcy, 1.07896794858, 1e-12);
  close(r.ipr.matchedPermMd, 16.37, 1e-3);
});

test('GL workbook: the operating point sits in the workbook\'s own crossing bracket', () => {
  // The saved VLP curve (J16:J28) crosses the saved IPR between grid rows 22
  // and 23: at H22 (1614.09 gross) VLP 3306.68 < IPR 3504.0, at H23 (1902.43
  // gross) VLP 3318.73 > IPR 3236.8. The workbook's own physics therefore
  // puts the natural-flow (inj 0) operating rate between I22 and I23 oil —
  // 1210.57 to 1426.83 stb/d. (The old 2428.8 "live case" rate in
  // gaslift.test.js came from a different save-state of this workbook.)
  const r = handlers['oil/nodal'](GL_WB);
  assert.ok(r.op, 'well flows at inj 0');
  assert.ok(
    r.op.qOilStbD > 1210.57 && r.op.qOilStbD < 1426.83,
    `op ${r.op.qOilStbD} outside the workbook's crossing bracket (1210.57, 1426.83)`
  );
});

test('GL workbook: the performance curve runs on the PI basis', () => {
  const r = handlers['oil/gaslift'](GL_WB);
  assert.ok(!r.error, r.error);
  assert.ok(Array.isArray(r.points) && r.points.length >= 4, 'sweep produced points');
  assert.ok(r.optimum && r.optimum.qOilStbD > 0, 'an optimum was found');
  // lift must help this well: the optimum beats the inj-0 point
  const q0 = r.points.find((p) => p.injRateMMscfd === 0)?.qOilStbD ?? 0;
  assert.ok(r.optimum.qOilStbD >= q0, `optimum ${r.optimum.qOilStbD} < inj-0 ${q0}`);
});
