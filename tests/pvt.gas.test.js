// PVT gas regression tests. Pins come from two workbooks:
//  - "Oil well model Natural_V3.1.7.xls" BHP sheet (gg=0.842): Hall-Yarborough
//    coefficients/residual, CKB+Dempsey viscosity, gas density, bg factor.
//  - "Gas Well model_temp V6.0.0.xls" BHP sheet (gg=0.763, CO2 3%, N2 1.2%,
//    H2S 2 ppm): sour pseudo-criticals with Wichert-Aziz, Brill & Beggs Z.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pseudoCriticalsSweet,
  pseudoCriticalsSour,
  zFactorBrillBeggs,
  gasViscosityBaseCp,
  dempseyLnRatio,
  gasViscosityCp,
  gasDensityLbft3,
  bgFactor,
  gasDensityScKgm3,
  compositionFromField,
  gasPseudoCriticals,
  gasPvt,
} from '../src/core/pvt/gas.js';

const REL = 1e-9;
function close(actual, expected, rel = REL) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

test('sweet pseudo-criticals, oil model (BHP!X1:X2, gg=0.842)', () => {
  const { tpc, ppc } = pseudoCriticalsSweet(0.842);
  close(tpc, 433.388);
  close(ppc, 660.1666); // formula uses 57.7 (sheet label says 57.5)
});

test('sour pseudo-criticals with Wichert-Aziz (gas BHP!Y8:Y16)', () => {
  const r = pseudoCriticalsSour({ gasSg: 0.763, n2: 0.012, co2: 0.03, h2s: 2e-6 });
  close(r.ghc, 0.736751274637317); // Y9
  assert.equal(r.ghcValid, true); // Z9
  close(r.tchc, 391.317546121715); // Y10
  close(r.pchc, 738.064933807205); // Y11
  close(r.tcmix, 394.038371349511); // Y12
  close(r.pcmix, 745.113342457434); // Y13
  close(r.eps, 4.69435560455525); // Y14 (CWA)
  close(r.tpc, 389.344015744956); // Y15 (Tc*)
  close(r.ppc, 736.236455936175); // Y16 (Pc*)
});

test('Brill & Beggs Z (gas BHP row 22: Ppr=3.3142, Tpr=1.6279)', () => {
  const r = zFactorBrillBeggs(3.31415264800678, 1.62793933522789);
  close(r.a, 0.482475759131237); // W22
  close(r.b, 1.35240052399321); // X22
  close(r.c, 0.0642757705682713); // Y22
  close(r.d, 0.991525161406508); // Z22
  close(r.z, 0.827184740365377); // AA22
});

test('CKB base viscosity (oil BHP!R22, R92; gas BHP!R22)', () => {
  close(gasViscosityBaseCp(0.842, 120), 0.0104897861572772);
  close(gasViscosityBaseCp(0.842, 60), 0.00956855839727716);
  close(gasViscosityBaseCp(0.763, 173.828438166802), 0.0116077167751097);
});

test('Dempsey polynomial and gas viscosity (oil BHP!Q22, S22)', () => {
  close(dempseyLnRatio(1.06033840548734, 1.33829270768918), 0.41458030979477);
  close(
    gasViscosityCp(0.842, 120, 1.06033840548734, 1.33829270768918),
    0.0118649377545898
  );
});

test('Dempsey polynomial and gas viscosity (gas BHP!Q22, S22)', () => {
  close(dempseyLnRatio(3.31415264800678, 1.62793933522789), 0.861866199351282);
  close(
    gasViscosityCp(0.763, 173.828438166802, 3.31415264800678, 1.62793933522789),
    0.0168815500407588
  );
});

test('gas density (oil BHP!AB22: gg=0.842, 700 psi, 120 F, Z from sheet)', () => {
  close(gasDensityLbft3(0.842, 700, 120, 0.843712163913253), 3.2518956475522);
});

test('bg expansion factor (oil BHP!AC22)', () => {
  close(bgFactor(0.843712163913253, 120, 700), 0.0193823533358602);
});

test('field composition input matches gas workbook convention (B5:B7)', () => {
  const c = compositionFromField({ n2Pct: 1.2, co2Pct: 3, h2sPpm: 2 });
  close(c.n2, 0.012);
  close(c.co2, 0.03);
  close(c.h2s, 2e-6); // Y8 = 2/1e6*100 percent = 2e-6 fraction
});

test('gasPseudoCriticals routes by impurities (auto method)', () => {
  const sweet = gasPseudoCriticals({ gasSg: 0.842 });
  assert.equal(sweet.method, 'sweet');
  close(sweet.tpc, 433.388);

  const sour = gasPseudoCriticals({
    gasSg: 0.763,
    ...compositionFromField({ n2Pct: 1.2, co2Pct: 3, h2sPpm: 2 }),
  });
  assert.equal(sour.method, 'sour');
  close(sour.tpc, 389.344015744956); // gas BHP!Y15
  close(sour.ppc, 736.236455936175); // gas BHP!Y16
});

test('sour route is well-defined with zero impurities', () => {
  const r = gasPseudoCriticals({ gasSg: 0.763, method: 'sour' });
  assert.ok(Number.isFinite(r.tpc) && Number.isFinite(r.ppc));
  close(r.ghc, 0.763);
  assert.equal(r.eps, 0);
  close(r.ppc, r.pcmix);
});

test('gasPvt full chain reproduces gas BHP station 22 (impurities as inputs)', () => {
  const gas = {
    gasSg: 0.763,
    ...compositionFromField({ n2Pct: 1.2, co2Pct: 3, h2sPpm: 2 }),
  };
  const r = gasPvt(gas, 2440, 173.828438166802, { zMethod: 'brill-beggs' });
  close(r.ppr, 3.31415264800678); // O22
  close(r.tpr, 1.62793933522789); // P22
  close(r.z, 0.827184740365377); // AA22
  close(r.viscosityCp, 0.0168815500407588); // S22
  close(r.densityLbft3, 9.58713631668285); // AB22
  close(r.bg, 0.00604501849718147); // AC22
});

test('gasPvt single explicit Z (oil-model sweet pcrits, gg=0.842)', () => {
  const r = gasPvt({ gasSg: 0.842 }, 700, 120);
  close(r.ppr, 1.06033840548734); // oil BHP!O22
  close(r.tpr, 1.33829270768918); // oil BHP!P22
  close(r.z, zFactorBrillBeggs(1.06033840548734, 1.33829270768918).z); // single Z model
  // Explicit Z sits ~3% under the workbook's loose-GoalSeek H-Y at this point
  assert.ok(Math.abs(r.z - 0.843712163913253) / 0.843712163913253 < 0.04);
});

test('standard-conditions gas density is converged (vs BHP!AA18 artifact)', () => {
  const rho = gasDensityScKgm3(0.842);
  // Excel stores 0.9387 kg/m3 from a loose GoalSeek at Ppr=0.022; the
  // converged Hall-Yarborough value is ~1.02 kg/m3 (Z ~ 0.9955, not 1.08).
  assert.ok(rho > 0.99 && rho < 1.05, `rho=${rho}`);
});
