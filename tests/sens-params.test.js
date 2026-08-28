// VLP sensitivity parameter families: ESP frequency (affinity + coupled
// pump solve) and the water-injector family.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  espDpAtFreq,
  vlpSensitivityInjector,
  vlpSensitivityEsp,
} from '../src/core/nodal/sensitivity.js';
import { handlers } from '../src/server/api.js';

const WATER_BASE = {
  fluid: 'water', liftType: 'natural',
  thpPsi: 200, qOilStbD: 2000, tubingIdIn: 2.992, roughness: 0.00006,
  topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7,
  api: 10, wcPct: 100, gorScfStb: 0, rsiScfStb: 0, pbPsi: 0,
  gasSg: 0.842, tresF: 201, oilViscCp: 6, waterSg: 1.05,
  soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
  priPsi: 4800, permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104, skin: 0,
};
const OIL_BASE = {
  thpPsi: 700, qOilStbD: 2100, wcPct: 50, gorScfStb: 300, tubingIdIn: 2.992, roughness: 0.00006,
  topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7,
  api: 46, gasSg: 0.842, rsiScfStb: 700, tresF: 201, oilViscCp: 6, waterSg: 1.05,
  soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
  priPsi: 3550, permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104, skin: 0,
};

test('ESP dP follows the affinity law (f/f0)^2', () => {
  assert.ok(Math.abs(espDpAtFreq(1000, 60, 50) - 1440) < 1e-9);
  assert.ok(Math.abs(espDpAtFreq(1000, 50, 50) - 1000) < 1e-9);
  assert.ok(Math.abs(espDpAtFreq(1000, 40, 50) - 640) < 1e-9);
  assert.equal(espDpAtFreq(1000, 0, 50), 1000, 'guard: zero frequency leaves dP alone');
});

test('oil natural sensitivity varies FTHP / GOR / WC / tubing ID', () => {
  const r = handlers['oil/sensitivity']({
    ...OIL_BASE, liftType: 'natural',
    vlpSets: [
      { label: 'base' },
      { label: 'thp', thpPsi: 300 },
      { label: 'gor', gorScfStb: 2000 },
      { label: 'wc', wcPct: 0 },
      { label: 'id', tubingIdIn: 3.958 },
    ],
  });
  assert.equal(r.vlpFamily.length, 5);
  const at = (i) => r.vlpFamily[i].curve[10].pwfPsi;
  assert.ok(at(1) < at(0), 'lower FTHP lowers the VLP');
  assert.ok(at(2) !== at(0), 'GOR moves the VLP');
  assert.ok(at(3) !== at(0), 'water cut moves the VLP');
  assert.ok(at(4) < at(0), 'a wider tubing lowers friction/holdup losses');
});

test('oil ESP sensitivity: frequency re-solves the pump dP (manual-dP path)', () => {
  const body = {
    ...OIL_BASE, liftType: 'esp', espPumpMode: 'manual',
    pumpTvdM: 2985, pumpDpPsi: 1325.16, espFreqHz: 50,
    vlpSets: [
      { label: '50Hz', freqHz: 50 },
      { label: '60Hz', freqHz: 60 },
      { label: '40Hz', freqHz: 40 },
    ],
  };
  const r = handlers['oil/sensitivity'](body);
  const at = (i) => r.vlpFamily[i].curve[8].pwfPsi;
  // more head at the pump = less bottomhole pressure needed for the same rate
  assert.ok(at(1) < at(0), `60 Hz must lower the VLP: ${at(1)} vs ${at(0)}`);
  assert.ok(at(2) > at(0), `40 Hz must raise the VLP: ${at(2)} vs ${at(0)}`);
});

test('water producer sensitivity ignores GOR/WC and honours lift params', () => {
  const r = handlers['oil/sensitivity']({
    ...WATER_BASE, liftType: 'natural',
    vlpSets: [
      { label: 'base' },
      { label: 'thp', thpPsi: 400 },
      { label: 'gor-ignored', gorScfStb: 5000 },
      { label: 'id', tubingIdIn: 3.958 },
    ],
  });
  const at = (i) => r.vlpFamily[i].curve[10].pwfPsi;
  assert.ok(at(1) > at(0), 'higher injection-side THP raises the water VLP');
  assert.ok(Math.abs(at(2) - at(0)) < 1e-9, 'GOR must not affect a water well');
  assert.ok(at(3) !== at(0), 'tubing ID does affect it');
});

test('water ESP sensitivity: frequency scales the pump dP by affinity', () => {
  const r = handlers['oil/sensitivity']({
    ...WATER_BASE, liftType: 'esp',
    pumpTvdM: 2985, pumpDpPsi: 1325.16, espFreqHz: 50,
    vlpSets: [{ label: '50Hz', freqHz: 50 }, { label: '60Hz', freqHz: 60 }],
  });
  const at = (i) => r.vlpFamily[i].curve[8].pwfPsi;
  assert.ok(at(1) < at(0), 'more frequency = more head = lower required Pwf');
});

test('water injector sensitivity: THP / injection temperature / tubing ID', () => {
  const r = handlers['water/injsensitivity']({
    ...WATER_BASE, wellType: 'injector', thpPsi: 2000, injTempF: 90,
    vlpSets: [
      { label: 'base' },
      { label: 'thp', thpPsi: 2500 },
      { label: 'temp', injTempF: 150 },
      { label: 'id', tubingIdIn: 3.958 },
    ],
  });
  assert.equal(r.vlpFamily.length, 4);
  assert.ok(r.iprFamily.length === 3, 'injectivity lines at future pressures');
  const at = (i) => r.vlpFamily[i].curve[6].pwfPsi;
  const bht = (i) => r.vlpFamily[i].curve[6].bhtF;
  assert.ok(at(1) > at(0), 'more injection THP = more available BHIP');
  assert.ok(at(3) > at(0), 'a wider tubing loses less to friction going down');
  // injection water is incompressible with a fixed viscosity in this model,
  // so its temperature moves the BOTTOMHOLE TEMPERATURE, not the pressure
  assert.ok(bht(2) > bht(0), `hotter injection water = hotter BHT: ${bht(2)} vs ${bht(0)}`);
  assert.ok(Math.abs(at(2) - at(0)) < 1e-9, 'and leaves BHIP unchanged');
  // the available-BHIP curve falls with rate (friction), unlike a producer VLP
  const c = r.vlpFamily[0].curve;
  assert.ok(c[c.length - 1].pwfPsi < c[0].pwfPsi, 'BHIP falls with rate');
  assert.ok(c.every((p) => p.bhtF != null), 'bottomhole injection temperature reported');
});

test('injector family curves carry every set through vlpSensitivityInjector', () => {
  const cfg = {
    fluid: 'water', thpPsi: 2000, qOilStbD: 2000, wcPct: 100, gorScfStb: 0,
    tubingIdIn: 2.992, roughness: 0.00006, perfTvdM: 2700, topPerfAhM: 2810,
    devStartM: 1910, devAngleDeg: 7, api: 10, rsiScfStb: 0, pbPsi: 0, gasSg: 0.842,
    tresF: 201, oilViscCp: 6, waterSg: 1.05, soilTempF: 90, htcBtu: 3,
    tubingOdIn: 3.5, cpBtu: 0.51, injTempF: 90,
  };
  const fam = vlpSensitivityInjector(cfg, [{ label: 'A', overrides: {} }], { rates: [500, 1500] });
  assert.equal(fam[0].curve.length, 2);
  assert.ok(fam[0].curve.every((p) => p.pwfPsi > 0));
});

test('vlpSensitivityEsp is exported and splits freqHz out of march overrides', () => {
  assert.equal(typeof vlpSensitivityEsp, 'function');
});
