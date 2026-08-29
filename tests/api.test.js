// API handler tests — the UI form payloads (defaults = the validated live
// cases) must produce complete, sane results through the JSON layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/server/api.js';

function close(actual, expected, rel = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual}`
  );
}

const OIL_FORM = {
  thpPsi: '700', qOilStbD: '2100', wcPct: '50', gorScfStb: '5000',
  tubingIdIn: '2.992', roughness: '0.00006',
  topPerfAhM: '2810', devStartM: '1910', devAngleDeg: '7',
  api: '46', gasSg: '0.842', rsiScfStb: '700', tresF: '201',
  oilViscCp: '6', waterSg: '1.05', pbPsi: '',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '3550', prPsi: '', permMd: '50', thicknessFt: '42.653',
  reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
  matchHead: '1', matchFriction: '1', injDepthTvdM: '', injRateMMscfd: '',
  testQOilStbD: '2100', testThpPsi: '700', testPwfPsi: '',
};

const GAS_FORM = {
  thpPsi: '1625', qGasMMscfd: '14.137', cgrStbMMscf: '57.4358974',
  wgrStbMMscf: '3.8461538', tubingIdIn: '2.992', roughnessBase: '0.0021',
  topPerfAhM: '3013', devStartM: '690', devAngleDeg: '23.65',
  condApi: '48.7', gasSg: '0.763', n2Pct: '1.2', co2Pct: '3', h2sPpm: '2',
  tresF: '232', oilViscCp: '2', sigmaDyneCm: '30',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '3800', prPsi: '', permMd: '5', thicknessFt: '80',
  reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
  matchHead: '1', matchFriction: '1', iprMode: 'j',
  testPoints: [
    { thpPsi: '2440', qMMscfd: '5.192', pwfPsi: '' },
    { thpPsi: '2000', qMMscfd: '10.002', pwfPsi: '' },
    { thpPsi: '1625', qMMscfd: '14.137', pwfPsi: '' },
  ],
};

test('oil nodal endpoint: full result from the default form', () => {
  const r = handlers['oil/nodal'](OIL_FORM);
  assert.equal(r.error, undefined);
  close(r.pbPsi, 1920.00761413201, 1e-9);
  assert.ok(Math.abs(r.ipr.jDarcy - 4.7239) < 0.01); // Darcy at current-Pr mu*Bo
  assert.equal(r.ipr.jSource, 'darcy');
  assert.equal(r.iprCurve.length, 12);
  assert.equal(r.vlpCurve.length, 13);
  assert.equal(r.whpCurve.length, 13);
  // WHP rows carry the calculated WHT and stay consistent with the VLP pass
  for (let i = 0; i < r.whpCurve.length; i++) {
    assert.ok(Number.isFinite(r.whpCurve[i].whtF) && r.whpCurve[i].whtF > 90 && r.whpCurve[i].whtF < 201);
    assert.equal(r.whpCurve[i].pwfVlpPsi, r.vlpCurve[i].pwfPsi);
  }
  assert.equal(r.opStatus, 'ok');
  assert.ok(r.op.qOilStbD > 1000 && r.op.qOilStbD < r.aofOilStbD);
  assert.ok(Number.isFinite(r.op.whtF));
});

test('oil calibrate endpoint: get Pwf, Jones J, matched K at user skin', () => {
  const r = handlers['oil/calibrate']({ ...OIL_FORM, skin: '3' });
  assert.equal(r.error, undefined);
  assert.equal(r.pwfSource, 'calculated');
  assert.ok(r.testPwfPsi > 1000);
  close(r.testQGrossStbD, 4200, 1e-9);
  assert.ok(r.jTest > 3 && r.jTest < 8);
  assert.ok(r.matchedPermMd > 0);
  assert.equal(r.skinUsed, 3);
  // with a gauge Pwf given, the workbook J is reproduced
  const r2 = handlers['oil/calibrate']({ ...OIL_FORM, testPwfPsi: '2661.29425223016' });
  close(r2.jTest, 4.72597371012811, 1e-9);
  assert.equal(r2.pwfSource, 'input');
});

test('oil sensitivity endpoint: families with default sets', () => {
  const r = handlers['oil/sensitivity']({
    ...OIL_FORM,
    vlpSets: [{ label: 'VLP1', wcPct: '0' }, { label: 'VLP2', wcPct: '40' }, { label: 'VLP3', wcPct: '80' }],
    presList: ['2662.5', '1775', '887.5'],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.vlpFamily.length, 3);
  // the current-Pr reference curve leads, then the three future pressures.
  // It is the curve the per-set solutions are solved against, so the chart
  // cannot omit it.
  assert.equal(r.iprFamily.length, 4);
  assert.equal(r.iprFamily[0].isCurrent, true);
  close(r.iprFamily[0].presPsi, 3550, 1e-9); // prPsi blank -> Pri
  assert.ok(!r.iprFamily.slice(1).some((m) => m.isCurrent || m.isPri));
  close(r.iprFamily[1].j, 5.27146844059, 1e-9); // J_21 through the API
  close(r.iprFamily[3].j, 6.78094220552862, 1e-9); // J_23
  // every set carries the solution the table lists and the chart marks
  for (const m of r.vlpFamily) assert.ok(m.op ? m.op.qOilStbD > 0 : m.opStatus);
});

test('a depleted well shows BOTH current Pr and Pri as reference curves', () => {
  const r = handlers['oil/sensitivity']({
    ...OIL_FORM,
    prPsi: '2800', // below Pri 3550
    vlpSets: [{ label: 'VLP1', thpPsi: '400' }],
    presList: [],
  });
  assert.equal(r.error, undefined);
  const refs = r.iprFamily.filter((m) => m.isCurrent || m.isPri);
  assert.equal(refs.length, 2);
  close(refs[0].presPsi, 2800, 1e-9);
  close(refs[1].presPsi, 3550, 1e-9);
  // and only one when they coincide
  const same = handlers['oil/sensitivity']({
    ...OIL_FORM, vlpSets: [{ label: 'VLP1', thpPsi: '400' }], presList: [],
  });
  assert.equal(same.iprFamily.filter((m) => m.isCurrent || m.isPri).length, 1);
});

test('gas nodal endpoint (Darcy J mode) and calibrate (C&n from table)', () => {
  const r = handlers['gas/nodal'](GAS_FORM);
  assert.equal(r.error, undefined);
  assert.equal(r.ipr.mode, 'j');
  assert.equal(r.opStatus, 'ok');
  assert.ok(r.op.qMMscfd > 0.5 && r.op.qMMscfd < r.aofMMscfd);

  const cal = handlers['gas/calibrate']({ ...GAS_FORM, skin: '4' });
  // Darcy Pr^2 is dominant: calculated J + actual matched K at user skin
  assert.ok(cal.jTest > 0);
  assert.ok(cal.matchedPermMd > 0);
  assert.equal(cal.skinUsed, 4);
  // C&n comes along as the calculated optional basis
  assert.ok(cal.n > 0.5 && cal.n <= 1.3);
  assert.ok(cal.qMaxMMscfd > 14.137);
  // the three test-point Pwfs come from get_Pwf — the workbook's C22:C24
  close(cal.points[0].pwfPsi, 3414.01525251788, 1e-6);
  close(cal.points[1].pwfPsi, 2913.97067332777, 1e-6);
  close(cal.points[2].pwfPsi, 2647.81711594455, 1e-6);
  // single-point calibration still matches K (no C&n)
  const one = handlers['gas/calibrate']({
    ...GAS_FORM,
    skin: '0',
    testPoints: [{ thpPsi: '1625', qMMscfd: '14.137', pwfPsi: '' }],
  });
  assert.ok(one.jTest > 0 && one.matchedPermMd > 0);
  assert.equal(one.c, null);
});

test('gas sensitivity endpoint', () => {
  const r = handlers['gas/sensitivity']({
    ...GAS_FORM,
    vlpSets: [{ label: 'VLP1', thpPsi: '2440' }, { label: 'VLP2', thpPsi: '2000' }],
    presList: ['2850', '1900'],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.vlpFamily.length, 2);
  assert.equal(r.iprFamily.length, 3); // current Pr + the two future pressures
  assert.equal(r.iprFamily[0].isCurrent, true);
  // gas gained the per-set nodal solution the oil and water tabs already had
  for (const m of r.vlpFamily) {
    assert.ok(m.op, `${m.label} should solve: ${m.opStatus}`);
    assert.ok(m.op.qMMscfd > 0 && m.op.pwfPsi > 0 && m.op.whtF > 0);
  }
  // a lower THP must produce a higher rate
  assert.ok(r.vlpFamily[1].op.qMMscfd > r.vlpFamily[0].op.qMMscfd);
});

test('endpoints surface clean errors instead of NaN results', () => {
  // the server wraps handler throws into { error }; the message names the field
  assert.throws(() => handlers['oil/nodal']({ ...OIL_FORM, soilTempF: '' }), /soilTempF/);
});

test('oil nodal in ESP mode (manual pump dP): discharge/intake reported', () => {
  const r = handlers['oil/nodal']({
    ...OIL_FORM,
    liftType: 'esp',
    thpPsi: '160', qOilStbD: '2565', wcPct: '5', gorScfStb: '384',
    api: '32', gasSg: '0.812', rsiScfStb: '384', tresF: '230',
    topPerfAhM: '3240', devStartM: '1500', devAngleDeg: '0',
    priPsi: '2650', permMd: '60', thicknessFt: '50',
    pumpTvdM: '2985', pumpDpPsi: '1325.157', tubingGasScfD: '872994.21',
  });
  assert.equal(r.error, undefined);
  assert.equal(r.opStatus, 'ok');
  assert.ok(r.esp && r.esp.dischargePsi > r.esp.intakePsi);
  assert.ok(Math.abs(r.esp.dischargePsi - r.esp.intakePsi - 1325.157) < 1e-9);
});

test('lift type gates the blocks: natural ignores GL/ESP fields', () => {
  const r = handlers['oil/nodal']({
    ...OIL_FORM,
    liftType: 'natural',
    injDepthTvdM: '2490', injRateMMscfd: '1',
    pumpTvdM: '2985', pumpDpPsi: '1000',
  });
  assert.equal(r.error, undefined);
  assert.equal(r.esp, null);
  // gas-lift endpoint refuses when another lift type is active
  const gl = handlers['oil/gaslift']({ ...OIL_FORM, liftType: 'esp', injDepthTvdM: '2490' });
  assert.match(gl.error, /switch the lift type/);
});

test('gas reserve endpoint: Pres solver + p/Z fit from form rows', () => {
  const r = handlers['gas/reserve']({
    ...GAS_FORM,
    prodRows: [
      { date: '0', thpPsi: '1625', qMMscfd: '14.137', pwfPsi: '' },
      { date: '60', thpPsi: '1625', qMMscfd: '13.2', pwfPsi: '' },
      { date: '120', thpPsi: '1625', qMMscfd: '12.4', pwfPsi: '' },
      { date: '180', thpPsi: '1625', qMMscfd: '11.7', pwfPsi: '' },
    ],
    sithpRows: [],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 4);
  for (const row of r.rows) {
    assert.equal(row.pwfSource, 'calculated');
    assert.ok(row.presPsi > row.pwfPsi);
  }
  assert.ok(r.rows[3].gpBscf > 2);
  assert.ok(Number.isFinite(r.fit.pziPsi));
  console.log(`    gas reserve: GIIP=${r.fit.giipBscf?.toFixed(1)} Bscf, pzi=${r.fit.pziPsi.toFixed(0)} psi`);
});

test('gas reserve route 1: SITHP statics, no IPR needed', () => {
  const r = handlers['gas/reserve']({
    ...GAS_FORM,
    presSource: 'sithp',
    prodRows: [
      { date: '17-Nov-14', qMMscfd: '18.56' },
      { date: '17-Nov-19', qMMscfd: '17' },
      { date: '26-Nov-24', qMMscfd: '11' },
    ],
    sithpRows: [
      { date: '17-Nov-14', sithpPsi: '2500', qMMscfd: '0', cgrStbMMscf: '57', wgrStbMMscf: '2.1' },
      { date: '17-Nov-19', sithpPsi: '2000', qMMscfd: '0', cgrStbMMscf: '40', wgrStbMMscf: '2.1' },
      { date: '26-Nov-24', sithpPsi: '1700', qMMscfd: '0', cgrStbMMscf: '20', wgrStbMMscf: '2.1' },
    ],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.mode, 'sithp');
  assert.equal(r.rows.length, 3);
  assert.ok(r.rows[0].presPsi > r.rows[0].sithpPsi);
  assert.ok(r.rows[1].presPsi < r.rows[0].presPsi);
  assert.ok(r.fit.giipBscf > 0);
  console.log(`    SITHP route: Pres ${r.rows.map((p) => p.presPsi.toFixed(0)).join(', ')} → GIIP ${r.fit.giipBscf.toFixed(1)} Bscf`);
  // guards
  const bad = handlers['gas/reserve']({ ...GAS_FORM, presSource: 'sithp', prodRows: [], sithpRows: [] });
  assert.match(bad.error, /2 SITHP surveys/);
});

test('gas reserve selection 3: reservoir limit, workbook method, no rate filter', () => {
  const r = handlers['gas/reserve']({
    ...GAS_FORM,
    presSource: 'rlt',
    prodRows: [
      { date: '0', thpPsi: '1625', qMMscfd: '14.137' },
      { date: '30', thpPsi: '1600', qMMscfd: '13.5' }, // rates NOT constant — all rows used
      { date: '60', thpPsi: '1575', qMMscfd: '13.0' },
      { date: '90', thpPsi: '1550', qMMscfd: '12.4' },
    ],
    sithpRows: [],
    rltSg: '0.85', rltSo: '0', rltSw: '0.15',
  });
  assert.equal(r.error, undefined);
  assert.equal(r.mode, 'rlt');
  assert.equal(r.rows.length, 4);
  assert.ok(r.rlt.slopePsiDay > 0);
  assert.ok(r.rlt.cg > 0 && r.rlt.ct > r.rlt.cg * 0.8);
  assert.ok(r.rlt.giipBscf > 0);
  assert.equal(r.fit.giipBscf, r.rlt.giipBscf);
  console.log(`    RLT: m=${r.rlt.slopePsiDay.toFixed(3)} psi/day, Cg=${r.rlt.cg.toExponential(2)}, Ct=${r.rlt.ct.toExponential(2)} → GIIP ${r.rlt.giipBscf.toFixed(1)} Bscf`);
  // per-row CGR/WGR reach the march (selection 1 path shares the rows)
  const withRatios = handlers['gas/reserve']({
    ...GAS_FORM,
    presSource: 'prod',
    prodRows: [
      { date: '0', thpPsi: '1625', qMMscfd: '14.137', cgrStbMMscf: '57.4358974', wgrStbMMscf: '3.8461538' },
      { date: '60', thpPsi: '1625', qMMscfd: '13.2', cgrStbMMscf: '40', wgrStbMMscf: '10' },
    ],
    sithpRows: [],
  });
  assert.equal(withRatios.error, undefined);
  assert.equal(withRatios.mode, 'flowing');
  assert.ok(Number.isFinite(withRatios.rows[1].pwfPsi));
});

test('gas reserve rejects unparseable dates with a named error', () => {
  const r = handlers['gas/reserve']({
    ...GAS_FORM,
    prodRows: [
      { date: '01/03/2014 08:30:00', thpPsi: '1625', qMMscfd: '14.137' },
      { date: '46/03/2014 08:30:00', thpPsi: '1600', qMMscfd: '13' },
    ],
    sithpRows: [],
  });
  assert.match(r.error, /row 2: unparseable date "46\/03\/2014/);
});

test('gas forecast endpoint: derives GIIP from rows when blank', () => {
  const r = handlers['gas/forecast']({
    ...GAS_FORM,
    prodRows: [
      { date: '0', thpPsi: '1625', qMMscfd: '14.137' },
      { date: '60', thpPsi: '1625', qMMscfd: '13.2' },
      { date: '120', thpPsi: '1625', qMMscfd: '12.4' },
      { date: '180', thpPsi: '1625', qMMscfd: '11.7' },
    ],
    sithpRows: [],
    stepDays: '30', forecastFthpPsi: '1200', plateauMMscfd: '12',
    minRateMMscfd: '1', maxSteps: '25', giipBscf: '', pziPsi: '',
  });
  assert.equal(r.error, undefined);
  assert.ok(r.giipBscf > 0);
  assert.ok(r.rows.length > 3);
  for (const p of r.rows) assert.ok(p.qMMscfd <= 12 + 1e-9);
  assert.ok(r.eurBscf > r.startGpBscf);
  console.log(`    gas forecast: GIIP=${r.giipBscf.toFixed(1)}, ${r.rows.length} steps, EUR=${r.eurBscf.toFixed(1)} Bscf, status=${r.status}`);
});

test('skin guidance endpoint', () => {
  const r = handlers['skin-guidance']();
  assert.ok(r.guidance.length >= 10);
});

// The 'current rate' input was removed from all three fluids: the well model
// SOLVES for the rate, so nothing may depend on a typed one. This pins that —
// the ESP back-traverse used to march at cfg's rate, which meant the traverse
// below the pump was drawn at whatever the user had typed instead of at the
// operating rate.
test('current rate is not an input: results are identical whatever is passed', async () => {
  const strip = (f) => { const c = { ...f }; delete c.qOilStbD; delete c.qGasMMscfd; return c; };
  const cases = [
    ['oil natural', 'oil/nodal', { ...OIL_FORM, liftType: 'natural' }, 'qOilStbD'],
    ['oil ESP', 'oil/nodal', {
      ...OIL_FORM, liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
      espStages: '145', espFreqHz: '50', espSepEffPct: '95', pumpAhM: '2993.08',
      espRefFreqHz: '60', espMinIntakePsi: '300',
    }, 'qOilStbD'],
  ];
  for (const [label, route, form, key] of cases) {
    const bare = strip(form);
    const base = JSON.stringify(handlers[route](bare));
    for (const v of ['2100', '50000', '1']) {
      const got = JSON.stringify(handlers[route]({ ...bare, [key]: v }));
      assert.equal(got, base, `${label}: passing ${key}=${v} changed the result`);
    }
  }
});

test('ESP back-traverse is marched at the SOLVED rate', async () => {
  const form = {
    ...OIL_FORM, liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
    espStages: '145', espFreqHz: '50', espSepEffPct: '95', pumpAhM: '2993.08',
    espRefFreqHz: '60', espMinIntakePsi: '300',
  };
  delete form.qOilStbD;
  const r = handlers['oil/nodal'](form);
  assert.ok(r.op && r.op.qOilStbD > 0, 'needs an operating point');
  const back = r.espTraverse.backStations;
  assert.ok(back.length >= 2, 'back-march should have stations');
  // marched from the perfs upward: pressure falls as TVD decreases
  const deep = back[back.length - 1], shallow = back[0];
  assert.ok(deep.tvdFt >= shallow.tvdFt, 'stations run shallow -> deep');
  assert.ok(deep.pPsi > shallow.pPsi, 'pressure must rise with depth');
});
