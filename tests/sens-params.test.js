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

// ---- water ESP driven by the shared 69-pump database ----
const WATER_ESP = {
  ...WATER_BASE, liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
  espSepEffPct: 0, pumpTvdM: 2985, pumpDpPsi: 1325.16, espFreqHz: 50,
  espStages: 145, espWearFactor: 0,
};

test('water ESP: the pump database drives a coupled dP (not the typed one)', () => {
  const r = handlers['oil/nodal'](WATER_ESP);
  assert.ok(!r.error, r.error);
  assert.equal(r.esp.pumpName, 'ESP B 538-3600');
  assert.ok(r.esp.pumpDpPsi > 0, 'a dP was solved');
  assert.ok(Math.abs(r.esp.pumpDpPsi - 1325.16) > 1, 'solved dP is not the typed manual value');
  assert.ok(r.esp.headFt > 0 && r.esp.thrust, 'head and thrust reported');
  assert.ok(r.op && r.op.qOilStbD > 0, 'operating point found');
  assert.ok(r.esp.dischargePsi > r.esp.intakePsi, 'the pump lifts pressure');
});

test('water ESP: gas-free intake — no free gas, water gradient', () => {
  const r = handlers['oil/nodal'](WATER_ESP);
  // discharge - intake must equal the solved dP (nothing else acts at the node)
  assert.ok(Math.abs(r.esp.dischargePsi - r.esp.intakePsi - r.esp.pumpDpPsi) < 1.5);
});

test('water ESP: stage match works against the same catalog', () => {
  const r = handlers['oil/espstages']({ ...WATER_ESP, testQOilStbD: 2000, espMinIntakePsi: 300 });
  assert.ok(!r.error, r.error);
  assert.ok(r.stages > 0 && Number.isInteger(r.stages), `stages ${r.stages}`);
  assert.ok(r.intakePsi >= 300 - 1e-6, 'design floor respected');
});

test('water ESP: manual mode still honours the typed dP', () => {
  const r = handlers['oil/nodal']({ ...WATER_ESP, espPumpMode: 'manual', espPumpName: '__manual' });
  assert.ok(!r.error, r.error);
  assert.equal(r.esp.pumpName, null);
  assert.ok(Math.abs(r.esp.pumpDpPsi - 1325.16) < 1e-9, 'typed dP used verbatim');
});

test('water ESP sensitivity uses the coupled pump solve when one is selected', () => {
  const r = handlers['oil/sensitivity']({
    ...WATER_ESP,
    vlpSets: [{ label: '50Hz', freqHz: 50 }, { label: '60Hz', freqHz: 60 }],
  });
  assert.equal(r.vlpFamily.length, 2);
  const a = r.vlpFamily[0].curve[2].pwfPsi;
  const b = r.vlpFamily[1].curve[2].pwfPsi;
  assert.ok(b < a, `60 Hz must lower the water VLP: ${b} vs ${a}`);
});

// ---- sensitivity view: a solved node (and ESP data) per VLP set ----
test('sensitivity solves a nodal point for every VLP set', () => {
  const r = handlers['oil/sensitivity']({
    ...OIL_BASE, gorScfStb: 5000, liftType: 'natural',
    vlpSets: [{ label: 'A' }, { label: 'B', thpPsi: 300 }],
  });
  assert.equal(r.vlpFamily.length, 2);
  for (const m of r.vlpFamily) {
    assert.equal(m.opStatus, 'ok', `${m.label} ${m.opStatus}`);
    assert.ok(m.op.qOilStbD > 0 && m.op.pwfPsi > 0 && m.op.whtF > 0);
    assert.ok(Number.isFinite(m.op.whpPsi));
  }
  // a lower FTHP must lift the rate
  assert.ok(r.vlpFamily[1].op.qOilStbD > r.vlpFamily[0].op.qOilStbD);
  assert.equal(r.thrustLines, null, 'no pump: no thrust envelope');
});

test('ESP sensitivity carries pump data, traverse and a per-set pump curve', () => {
  const r = handlers['oil/sensitivity']({
    ...OIL_BASE, liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
    pumpAhM: 2993.08, pumpDpPsi: 1325.16, espFreqHz: 50, espStages: 145, espWearFactor: 0,
    vlpSets: [{ label: '50Hz', freqHz: 50 }, { label: '60Hz', freqHz: 60 }],
  });
  assert.equal(r.pumpName, 'ESP B 538-3600');
  assert.equal(r.thrustLines.length, 3, 'down/BEP/up envelope');
  for (const m of r.vlpFamily) {
    assert.equal(m.opStatus, 'ok');
    assert.ok(m.esp.dpPsi > 0 && m.esp.headFt > 0, 'pump solved at the node');
    assert.ok(m.esp.dischargePsi > m.esp.intakePsi);
    assert.ok(m.traverse.stations.length > 10 && m.traverse.backStations.length >= 2);
    assert.ok(m.traverse.pumpTvdFt > 0);
    assert.ok(m.pumpCurve.points.length > 3);
    assert.equal(m.pumpCurve.freqHz, m.esp.freqHz);
  }
  // more frequency = more head = a higher rate at the node
  const [a, b] = r.vlpFamily;
  assert.ok(b.esp.headFt > a.esp.headFt, `60 Hz head ${b.esp.headFt} vs ${a.esp.headFt}`);
  assert.ok(b.op.qOilStbD > a.op.qOilStbD, '60 Hz lifts more');
});

test('water ESP sensitivity solves the same way on the shared catalog', () => {
  const r = handlers['oil/sensitivity']({
    ...WATER_ESP,
    vlpSets: [{ label: '50Hz', freqHz: 50 }, { label: '60Hz', freqHz: 60 }],
  });
  assert.equal(r.fluid, 'water');
  assert.equal(r.pumpName, 'ESP B 538-3600');
  for (const m of r.vlpFamily) {
    assert.equal(m.opStatus, 'ok');
    assert.ok(m.esp.freeGasPct < 1e-9, 'water carries no free gas');
    assert.ok(m.traverse.stations.length > 10);
    assert.ok(m.pumpCurve.points.length > 3);
  }
});

// ---- the pump's full state at a solved node, match case and sensitivities ----
const POINT_KEYS = [
  'pumpName', 'stages', 'freqHz', 'refFreqHz', 'wearFactor', 'headFt', 'headPerStageFt',
  'dpPsi', 'qGrossPumpBpd', 'qGrossPumpNoSepBpd', 'gradPsiFt', 'freeGasPct',
  'thrust', 'thrustDownBpd', 'thrustBepBpd', 'thrustUpBpd', 'hydraulicHp', 'dpConverged',
];
const OIL_ESP = {
  ...OIL_BASE, liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
  pumpAhM: 2993.08, pumpDpPsi: 1325.16, espFreqHz: 50, espStages: 145, espWearFactor: 0, espSepEffPct: 95,
};

test('match case reports the pump state at the solution point', () => {
  const r = handlers['oil/esp'](OIL_ESP);
  assert.ok(!r.error, r.error);
  for (const k of POINT_KEYS) assert.ok(r.point[k] != null, `missing ${k}`);
  assert.equal(r.point.pumpName, 'ESP B 538-3600');
  assert.equal(r.point.stages, 145);
  // head per stage and hydraulic power must be self-consistent
  assert.ok(Math.abs(r.point.headPerStageFt * r.point.stages - r.point.headFt) < 1e-6);
  assert.ok(Math.abs(r.point.hydraulicHp - (r.point.qGrossPumpBpd * r.point.dpPsi) / 58766) < 1e-9);
  assert.ok(r.point.thrustDownBpd < r.point.thrustBepBpd && r.point.thrustBepBpd < r.point.thrustUpBpd);
});

test('sensitivity cases report the SAME pump parameter set', () => {
  const r = handlers['oil/sensitivity']({
    ...OIL_ESP, vlpSets: [{ label: '50Hz', freqHz: 50 }, { label: '60Hz', freqHz: 60 }],
  });
  for (const m of r.vlpFamily) {
    for (const k of POINT_KEYS) assert.ok(m.esp.point[k] != null, `${m.label} missing ${k}`);
    assert.equal(m.esp.point.freqHz, m.esp.freqHz);
  }
  // the frequency the set runs at must drive its head and power
  const [a, b] = r.vlpFamily.map((m) => m.esp.point);
  assert.ok(b.headPerStageFt > a.headPerStageFt, 'more Hz = more head per stage');
  assert.ok(b.hydraulicHp > a.hydraulicHp, 'and more hydraulic power');
});

test('water ESP reports the same pump state (match + sensitivity)', () => {
  const nodal = handlers['oil/nodal'](WATER_ESP);
  for (const k of POINT_KEYS) assert.ok(nodal.esp.point[k] != null, `match missing ${k}`);
  const sens = handlers['oil/sensitivity']({ ...WATER_ESP, vlpSets: [{ label: 'A', freqHz: 50 }] });
  for (const k of POINT_KEYS) assert.ok(sens.vlpFamily[0].esp.point[k] != null, `sens missing ${k}`);
  // gas-free water: nothing separated, so both pump rates agree
  const p = nodal.esp.point;
  assert.ok(Math.abs(p.qGrossPumpBpd - p.qGrossPumpNoSepBpd) < 1e-6);
});

test('sensitivity responses carry Pri so the chart can cap its pressure axis', () => {
  const oil = handlers['oil/sensitivity']({ ...OIL_BASE, gorScfStb: 5000, liftType: 'natural', vlpSets: [{ label: 'A' }] });
  assert.equal(oil.priPsi, OIL_BASE.priPsi, 'oil Pri');
  const water = handlers['oil/sensitivity']({ ...WATER_BASE, vlpSets: [{ label: 'A' }] });
  assert.equal(water.priPsi, WATER_BASE.priPsi, 'water Pri');
  const gas = handlers['gas/sensitivity']({
    thpPsi: 1625, qMMscfd: 14.137, cgrStbMMscf: 57.436, wgrStbMMscf: 3.846, tubingIdIn: 2.992, roughness: 0.0021,
    topPerfAhM: 3013, devStartM: 690, devAngleDeg: 23.65, condApi: 48.7, gasSg: 0.763, n2Pct: 1.2, co2Pct: 3, h2sPpm: 2,
    tresF: 232, condViscCp: 2, oilViscCp: 2, sigmaDyn: 30, soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
    priPsi: 3800, permMd: 5, thicknessFt: 80, reFt: 1640.5, rwFt: 0.5104, skin: 0, iprMode: 'j',
    vlpSets: [{ label: 'A' }],
  });
  assert.equal(gas.priPsi, 3800, 'gas Pri');
  // the IPR family can never exceed Pri — the inflow side is bounded by it
  for (const m of oil.iprFamily)
    for (const q of m.curve) assert.ok(q.pwfPsi <= oil.priPsi + 1e-6, `IPR ${q.pwfPsi} > Pri`);
  // the VLP CAN run above Pri at high rates — an unattainable region (the
  // well would need more pressure than the reservoir has). Capping the axis
  // at Pri hides exactly that tail so the crossing stays legible.
  const maxVlp = Math.max(...oil.vlpFamily.flatMap((m) => m.curve.map((q) => q.pwfPsi)));
  assert.ok(maxVlp > oil.priPsi, 'the VLP tail exceeds Pri, so the cap does real work');
  // the solved operating point always lies at or below Pri
  for (const m of oil.vlpFamily) if (m.op) assert.ok(m.op.pwfPsi <= oil.priPsi + 1e-6);
});
