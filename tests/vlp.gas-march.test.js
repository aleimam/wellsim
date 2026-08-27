// Gas march regression vs "Gas Well model_temp V6.0.0.xls" BHP sheet
// (live case: 14.137 MMscf/d, THP 2440 psi, CGR 57.44, WGR 3.85, gg=0.763,
// CO2 3%, N2 1.2%, H2S 2 ppm). The gas march is fully explicit, so the whole
// traverse must reproduce the sheet to numerical precision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGasFlow, gasStationGradients, gasMarch } from '../src/core/vlp/gas-march.js';
import { gasPseudoCriticals } from '../src/core/pvt/gas.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

const CFG = {
  thpPsi: 2440,
  qGasMMscfd: 14.137,
  cgrStbMMscf: 57.4358974358974,
  wgrStbMMscf: 3.84615384615385,
  condApi: 48.7,
  gasSg: 0.763,
  n2: 0.012,
  co2: 0.03,
  h2s: 2e-6,
  tresF: 232,
  soilTempF: 90,
  htcBtu: 3,
  cpBtu: 0.51,
  tubingIdIn: 2.992,
  tubingOdIn: 3.5,
  perfTvdM: 2817.7433730104,
  devStartM: 690,
  devAngleDeg: 23.65,
  roughnessBase: 0.0021,
  sigmaDyneCm: 30,
  oilViscCp: 2,
  waterSg: 1.05,
  matchHead: 1,
  matchFriction: 1,
};

test('gas flow derivations (BHP!Q3, P15, AH4, AF8, R17, S15, K17)', () => {
  const f = deriveGasFlow(CFG);
  close(f.qL, 866.344358974359); // Q3
  close(f.liqSg, 0.801855446528497); // P15
  close(f.rhoLConst, 50.0077912914624); // AH4
  close(f.ylSc, 0.000343954860284601); // AF8
  close(f.massLbDay, 1068569.85227099); // R17
  close(f.vslFtS, 1.15370885777253); // S15
  close(f.sigmaLbS2, 13607.7872830692); // K17
  close(f.areaFt2, 0.0488011822222222); // P6
});

test('gas station 22 — full Gray chain (BHP row 22)', () => {
  const flow = deriveGasFlow(CFG);
  const pc = gasPseudoCriticals({ gasSg: 0.763, n2: 0.012, co2: 0.03, h2s: 2e-6, method: 'sour' });
  const s = gasStationGradients({ pPsi: 2440, tF: 173.828438166802 }, CFG, flow, pc);
  close(s.z, 0.827184740365377); // AA22
  close(s.muG, 0.0168815500407588); // S22
  close(s.rhoG, 9.58713631668285); // AB22
  close(s.b, 0.00604501849718147); // AC22
  close(s.vsg, 20.3662735295586); // AD22
  close(s.vm, 21.5199823873311); // AE22
  close(s.rv, 0.0566480095682743); // AF22
  close(s.rhoNs, 9.60103919741731); // AG22
  close(s.n1, 1.11623953867564); // AH22
  close(s.n2, 0.00594610251870301); // AI22
  close(s.rd, 0.0647494627766066); // AJ22
  close(s.f1, -4.58414676822895); // AK22
  close(s.cl, 0.053853227019469); // AL22
  close(s.el, 0.0635157127771179); // AM22
  close(s.rhoMix, 12.1544830283239); // AO22
  close(s.ko, 87.2228565881536); // AP22
  close(s.ke, 87.2228565881536); // AQ22
  close(s.nre, 344726.263418562); // AS22
  close(s.f, 0.00359622483028163); // AT22
  close(s.gradHead, 0.0844061321411384); // AW22
  close(s.gradFric, 0.0328441457146297); // AX22
});

test('gas march temperature model (K10, K11, calculated WHT)', () => {
  const r = gasMarch(CFG);
  close(r.k10, 0.000120997347409975); // K10
  close(r.k11, 0.962161284777161); // K11
  close(r.whtF, 173.828438166802); // N22 = 'VLP-IPR'!I10
});

test('gas march input validation', () => {
  const { htcBtu, tubingOdIn, ...m } = CFG;
  assert.throws(() => gasMarch(m), /missing required input\(s\): tubingOdIn, htcBtu/);
  assert.throws(() => gasMarch({ ...CFG, qGasMMscfd: 0 }), /qGasMMscfd must be > 0/);
  assert.throws(() => gasMarch({ ...CFG, cgrStbMMscf: 0, wgrStbMMscf: 0 }), /CGR \+ WGR must be > 0/);
});

test('gas march full traverse is bit-parity with the sheet (D23, D51)', () => {
  const r = gasMarch(CFG);
  close(r.stations[0].ahFt, 0);
  close(r.stations[1].tvdFt, 318.793655408522, 1e-9); // B23
  close(r.stations[1].pPsi, 2477.37864467531, 1e-8); // D23
  close(r.pwfPsi, 3598.66511095252, 1e-8); // D51 — full march
});
