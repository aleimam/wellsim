// IPR calibration (get_Pwf workflow) tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPwfOil,
  calibrateOilIpr,
  calibrateGasJ,
  calibrateGasCn,
} from '../src/core/nodal/calibrate.js';
import { jFromTestGas } from '../src/core/ipr/gas-ipr.js';
import { prFromTest } from '../src/core/ipr/oil-ipr.js';
import { oilOperatingPoint } from '../src/core/nodal/nodal.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual}`
  );
}

const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };
const NAT = {
  ...HEAT,
  thpPsi: 700, qOilStbD: 2100, gorScfStb: 5000, wcPct: 50, api: 46, gasSg: 0.842,
  tresF: 201, perfTvdM: 2803.28614181045, devStartM: 1910, devAngleDeg: 7,
  tubingIdIn: 2.992, roughness: 0.00006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 700, pbPsi: 1920.00761413201, rhoGscKgm3: 0.938693049598781,
  matchHead: 1, matchFriction: 1,
};
const GASCFG = {
  thpPsi: 1625, qGasMMscfd: 14.137, cgrStbMMscf: 57.4358974358974,
  wgrStbMMscf: 3.84615384615385, condApi: 48.7, gasSg: 0.763,
  n2: 0.012, co2: 0.03, h2s: 2e-6, tresF: 232, soilTempF: 90, htcBtu: 3,
  cpBtu: 0.51, tubingIdIn: 2.992, tubingOdIn: 3.5, perfTvdM: 2817.7433730104,
  devStartM: 690, devAngleDeg: 23.65, roughnessBase: 0.0021, sigmaDyneCm: 30,
  oilViscCp: 2, waterSg: 1.05, matchHead: 1, matchFriction: 1,
};

test('oil calibration with INPUT test Pwf reproduces the workbook J', () => {
  const r = calibrateOilIpr({
    marchCfg: NAT,
    priPsi: 3550,
    test: { qOilStbD: 2100, pwfPsi: 2661.29425223016 }, // 'VLP-IPR'!B22, C22
  });
  assert.equal(r.pwfSource, 'input');
  close(r.testQGrossStbD, 4200); // B19
  close(r.ipr.j, 4.72597371012811); // B16
  assert.equal(r.ipr.priPsi, 3550);
  assert.equal(r.ipr.prPsi, 3550);
  close(r.ipr.pbPsi, 1920.00761413201);
});

test('oil calibration with CALCULATED test Pwf (get_Pwf) is self-consistent', () => {
  const r = calibrateOilIpr({ marchCfg: NAT, priPsi: 3550, test: { qOilStbD: 2100 } });
  assert.equal(r.pwfSource, 'calculated');
  close(r.testPwfPsi, getPwfOil(NAT, 2100));
  // the frozen J inverts back to Pri at the test point
  close(
    prFromTest({ qGrossStbD: 4200, pwfPsi: r.testPwfPsi, j: r.ipr.j, pbPsi: r.ipr.pbPsi }),
    3550
  );
  // and by construction the nodal operating point at the test THP is the
  // test rate itself — IPR and VLP both pass through (q_test, pwf_calc)
  const op = oilOperatingPoint(NAT, r.ipr);
  assert.equal(op.status, 'ok');
  close(op.qOp, 2100, 1e-4);
  close(op.pwfPsi, r.testPwfPsi, 1e-4);
});

test('oil calibration with a darcy block keeps two J records, Darcy active', () => {
  const darcy = { thicknessFt: 100, viscCp: 1, bo: 1.2, reFt: 1000, rwFt: 0.354, skin: 0 };
  // permMd omitted -> back-matched from the test J (slide-8 workflow)
  const r = calibrateOilIpr({
    marchCfg: NAT,
    priPsi: 3550,
    test: { qOilStbD: 2100, pwfPsi: 2661.29425223016 },
    darcy,
  });
  assert.ok(Number.isFinite(r.matchedPermMd) && r.matchedPermMd > 0);
  close(r.ipr.jTest, 4.72597371012811);
  close(r.ipr.jDarcy, r.ipr.jTest); // auto-matched
  assert.equal(r.ipr.jSource, 'darcy'); // workbook convention: Darcy drives
  // explicit permMd -> independent Darcy J (unmatched), still active
  const r2 = calibrateOilIpr({
    marchCfg: NAT,
    priPsi: 3550,
    test: { qOilStbD: 2100, pwfPsi: 2661.29425223016 },
    darcy: { ...darcy, permMd: 50 },
  });
  assert.equal(r2.matchedPermMd, 50);
  assert.notEqual(r2.ipr.jDarcy, r2.ipr.jTest);
  close(r2.ipr.j, r2.ipr.jDarcy);
  // without a darcy block: Jones-only record, jones source
  const r3 = calibrateOilIpr({
    marchCfg: NAT,
    priPsi: 3550,
    test: { qOilStbD: 2100, pwfPsi: 2661.29425223016 },
  });
  assert.equal(r3.ipr.jSource, 'jones');
});

test('gas J calibration with INPUT test Pwf matches the workbook chain', () => {
  const r = calibrateGasJ({
    marchCfg: GASCFG,
    priPsi: 3800,
    test: { qMMscfd: 4.79714780691354, pwfPsi: 3420 },
  });
  assert.equal(r.pwfSource, 'input');
  close(r.ipr.j, 1.74848658948593e-3, 1e-8); // = 1000*C at n=1
  close(jFromTestGas({ qMMscfd: 4.79714780691354, pwfPsi: 3420, priPsi: 3800 }), r.ipr.j);
});

test('gas C&n calibration accepts mixed input/calculated points', () => {
  const r = calibrateGasCn({
    marchCfg: GASCFG,
    priPsi: 3800,
    points: [
      { qMMscfd: 4.79714780691354, pwfPsi: 3420 },
      { qMMscfd: 9.08933268678356, pwfPsi: 3040 },
      { qMMscfd: 12.87655463961, pwfPsi: 2660 },
      { qMMscfd: 16.158813665393, thpPsi: 1300 }, // Pwf via get_Pwf at its own THP
    ],
  });
  assert.equal(r.points[0].pwfSource, 'input');
  assert.equal(r.points[3].pwfSource, 'calculated');
  assert.ok(Number.isFinite(r.points[3].pwfPsi) && r.points[3].pwfPsi > 1300);
  assert.ok(r.ipr.c > 0 && r.ipr.n > 0.4 && r.ipr.n <= 1.3, `c=${r.ipr.c} n=${r.ipr.n}`);
  assert.ok(r.qMaxMMscfd > 16);
});

test('gas C&n calibration with all-input points reproduces the workbook fit', () => {
  const r = calibrateGasCn({
    marchCfg: GASCFG,
    priPsi: 3800,
    points: [
      { qMMscfd: 4.79714780691354, pwfPsi: 3420 },
      { qMMscfd: 9.08933268678356, pwfPsi: 3040 },
      { qMMscfd: 12.87655463961, pwfPsi: 2660 },
      { qMMscfd: 16.158813665393, pwfPsi: 2280 },
    ],
  });
  close(r.ipr.c, 1.74848658948593e-6); // B17
  close(r.qMaxMMscfd, 25.2481463521766); // B15
});
