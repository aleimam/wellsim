// Sensitivity engine tests — future-J pins from the Natural workbook's
// B51:F58 block, PVT-at-Pr pins (B35/B36), VLP families, and three extra
// gas-march validation points from the gas workbook's real test table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  futureOilJ,
  oilIprSensitivity,
  gasIprSensitivity,
  vlpSensitivityOil,
  vlpSensitivityGas,
  mergeCfg,
} from '../src/core/nodal/sensitivity.js';
import { oilViscosityCp, oilFvf } from '../src/core/pvt/oil.js';
import { createOilIpr, jDarcyOil } from '../src/core/ipr/oil-ipr.js';
import { createGasIpr } from '../src/core/ipr/gas-ipr.js';
import { gasMarch } from '../src/core/vlp/gas-march.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// Natural workbook Darcy section ('VLP-IPR'!B30:B34) and PVT bundle
const DARCY = { permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.510416666666667, skin: 0 };
const PVT = { pbPsi: 1920.00761413201, rsiScfStb: 700, gasSg: 0.842, api: 46, tempF: 201 };

test('PVT at current Pr matches the Darcy-section cells (B35, B36)', () => {
  close(oilViscosityCp(3550, PVT), 0.305393225776157); // B35
  close(oilFvf(3550, PVT), 1.42879242555418); // B36
  // J_2 (Darcy at current-Pr mu*Bo) sits within 0.05% of the test J — the
  // workbook's K=50 was itself tuned to match (the calibrate-Darcy workflow)
  const j2 = jDarcyOil({ ...DARCY, viscCp: 0.305393225776157, bo: 1.42879242555418 });
  close(j2, 4.72597371012811, 5e-4);
});

test('future J chain reproduces B51:F58 (Rs, Bo, mu, J_21..J_23)', () => {
  const rsCur = 700; // Rs at current Pr 3550 >= Pb
  const p1 = futureOilJ(2662.5, { darcy: DARCY, pvt: PVT, rsCurScfStb: rsCur }); // Pres1 = 0.75 Pr
  close(p1.rs, 700); // B55 (above Pb)
  close(p1.bo, 1.43260165417254); // B56
  close(p1.mu, 0.272942587388503); // B57
  close(p1.j, 5.27146844059); // B58 = J_21
  const p2 = futureOilJ(1775, { darcy: DARCY, pvt: PVT, rsCurScfStb: rsCur }); // Pres2 = 0.5 Pr
  close(p2.rs, 638.170953707541); // D55
  close(p2.bo, 1.3999329262685); // D56
  close(p2.mu, 0.252492846562651); // D57 (saturated: A/B at current Rs — constant)
  close(p2.j, 5.8313895807703); // D58 = J_22
  const p3 = futureOilJ(887.5, { darcy: DARCY, pvt: PVT, rsCurScfStb: rsCur }); // Pres3 = 0.25 Pr
  close(p3.rs, 281.562915540898); // F55
  close(p3.bo, 1.20389674953483); // F56
  close(p3.mu, 0.252492846562651); // F57
  close(p3.j, 6.78094220552862); // F58 = J_23
});

test('oil IPR sensitivity family: workbook default pressures, future J records', () => {
  const ipr = createOilIpr({
    darcy: { ...DARCY, viscCp: 0.305393225776157, bo: 1.42879242555418 },
    priPsi: 3550,
    pbPsi: 1920.00761413201,
  });
  const fam = oilIprSensitivity(ipr, PVT, { wcPct: 50 });
  assert.equal(fam.length, 3);
  close(fam[0].presPsi, 2662.5); // 0.75 Pr
  close(fam[1].presPsi, 1775); // 0.5 Pr
  close(fam[2].presPsi, 887.5); // 0.25 Pr
  close(fam[0].j, 5.27146844059);
  close(fam[2].j, 6.78094220552862);
  // each family member is a full IPR record evaluated at its future Pr
  assert.equal(fam[1].ipr.prPsi, 1775);
  assert.equal(fam[1].ipr.priPsi, 3550); // calibration record untouched
  assert.equal(fam[0].curve.length, 12);
  assert.ok(fam[0].curve[11].qGrossStbD > 0);
  // without a Darcy record the future J cannot be built
  assert.throws(
    () => oilIprSensitivity(createOilIpr({ jTest: 4.7, priPsi: 3550, pbPsi: 1920 }), PVT),
    /Darcy record/
  );
});

const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };
const NAT = {
  ...HEAT,
  thpPsi: 700, qOilStbD: 1000, gorScfStb: 5000, wcPct: 50, api: 46, gasSg: 0.842,
  tresF: 201, perfTvdM: 2803.28614181045, devStartM: 1910, devAngleDeg: 7,
  tubingIdIn: 2.992, roughness: 0.00006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 700, pbPsi: 1920.00761413201, rhoGscKgm3: 0.938693049598781,
  matchHead: 1, matchFriction: 1,
};

test('oil VLP sensitivity: one curve per parameter set, overrides applied', () => {
  const fam = vlpSensitivityOil(
    NAT,
    [
      { label: 'base', overrides: {} },
      { label: 'THP 900', overrides: { thpPsi: 900 } },
      { label: 'WC 80', overrides: { wcPct: 80 } },
    ],
    { rates: [500, 2000, 4000] }
  );
  assert.equal(fam.length, 3);
  assert.equal(fam[1].label, 'THP 900');
  for (const f of fam) for (const p of f.curve) assert.ok(Number.isFinite(p.pwfPsi) && p.pwfPsi > 0);
  // higher THP shifts the whole curve up
  for (let i = 0; i < 3; i++) assert.ok(fam[1].curve[i].pwfPsi > fam[0].curve[i].pwfPsi);
  // heavier column (WC 80) raises head-dominated low-rate Pwf
  assert.ok(fam[2].curve[0].pwfPsi > fam[0].curve[0].pwfPsi);
});

const GASCFG = {
  thpPsi: 2440, qGasMMscfd: 14.137, cgrStbMMscf: 57.4358974358974,
  wgrStbMMscf: 3.84615384615385, condApi: 48.7, gasSg: 0.763,
  n2: 0.012, co2: 0.03, h2s: 2e-6, tresF: 232, soilTempF: 90, htcBtu: 3,
  cpBtu: 0.51, tubingIdIn: 2.992, tubingOdIn: 3.5, perfTvdM: 2817.7433730104,
  devStartM: 690, devAngleDeg: 23.65, roughnessBase: 0.0021, sigmaDyneCm: 30,
  oilViscCp: 2, waterSg: 1.05, matchHead: 1, matchFriction: 1,
};

test('gas march reproduces the workbook test table (get_Pwf results C22:C24)', () => {
  close(gasMarch({ ...GASCFG, thpPsi: 2440, qGasMMscfd: 5.192 }).pwfPsi, 3414.01525251788, 1e-8);
  close(gasMarch({ ...GASCFG, thpPsi: 2000, qGasMMscfd: 10.002 }).pwfPsi, 2913.97067332777, 1e-8);
  close(gasMarch({ ...GASCFG, thpPsi: 1625, qGasMMscfd: 14.137 }).pwfPsi, 2647.81711594455, 1e-8);
});

test('gas VLP sensitivity replicates the workbook VLP2 set (THP 2000)', () => {
  const fam = vlpSensitivityGas(
    GASCFG,
    [
      { label: 'VLP1', overrides: { thpPsi: 2440 } },
      { label: 'VLP2', overrides: { thpPsi: 2000 } }, // gas 'VLP-IPR'!J42
    ],
    { rates: [2, 8, 14.137] }
  );
  // the family machinery is exactly the march with merged overrides
  close(
    fam[1].curve[2].pwfPsi,
    gasMarch({ ...GASCFG, thpPsi: 2000, qGasMMscfd: 14.137 }).pwfPsi
  );
  for (let i = 0; i < 3; i++) assert.ok(fam[0].curve[i].pwfPsi > fam[1].curve[i].pwfPsi);
});

test('gas IPR sensitivity: frozen C&n evaluated at future pressures', () => {
  const ipr = createGasIpr({ c: 1.74848658948593e-6, n: 0.999999999999999, priPsi: 3800 });
  const fam = gasIprSensitivity(ipr);
  assert.equal(fam.length, 3);
  close(fam[0].presPsi, 2850);
  assert.ok(fam[0].curve[0].qMMscfd === 0 || fam[0].curve[0].qMMscfd < 1e-9);
  assert.ok(fam[2].curve[10].qMMscfd < fam[0].curve[10].qMMscfd); // depletion shrinks AOF
});

test('mergeCfg deep-merges lift blocks', () => {
  const base = { a: 1, gasLift: { injDepthTvdM: 2400, injRateMMscfd: 0 } };
  const m = mergeCfg(base, { gasLift: { injRateMMscfd: 0.8 } });
  assert.equal(m.gasLift.injDepthTvdM, 2400);
  assert.equal(m.gasLift.injRateMMscfd, 0.8);
});
