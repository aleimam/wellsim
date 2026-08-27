// Brent solver + nodal operating point tests on the live workbook cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brent } from '../src/core/solvers/brent.js';
import {
  oilRateGrid,
  gasRateGrid,
  oilVlpPwf,
  gasVlpPwf,
  vlpCurve,
  oilOperatingPoint,
  gasOperatingPoint,
  whpCurve,
} from '../src/core/nodal/nodal.js';
import { pwfAtQGross } from '../src/core/ipr/oil-ipr.js';
import { pwfAtQGasCn } from '../src/core/ipr/gas-ipr.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual}`
  );
}

const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };
const NAT = {
  ...HEAT,
  thpPsi: 700, qOilStbD: 1000, gorScfStb: 5000, wcPct: 50, api: 46, gasSg: 0.842,
  tresF: 201, perfTvdM: 2803.28614181045, devStartM: 1910, devAngleDeg: 7,
  tubingIdIn: 2.992, roughness: 0.00006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 700, pbPsi: 1920.00761413201, rhoGscKgm3: 0.938693049598781,
  matchHead: 1, matchFriction: 1,
};
const OIL_IPR = { j: 4.72597371012811, priPsi: 3550, prPsi: 3550, pbPsi: 1920.00761413201 };

const GASCFG = {
  thpPsi: 1625, qGasMMscfd: 14.137, cgrStbMMscf: 57.4358974358974,
  wgrStbMMscf: 3.84615384615385, condApi: 48.7, gasSg: 0.763,
  n2: 0.012, co2: 0.03, h2s: 2e-6, tresF: 232, soilTempF: 90, htcBtu: 3,
  cpBtu: 0.51, tubingIdIn: 2.992, tubingOdIn: 3.5, perfTvdM: 2817.7433730104,
  devStartM: 690, devAngleDeg: 23.65, roughnessBase: 0.0021, sigmaDyneCm: 30,
  oilViscCp: 2, waterSg: 1.05, matchHead: 1, matchFriction: 1,
};
const GAS_CN = { c: 1.74848658948593e-6, n: 0.999999999999999, priPsi: 3800, prPsi: 3800 };

test('brent finds classic roots to tight tolerance', () => {
  close(brent((x) => x * x - 4, 0, 5, { tol: 1e-12 }).root, 2, 1e-10);
  close(brent((x) => Math.cos(x) - x, 0, 1, { tol: 1e-12 }).root, 0.7390851332151607, 1e-10);
  assert.throws(() => brent((x) => x * x + 1, -1, 1), /not bracketed/);
});

test('oil VLP rate grid matches the VLP_solver macro construction', () => {
  const g = oilRateGrid(50, 10000);
  assert.equal(g.length, 13);
  close(g[0], 50);
  close(g[1], 50 + 9950 / 30); // I17
  close(g[2], g[1] + 9950 / 11); // I18
  close(g[12], 10000);
});

test('gas VLP rate grid matches the gas macro (workbook I17, I18 pins)', () => {
  const g = gasRateGrid(0.1, 25.2481463521766);
  close(g[1], 0.602962927043531); // 'VLP-IPR'!I17
  close(g[2], 2.38619512292514); // 'VLP-IPR'!I18
  close(g[12], 25.2481463521766);
});

test('oil nodal operating point: natural well converges and balances', () => {
  const r = oilOperatingPoint(NAT, OIL_IPR);
  assert.equal(r.status, 'ok');
  close(r.aofOilStbD, 6372.17988933658, 1e-9); // E27
  assert.ok(r.qOp > 50 && r.qOp < r.aofOilStbD, `qOp=${r.qOp}`);
  const iprP = pwfAtQGross(r.qOp / 0.5, OIL_IPR);
  const vlpP = oilVlpPwf(NAT, r.qOp);
  assert.ok(Math.abs(iprP - vlpP) < 0.01, `IPR ${iprP} vs VLP ${vlpP}`);
  console.log(`    oil operating point: q_oil=${r.qOp.toFixed(1)} stb/d, Pwf=${r.pwfPsi.toFixed(1)} psi`);
});

test('gas nodal operating point: gas well converges and balances', () => {
  const r = gasOperatingPoint(GASCFG, GAS_CN);
  assert.equal(r.status, 'ok');
  assert.ok(r.qOp > 0.1 && r.qOp < r.aofMMscfd, `qOp=${r.qOp}`);
  const iprP = pwfAtQGasCn(r.qOp, GAS_CN);
  const vlpP = gasVlpPwf(GASCFG, r.qOp);
  assert.ok(Math.abs(iprP - vlpP) < 0.01, `IPR ${iprP} vs VLP ${vlpP}`);
  console.log(`    gas operating point: q=${r.qOp.toFixed(3)} MMscf/d, Pwf=${r.pwfPsi.toFixed(1)} psi`);
});

test('no-intersection reported when THP kills the well', () => {
  const r = oilOperatingPoint({ ...NAT, thpPsi: 8000 }, OIL_IPR);
  assert.equal(r.status, 'no-intersection');
  assert.ok(r.minAbsR > 0);
});

test('WHP curve passes through THP at the operating rate', () => {
  const op = oilOperatingPoint(NAT, OIL_IPR);
  const curve = whpCurve({
    iprPwf: (q) => pwfAtQGross(q / 0.5, OIL_IPR),
    vlpPwf: (q) => oilVlpPwf(NAT, q),
    thpPsi: NAT.thpPsi,
    rates: [op.qOp],
  });
  close(curve[0].whpPsi, NAT.thpPsi, 1e-4);
});

test('vlpCurve runs a full grid without NaNs', () => {
  const grid = oilRateGrid(50, 6300);
  const curve = vlpCurve((q) => oilVlpPwf(NAT, q), grid);
  assert.equal(curve.length, 13);
  for (const p of curve) assert.ok(Number.isFinite(p.pwfPsi) && p.pwfPsi > 0);
});
