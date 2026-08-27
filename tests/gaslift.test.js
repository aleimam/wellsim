// Gas-lift performance curve tests — on the GasLift workbook live case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasLiftPerformance } from '../src/core/nodal/gaslift.js';
import { calibrateOilIpr } from '../src/core/nodal/calibrate.js';
import { handlers } from '../src/server/api.js';

const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };
const GL = {
  ...HEAT,
  thpPsi: 300, qOilStbD: 2428.8092730636, gorScfStb: 412, wcPct: 25,
  api: 33, gasSg: 0.812, tresF: 251,
  perfTvdM: 3290.98087338564, devStartM: 2400, devAngleDeg: 24.6,
  tubingIdIn: 2.992, roughness: 0.0006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 442, pbPsi: 2185.18736342052, rhoGscKgm3: 0.93489880969514,
  matchHead: 1, matchFriction: 1,
  gasLift: { injDepthTvdM: 2490.9164156516, injRateMMscfd: 0 },
};

// IPR calibrated from the well's current state (Pwf at inj=0 from the march)
const CAL = calibrateOilIpr({ marchCfg: GL, priPsi: 4300, test: { qOilStbD: 2428.81 } });

test('gas-lift performance curve: lift lightens the column and raises rate', () => {
  const r = gasLiftPerformance(GL, CAL.ipr, { injRatesMMscfd: [0, 0.4, 0.8, 1.2] });
  assert.equal(r.points.length, 4);
  for (const p of r.points) assert.equal(p.status, 'ok');
  // by construction the inj=0 operating point is the calibration state
  assert.ok(Math.abs(r.points[0].qOilStbD - 2428.81) / 2428.81 < 1e-3);
  // injection increases rate on this well (head-dominated, moderate GOR)
  assert.ok(r.points[1].qOilStbD > r.points[0].qOilStbD, `${r.points[0].qOilStbD} -> ${r.points[1].qOilStbD}`);
  assert.ok(r.optimum.qOilStbD >= r.points[1].qOilStbD);
  assert.equal(r.incremental.length, 3);
  assert.ok(r.incremental[0].dQdInjStbPerMMscf > 0);
  // diminishing returns: later increments smaller than the first
  const inc = r.incremental.map((i) => i.dQdInjStbPerMMscf);
  assert.ok(inc[inc.length - 1] < inc[0], `${inc}`);
  console.log(
    '    GL curve: ' + r.points.map((p) => `${p.injRateMMscfd}→${p.qOilStbD.toFixed(0)}`).join('  ') +
    ` | optimum ${r.optimum.qOilStbD.toFixed(0)} stb/d @ ${r.optimum.injRateMMscfd} MMscf/d`
  );
});

test('injection depth is required for the sweep', () => {
  assert.throws(() => gasLiftPerformance({ ...GL, gasLift: undefined }, CAL.ipr), /injDepthTvdM/);
});

test('api endpoint oil/gaslift returns curve + optimum from form state', () => {
  const form = {
    thpPsi: '300', qOilStbD: '2428.81', wcPct: '25', gorScfStb: '412',
    tubingIdIn: '2.992', roughness: '0.0006',
    perfTvdM: '3290.98087338564', devStartM: '2400', devAngleDeg: '24.6',
    api: '33', gasSg: '0.812', rsiScfStb: '442', tresF: '251',
    oilViscCp: '6', waterSg: '1.05', pbPsi: '2185.18736342052',
    soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
    priPsi: '4300', prPsi: '', permMd: '30', thicknessFt: '50',
    reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
    matchHead: '1', matchFriction: '1',
    injDepthTvdM: '2490.9164156516', injRateMMscfd: '0',
    injMaxMMscfd: '1.2', injSteps: '3',
  };
  const r = handlers['oil/gaslift'](form);
  assert.equal(r.error, undefined);
  assert.equal(r.points.length, 4);
  assert.ok(r.optimum);
  assert.equal(r.currentInjMMscfd, 0);
  // without injection depth: clean error
  const bad = handlers['oil/gaslift']({ ...form, injDepthTvdM: '' });
  assert.match(bad.error, /injection depth/);
});

test('injection-rate VLP sensitivity sets flow through the sensitivity endpoint', () => {
  const form = {
    thpPsi: '300', qOilStbD: '2428.81', wcPct: '25', gorScfStb: '412',
    tubingIdIn: '2.992', roughness: '0.0006',
    perfTvdM: '3290.98087338564', devStartM: '2400', devAngleDeg: '24.6',
    api: '33', gasSg: '0.812', rsiScfStb: '442', tresF: '251',
    oilViscCp: '6', waterSg: '1.05', pbPsi: '2185.18736342052',
    soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
    priPsi: '4300', prPsi: '', permMd: '30', thicknessFt: '50',
    reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
    matchHead: '1', matchFriction: '1',
    injDepthTvdM: '2490.9164156516', injRateMMscfd: '0',
    vlpSets: [
      { label: 'no lift', injRateMMscfd: '0' },
      { label: 'lift 0.8', injRateMMscfd: '0.8' },
    ],
    presList: [],
  };
  const r = handlers['oil/sensitivity'](form);
  assert.equal(r.error, undefined);
  assert.equal(r.vlpFamily.length, 2);
  // lifted VLP sits below the unlifted one at low-mid rates (lighter column)
  const i = 3;
  assert.ok(
    r.vlpFamily[1].curve[i].pwfPsi < r.vlpFamily[0].curve[i].pwfPsi,
    `${r.vlpFamily[1].curve[i].pwfPsi} vs ${r.vlpFamily[0].curve[i].pwfPsi}`
  );
});
