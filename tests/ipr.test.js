// IPR regression tests — pins from the Natural oil and Gas workbooks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOilIpr,
  withCurrentPr,
  resetToInitialPr,
  withJSource,
  jFromTest,
  jDarcyOil,
  permFromJOil,
  skinFromJOil,
  qGrossAtPwf,
  qMaxGross,
  pwfAtQGross,
  prFromTest,
  iprCurve,
} from '../src/core/ipr/oil-ipr.js';
import {
  jDarcyGas,
  qGasAtPwfJ,
  pwfAtQGasJ,
  prFromTestGasJ,
  fitCn,
  qGasAtPwfCn,
  pwfAtQGasCn,
  prFromTestGasCn,
} from '../src/core/ipr/gas-ipr.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// ---- Oil: Natural workbook live case ----
const OIL = createOilIpr({ j: 4.72597371012811, priPsi: 3550, pbPsi: 1920.00761413201 });

test('J from initial test point — general equation ("VLP-IPR"!B16, Pri-anchored)', () => {
  close(
    jFromTest({ qGrossStbD: 4200, pwfPsi: 2661.29425223016, priPsi: 3550, pbPsi: 1920.00761413201 }),
    4.72597371012811
  );
});

test('two Pr records: priPsi is the frozen calibration, prPsi the working one', () => {
  assert.equal(OIL.priPsi, 3550);
  assert.equal(OIL.prPsi, 3550); // starts at Pri
  // a later test point back-calculates a NEW current Pr with the frozen J
  const q2 = qGrossAtPwf(2500, withCurrentPr(OIL, 3200)); // synthetic later test
  const newPr = prFromTest({ qGrossStbD: q2, pwfPsi: 2500, j: OIL.j, pbPsi: OIL.pbPsi });
  close(newPr, 3200);
  const depleted = withCurrentPr(OIL, newPr);
  assert.equal(depleted.priPsi, 3550); // calibration record untouched
  close(depleted.prPsi, 3200);
  assert.equal(depleted.j, OIL.j); // J stays frozen (the sheets' J_2)
  // the IPR now evaluates at the current Pr...
  assert.ok(qMaxGross(depleted) < qMaxGross(OIL));
  // ...and can be reset to initial
  assert.equal(resetToInitialPr(depleted).prPsi, 3550);
});

test('composite Vogel rates ("VLP-IPR"!F17, F18, F25, F27=Qmax)', () => {
  close(qGrossAtPwf(1920.00761413201, OIL), 7703.3011633211); // F17 (at Pb)
  close(qGrossAtPwf(1536.00609130561, OIL), 9356.76838915657); // F18 (0.8 Pb)
  close(qGrossAtPwf(288.001142119802, OIL), 12502.3889651363); // F25 (0.15 Pb)
  close(qMaxGross(OIL), 12744.3597786732); // F27 / B15
});

test('IPR curve reproduces the workbook grid (D16:F27, WC=50%)', () => {
  const curve = iprCurve(OIL, { wcPct: 50 });
  assert.equal(curve.length, 12);
  close(curve[0].pwfPsi, 3550);
  close(curve[3].pwfPsi, 1344.00532989241); // D19 = 0.7 Pb
  close(curve[3].qGrossStbD, 10062.5165953059); // F19
  close(curve[3].qOilStbD, 5031.25829765293); // E19
  close(curve[11].qOilStbD, 6372.17988933658); // E27 (oil AOF)
});

test('Pwf at rate inverts the composite Vogel (both branches)', () => {
  close(pwfAtQGross(qGrossAtPwf(3000, OIL), OIL), 3000); // undersaturated
  close(pwfAtQGross(9356.76838915657, OIL), 1536.00609130561); // Vogel branch
  assert.equal(pwfAtQGross(qMaxGross(OIL) * 1.01, OIL), 0); // beyond AOF
});

test('Pr back-calculation — all three branches round-trip', () => {
  // undersaturated test point (the workbook natural case itself)
  close(
    prFromTest({ qGrossStbD: 4200, pwfPsi: 2661.29425223016, j: OIL.j, pbPsi: OIL.pbPsi }),
    3550
  );
  // mixed branch: Pr > Pb, Pwf < Pb
  const mixed = { j: 3, prPsi: 3000, pbPsi: 2500 };
  const qMixed = qGrossAtPwf(2000, mixed);
  close(prFromTest({ qGrossStbD: qMixed, pwfPsi: 2000, j: 3, pbPsi: 2500 }), 3000);
  // fully saturated quadratic: Pr <= Pb
  const sat = { j: 3, prPsi: 2000, pbPsi: 2500 };
  const qSat = qGrossAtPwf(1200, sat);
  close(prFromTest({ qGrossStbD: qSat, pwfPsi: 1200, j: 3, pbPsi: 2500 }), 2000);
});

test('ESP workbook AOF: input PI 2.7, Pr 2650, oil basis ("VLP-IPR"!B15)', () => {
  const qmax = qMaxGross({ j: 2.7, prPsi: 2650, pbPsi: 1911.80724408471 });
  close(qmax * (1 - 5 / 100), 4617.78974174343); // E27 with WC=5%
});

test('two J records: Darcy is the default source, Jones selectable', () => {
  const dar = { thicknessFt: 100, viscCp: 1, bo: 1.2, reFt: 1000, rwFt: 0.354, skin: 2 };
  const jT = 4.72597371012811;
  const kMatch = permFromJOil({ j: jT, ...dar }); // slide-8 "tune K to match"
  const jD = jDarcyOil({ ...dar, permMd: kMatch });
  close(jD, jT); // perfect closed-form match

  const ipr = createOilIpr({ jTest: jT, jDarcy: jD, priPsi: 3550, pbPsi: 1920.00761413201 });
  assert.equal(ipr.jSource, 'darcy'); // Darcy active by default when present
  close(ipr.j, jD);
  const jones = withJSource(ipr, 'jones');
  assert.equal(jones.jSource, 'jones');
  close(jones.j, jT);
  assert.equal(jones.jDarcy, ipr.jDarcy); // both records preserved
  // skin matcher round-trips too
  close(skinFromJOil({ j: jT, permMd: kMatch, ...dar }), 2, 1e-9);
  // selecting a missing record is a clear error
  assert.throws(() => withJSource(createOilIpr({ jTest: jT, priPsi: 3550, pbPsi: 1920 }), 'darcy'), /missing/);
  // Jones-only record: jones is the source
  assert.equal(createOilIpr({ j: jT, priPsi: 3550, pbPsi: 1920 }).jSource, 'jones');
  // depletion update preserves both J records
  const depleted = withCurrentPr(ipr, 3200);
  assert.equal(depleted.jTest, jT);
  assert.equal(depleted.jDarcy, jD);
});

test('Darcy-first usage: record built from reservoir properties is the main J', () => {
  const darcy = { permMd: 50, thicknessFt: 100, viscCp: 1, bo: 1.2, reFt: 1000, rwFt: 0.354, skin: 2 };
  const ipr = createOilIpr({ darcy, priPsi: 3550, pbPsi: 1920.00761413201 });
  assert.equal(ipr.jSource, 'darcy'); // dominant across the program
  close(ipr.j, jDarcyOil(darcy));
  assert.deepEqual(ipr.darcy, darcy); // provenance stored for later re-match
  assert.equal(ipr.jTest, undefined); // Jones optional — absent until a test exists
});

test('calibrate-Darcy action: user inputs skin, program matches K to the test J', async () => {
  const { calibrateDarcyToTest } = await import('../src/core/ipr/oil-ipr.js');
  // well defined Darcy-first with a guess K; later a production test gives Jones J
  const darcy = { permMd: 30, thicknessFt: 100, viscCp: 1, bo: 1.2, reFt: 1000, rwFt: 0.354, skin: 0 };
  const withTest = {
    ...createOilIpr({ darcy, priPsi: 3550, pbPsi: 1920.00761413201 }),
    jTest: 4.72597371012811, // from calibrateOilIpr (production test)
  };
  const r = calibrateDarcyToTest(withTest, { skin: 3 }); // user-input skin
  close(r.ipr.jDarcy, 4.72597371012811); // jDarcy = jJones, exactly
  assert.equal(r.ipr.jSource, 'darcy');
  close(r.ipr.j, r.ipr.jDarcy);
  assert.equal(r.ipr.darcy.skin, 3);
  close(r.ipr.darcy.permMd, r.matchedPermMd);
  // matched K reproduces the target through the Darcy formula
  close(jDarcyOil(r.ipr.darcy), 4.72597371012811);
  // Jones record kept for QC
  close(r.ipr.jTest, 4.72597371012811);
  // guard: no test J -> clear error
  assert.throws(
    () => calibrateDarcyToTest(createOilIpr({ darcy, priPsi: 3550, pbPsi: 1920 })),
    /calibrate from a production test first/
  );
});

test('gas calibrate-Darcy mirrors the oil action', async () => {
  const { createGasIpr, calibrateDarcyToTestGas } = await import('../src/core/ipr/gas-ipr.js');
  const darcy = { permMd: 5, thicknessFt: 80, viscCp: 0.018, z: 0.9, tresF: 232, reFt: 1500, rwFt: 0.354, skin: 0 };
  const rec = { ...createGasIpr({ darcy, priPsi: 3800 }), jTest: 1.74848658948593e-3 };
  const r = calibrateDarcyToTestGas(rec, { skin: 5 });
  close(r.ipr.jDarcy, 1.74848658948593e-3);
  assert.equal(r.ipr.jSource, 'darcy');
  assert.equal(r.ipr.darcy.skin, 5);
});

test('skin guidance supports the user judgment (reference table)', async () => {
  const { SKIN_GUIDANCE, skinMethodsFor } = await import('../src/core/ipr/skin-guidance.js');
  assert.ok(SKIN_GUIDANCE.length >= 10);
  for (const g of SKIN_GUIDANCE) assert.ok(g.min <= g.max && typeof g.method === 'string');
  assert.ok(skinMethodsFor(3).some((m) => m.includes('Cased & perforated')));
  assert.ok(skinMethodsFor(-4).some((m) => m.includes('fractured') || m.includes('Acidized')));
});

test('Darcy PIs match their formulas', () => {
  const jo = jDarcyOil({ permMd: 50, thicknessFt: 100, viscCp: 1, bo: 1.2, reFt: 1000, rwFt: 0.354, skin: 0 });
  close(jo, (0.00708 * 50 * 100) / 1 / 1.2 / (Math.log(1000 / 0.354) - 0.75));
  const jg = jDarcyGas({ permMd: 10, thicknessFt: 50, viscCp: 0.02, z: 0.9, tresF: 232, reFt: 1000, rwFt: 0.354, skin: 2 });
  close(jg, (703e-6 * 10 * 50) / 0.02 / 0.9 / 692 / (Math.log((0.472 * 1000) / 0.354) + 2));
});

// ---- Gas: Gas workbook live case (Pr=3800, 4-point synthetic test) ----
const GAS_POINTS = [
  { qMMscfd: 4.79714780691354, pwfPsi: 3420 },
  { qMMscfd: 9.08933268678356, pwfPsi: 3040 },
  { qMMscfd: 12.87655463961, pwfPsi: 2660 },
  { qMMscfd: 16.158813665393, pwfPsi: 2280 },
];

test('C&n fit reproduces the workbook (B15 Qmax, B16 n, B17 C)', () => {
  const { c, n, qMaxMMscfd } = fitCn(GAS_POINTS, 3800);
  assert.ok(Math.abs(n - 1) < 1e-12, `n=${n}`); // B16 = 0.999999999999999
  close(qMaxMMscfd, 25.2481463521766); // B15
  close(c, 1.74848658948593e-6); // B17
});

test('gas J and C&n forms invert and round-trip', () => {
  const J = { j: 1.74848658948593e-3, prPsi: 3800 }; // J = 1000*C at n=1
  close(qGasAtPwfJ(3420, J), 4.79714780691354, 1e-8);
  close(pwfAtQGasJ(4.79714780691354, J), 3420, 1e-8);
  close(prFromTestGasJ({ qMMscfd: 4.79714780691354, pwfPsi: 3420, j: J.j }), 3800, 1e-8);

  const CN = { c: 1.74848658948593e-6, n: 0.999999999999999, prPsi: 3800 };
  close(qGasAtPwfCn(3040, CN), 9.08933268678356, 1e-8);
  close(pwfAtQGasCn(9.08933268678356, CN), 3040, 1e-8);
  close(prFromTestGasCn({ qMMscfd: 12.87655463961, pwfPsi: 2660, ...CN }), 3800, 1e-8);
});
