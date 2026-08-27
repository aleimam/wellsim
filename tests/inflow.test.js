// Unified inflow definition — single-layer default, multi-layer optional.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOilInflow, createGasInflow, applyInflowFluids } from '../src/core/ipr/inflow.js';
import { qGrossAtPwf } from '../src/core/ipr/oil-ipr.js';
import { qGasAtPwfJ } from '../src/core/ipr/gas-ipr.js';
import { multiLayerOilRates } from '../src/core/ipr/multilayer.js';
import { oilOperatingPoint } from '../src/core/nodal/nodal.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual}`
  );
}

test('single-layer is the default mode (no multiLayer block)', () => {
  const inflow = createOilInflow({ jTest: 4.72597371012811, priPsi: 3550, pbPsi: 1920.00761413201 });
  assert.equal(inflow.mode, 'single');
  assert.equal(inflow.layers, undefined);
  close(inflow.ipr.j, 4.72597371012811);
});

test('multi-layer is an optional block with its own inputs', () => {
  const inflow = createOilInflow({
    multiLayer: {
      layers: [
        { name: 'upper', jTest: 2, priPsi: 3000, pbPsi: 100, wcPct: 20, gorScfStb: 500 },
        { name: 'lower', jTest: 3, priPsi: 2600, pbPsi: 100, wcPct: 60, gorScfStb: 200 },
      ],
      pwfSolutionPsi: 1800,
    },
  });
  assert.equal(inflow.mode, 'multi-layer');
  assert.equal(inflow.layers.length, 2); // all layers kept in full
  assert.equal(inflow.layers[0].name, 'upper');
  close(inflow.layers[1].ipr.j, 3);
  // the active record is the one-final-J equivalent, exact at the solution point
  const trueTotals = multiLayerOilRates(1800, inflow.layers).totals;
  close(qGrossAtPwf(1800, inflow.ipr), trueTotals.qGrossStbD);
  close(inflow.blended.wcPct, trueTotals.wcPct);
  close(inflow.blended.gorScfStb, trueTotals.gorScfStb);
  assert.ok(inflow.prAvgPsi > 2600 && inflow.prAvgPsi < 3000);
});

test('multi-layer inputs are validated', () => {
  assert.throws(() => createOilInflow({ multiLayer: { layers: [] } }), /non-empty/);
  assert.throws(
    () => createOilInflow({ multiLayer: { layers: [{ jTest: 2, priPsi: 3000, pbPsi: 100, gorScfStb: 500 }] } }),
    /missing wcPct/
  );
  assert.throws(
    () => createGasInflow({ multiLayer: { layers: [{ jTest: 2e-3, priPsi: 3800, cgrStbMMscf: 60 }] } }),
    /missing wgrStbMMscf/
  );
});

test('blended fluids merge into a march config only in multi-layer mode', () => {
  const cfgBase = { wcPct: 50, gorScfStb: 5000, thpPsi: 700 };
  const single = createOilInflow({ jTest: 4.7, priPsi: 3550, pbPsi: 1920 });
  assert.deepEqual(applyInflowFluids(cfgBase, single), cfgBase); // unchanged
  const multi = createOilInflow({
    multiLayer: {
      layers: [
        { jTest: 2, priPsi: 3000, pbPsi: 100, wcPct: 20, gorScfStb: 500 },
        { jTest: 3, priPsi: 2600, pbPsi: 100, wcPct: 60, gorScfStb: 200 },
      ],
      pwfSolutionPsi: 1800,
    },
  });
  const merged = applyInflowFluids(cfgBase, multi);
  close(merged.wcPct, multi.blended.wcPct);
  close(merged.gorScfStb, multi.blended.gorScfStb);
  assert.equal(merged.thpPsi, 700); // untouched fields preserved
});

test('nodal solver accepts an inflow object directly', () => {
  const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };
  const NAT = {
    ...HEAT,
    thpPsi: 700, qOilStbD: 1000, gorScfStb: 5000, wcPct: 50, api: 46, gasSg: 0.842,
    tresF: 201, perfTvdM: 2803.28614181045, devStartM: 1910, devAngleDeg: 7,
    tubingIdIn: 2.992, roughness: 0.00006, oilViscCp: 6, waterSg: 1.05,
    rsiScfStb: 700, pbPsi: 1920.00761413201, rhoGscKgm3: 0.938693049598781,
    matchHead: 1, matchFriction: 1,
  };
  const inflow = createOilInflow({ jTest: 4.72597371012811, priPsi: 3550, pbPsi: 1920.00761413201 });
  const viaInflow = oilOperatingPoint(NAT, inflow);
  const viaRecord = oilOperatingPoint(NAT, inflow.ipr);
  assert.equal(viaInflow.status, 'ok');
  close(viaInflow.qOp, viaRecord.qOp);
});

test('gas inflow: single and multi-layer with exact equivalent', () => {
  const single = createGasInflow({ jTest: 1.74848658948593e-3, priPsi: 3800 });
  assert.equal(single.mode, 'single');
  const multi = createGasInflow({
    multiLayer: {
      layers: [
        { jTest: 2e-3, priPsi: 3800, cgrStbMMscf: 60, wgrStbMMscf: 4 },
        { jTest: 1e-3, priPsi: 3200, cgrStbMMscf: 10, wgrStbMMscf: 20 },
      ],
    },
  });
  assert.equal(multi.mode, 'multi-layer');
  close(multi.ipr.j, 3e-3);
  // exact collapse verified through the inflow path
  for (const pwf of [3000, 1500, 0]) {
    const sum =
      qGasAtPwfJ(pwf, multi.layers[0].ipr) + qGasAtPwfJ(pwf, multi.layers[1].ipr);
    close(qGasAtPwfJ(pwf, multi.ipr), sum);
  }
  assert.ok(multi.blended.cgrStbMMscf > 10 && multi.blended.cgrStbMMscf < 60);
});
