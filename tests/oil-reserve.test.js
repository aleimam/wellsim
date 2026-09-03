// Oil reserve (Module 2) — synthetic round-trips: Pr inversion fixed point,
// Havlena-Odeh MB on a known tank, reservoir-limit chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zAtResOil,
  mbBgBblScf,
  prFromRowOil,
  oilPresSolver,
  oilStaticMb,
  stoiipFit,
  reservoirLimitOil,
} from '../src/core/reserve/oil-reserve.js';
import { createOilIpr } from '../src/core/ipr/oil-ipr.js';
import { futureOilJ } from '../src/core/nodal/sensitivity.js';
import { bubblePointPsi, oilViscosityCp, oilFvf, solutionGorScfStb } from '../src/core/pvt/oil.js';
import * as api from '../src/server/api.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// the natural-well demo fluid
const PVT_IN = { rsiScfStb: 700, gasSg: 0.842, api: 46, tempF: 201 };
const PB = bubblePointPsi(PVT_IN);
const PVT = { pbPsi: PB, ...PVT_IN };
const PRI = 3550;
const CFG = { tresF: 201, gasSg: 0.842, gorScfStb: 700, wcPct: 0, thpPsi: 700 };

function makeIpr() {
  const darcy = {
    permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0,
    viscCp: oilViscosityCp(PRI, PVT), bo: oilFvf(PRI, PVT),
  };
  return createOilIpr({ darcy, priPsi: PRI, pbPsi: PB, prPsi: PRI });
}

test('Pr inversion round-trips through the J_2 fixed point (undersaturated)', () => {
  const ipr = makeIpr();
  assert.ok(PB < 3000, `demo Pb ${PB} should sit below the test pressures`);
  const prTrue = 3300;
  const j2 = futureOilJ(prTrue, { darcy: ipr.darcy, pvt: PVT, rsCurScfStb: solutionGorScfStb(prTrue, PVT) }).j;
  const qGross = 150; // small enough that Pwf stays above Pb
  const pwf = prTrue - qGross / j2;
  assert.ok(pwf > PB);
  const r = prFromRowOil(ipr, PVT, { qGrossStbD: qGross, pwfPsi: pwf, prStart: PRI });
  close(r.presPsi, prTrue, 1e-8);

  // and through the solver row (Pwf as input -> no march)
  const solved = oilPresSolver(CFG, ipr, PVT, [
    { date: 0, qOilStbD: qGross, pwfPsi: pwf, wcPct: 0 },
    { date: 50, qOilStbD: qGross, pwfPsi: pwf, wcPct: 0 },
  ]);
  assert.equal(solved[0].pwfSource, 'input');
  close(solved[0].presPsi, prTrue, 1e-8);
  close(solved[1].npMMstb, (150 * 50) / 1e6);
  for (const s of solved) close(s.dpPsi, s.presPsi - s.pwfPsi);
});

test('static MB (memory gauge) recovers a known tank exactly (undersaturated)', () => {
  const ipr = makeIpr();
  const N = 20; // MMstb truth
  const boi = oilFvf(PRI, PVT);
  const pr2 = 3300;
  const bo2 = oilFvf(pr2, PVT);
  // above Pb: Rs = Rsi, produced GOR = Rsi -> Rp = Rsi -> F = Np*Bo, Eo = Bo-Boi
  const np2 = (N * (bo2 - boi)) / bo2;
  const q = (np2 * 1e6) / 100; // constant rate hits Np2 at day 100
  const prodRows = [
    { date: 0, qOilStbD: q, gorScfStb: 700 },
    { date: 100, qOilStbD: q, gorScfStb: 700 },
  ];
  const surveys = [
    { date: 0, presPsi: PRI },
    { date: 100, presPsi: pr2 },
  ];
  const r = oilStaticMb(CFG, ipr, PVT, surveys, prodRows);
  close(r.points[1].npMMstb, np2, 1e-9);
  close(r.points[1].nMMstb, N, 1e-6);
  close(r.fit.nAvgMMstb, N, 1e-6); // one informative row -> avg = truth
  close(r.fit.nSlopeMMstb, N, 1e-6); // (0,0) anchor + exact point -> slope = truth
  assert.equal(r.points[0].nMMstb, null); // initial survey (Np = 0) is the anchor
});

test('reservoir limit (oil units): slope, Ct, STOIP chain', () => {
  const rows = [0, 10, 20, 30, 40].map((d) => {
    const pres = 3400 - 2 * d;
    return { dtDays: d, pwfPsi: 3000 - 2 * d, presPsi: pres, z: zAtResOil(CFG, pres), qOilStbD: 1500 };
  });
  const r = reservoirLimitOil(CFG, rows, { cgOverride: 2e-4 });
  close(r.slopePsiDay, 2);
  const ct = 0.1 * 2e-4 + 0.8 * 1e-6 + 0.15 * 1e-6 + 3e-6;
  close(r.ct, ct);
  close(r.stoiipMMstb, 1500 / (ct * 2) / 1e6);
  close(r.qAvgStbD, 1500);
  // calculated-Cg path stays near 1/p
  const r2 = reservoirLimitOil(CFG, rows, {});
  assert.ok(Math.abs(r2.cg - 1 / 3360) / (1 / 3360) < 0.4, `cg=${r2.cg}`);
  assert.ok(r2.stoiipMMstb > 0);
});

test('MB Bg and reservoir z are sane at demo conditions', () => {
  const z = zAtResOil(CFG, 3000);
  assert.ok(z > 0.7 && z < 1.2, `z=${z}`);
  const bg = mbBgBblScf(201, z, 3000);
  assert.ok(bg > 5e-4 && bg < 2e-3, `bg=${bg}`); // bbl/scf at ~3000 psi
});

test('stoiipFit excludes no-production rows and warns with no signal', () => {
  const pts = [
    { fMMbbl: 0, eo: 0.001, npMMstb: 0, nMMstb: null }, // anchor-like: excluded
    { fMMbbl: 0.02, eo: 0.001, npMMstb: 1, nMMstb: 20 },
    { fMMbbl: 0.04, eo: 0.002, npMMstb: 2, nMMstb: 20 },
  ];
  const fit = stoiipFit(pts);
  close(fit.nAvgMMstb, 20);
  close(fit.nSlopeMMstb, 20, 1e-6);
  const empty = stoiipFit([{ fMMbbl: 0, eo: 0, npMMstb: 0, nMMstb: null }]);
  assert.equal(empty.nAvgMMstb, null);
  assert.ok(empty.warning);
});

// ---- an ESP well can be history-matched and forecast ----
// Reported 3 Sep 2026: selecting a catalogue pump made the oil forecast fail
// with "STOIIP N not given ... run the Reserve module first", even though the
// Reserve module had solved N and was showing it on screen.
//
// The cause was that BOTH modules reconstruct Pwf by marching the wellbore,
// and both marched directly. Under ESP the march needs a pump dP, and with a
// catalogue pump the dP is SOLVED from the curve at that rate rather than
// typed -- so the march threw "missing required input(s): pumpDpPsi", the
// reserve chain inside the forecast died, and N was never derived.
//
// These run through the API rather than the core, because the defect was in
// the wiring between them: the core physics was right, the reserve and
// forecast paths just never got the coupled solve the well model already had.
const ESP_PROD = [
  { date: '0', thpPsi: '700', qOilStbD: '2100', wcPct: '50', gorScfStb: '5000', pwfPsi: '' },
  { date: '90', thpPsi: '700', qOilStbD: '1950', wcPct: '52', gorScfStb: '5200', pwfPsi: '' },
  { date: '180', thpPsi: '700', qOilStbD: '1820', wcPct: '55', gorScfStb: '5400', pwfPsi: '' },
  { date: '270', thpPsi: '700', qOilStbD: '1700', wcPct: '57', gorScfStb: '5600', pwfPsi: '' },
];
const ESP_FORM = {
  thpPsi: '700', qOilStbD: '2100', wcPct: '50', gorScfStb: '5000', tubingIdIn: '2.992',
  roughness: '0.00006', topPerfAhM: '2810', devStartM: '1910', devAngleDeg: '7',
  api: '46', gasSg: '0.842', rsiScfStb: '700', tresF: '201', oilViscCp: '6',
  waterSg: '1.05', pbPsi: '', soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '3550', prPsi: '', permMd: '50', thicknessFt: '42.653', reFt: '1640.5',
  rwFt: '0.5104166667', skin: '0', matchHead: '1', matchFriction: '1',
  testQOilStbD: '2100', testThpPsi: '700', testPwfPsi: '',
  prodRows: ESP_PROD,
};
const WITH_PUMP = {
  liftType: 'esp', espPumpMode: 'db', espPumpName: 'WD 150',
  espStages: '145', espFreqHz: '50', pumpAhM: '2985', espSepEffPct: '95',
};

test('ESP: the reserve module solves Pres with the pump dP, not a typed one', () => {
  const r = api.oilReserve({ ...ESP_FORM, ...WITH_PUMP, presSource: 'prod' });
  // the old code THREW here ("missing required input(s): pumpDpPsi") because
  // no pumpDpPsi was supplied -- a catalogue pump has no typed dP
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 4);
  for (const row of r.rows) {
    assert.equal(row.pwfSource, 'calculated');
    assert.ok(row.presPsi > row.pwfPsi, 'Pres must exceed Pwf on every row');
  }
  assert.ok(r.fit.nAvgMMstb > 0, 'N must be solved, not left null');
});

test('ESP: the forecast derives N from the reserve chain instead of demanding it', () => {
  const r = api.oilForecastApi({ ...ESP_FORM, ...WITH_PUMP });
  // THE REPORTED BUG: this used to come back asking for a STOIIP the reserve
  // module had already solved
  assert.equal(r.error, undefined);
  assert.ok(r.nMMstb > 0, 'N must be carried from the reserve chain');
  assert.ok(r.eurMMstb > 0, 'the forecast must actually produce');
  assert.ok(r.rows.length > 1, 'the forecast must step');
});

test('a typed pump dP still works, and natural flow is untouched by the fix', () => {
  // manual dP: the injectable march must NOT hijack a typed value
  const manual = api.oilReserve({
    ...ESP_FORM, liftType: 'esp', espPumpMode: 'manual', pumpDpPsi: '1325.16',
    pumpAhM: '2985', presSource: 'prod',
  });
  assert.equal(manual.error, undefined);
  assert.ok(manual.fit.nAvgMMstb > 0);

  // and the default path is byte-identical: the same form without any lift
  // must give exactly what it gave before the march became injectable
  const natural = api.oilReserve({ ...ESP_FORM, presSource: 'prod' });
  assert.equal(natural.error, undefined);
  const fc = api.oilForecastApi({ ...ESP_FORM });
  assert.equal(fc.error, undefined);
  assert.ok(Math.abs(natural.fit.nAvgMMstb - 861.8939) < 0.01, `natural N drifted: ${natural.fit.nAvgMMstb}`);
  assert.ok(Math.abs(fc.eurMMstb - 3.6407) < 0.001, `natural EUR drifted: ${fc.eurMMstb}`);
});

// The ESP demo well (Oil well model_ESP_V5.01: FTHP 160, WC 5, GOR 384) found
// a SECOND failure the first ESP test did not. The forecast brackets its root
// by probing rates far below anything the well makes -- around 10 stb/d. There
// the coupled solve degenerates: the march returns a NaN intake pressure, dP
// comes back NaN, and feeding that NaN back in makes validateOilCfg report a
// MISSING pumpDpPsi -- naming an input the user never had to supply, for a
// rate the well never sees. marchFor now falls back to the plain march when
// the coupled solve yields nothing finite, whether it returns NaN or throws.
test('ESP: a forecast survives the low-rate probes used to bracket its root', () => {
  const f = {
    thpPsi: '160', qOilStbD: '2565', wcPct: '5', gorScfStb: '384', tubingIdIn: '2.992',
    roughness: '0.00006', topPerfAhM: '3240', devStartM: '1500', devAngleDeg: '0',
    api: '32', gasSg: '0.812', rsiScfStb: '384', tresF: '230', oilViscCp: '6',
    waterSg: '1.05', pbPsi: '', soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
    priPsi: '3550', prPsi: '', permMd: '50', thicknessFt: '42.653', reFt: '1640.5',
    rwFt: '0.5104166667', skin: '0', matchHead: '1', matchFriction: '1',
    testQOilStbD: '2565', testThpPsi: '160', testPwfPsi: '',
    prodRows: [
      { date: '17-Nov-14', thpPsi: '700', qOilStbD: '2100', gorScfStb: '384', wcPct: '5', pwfPsi: '' },
      { date: '1-Dec-14', thpPsi: '500', qOilStbD: '1700', gorScfStb: '384', wcPct: '5', pwfPsi: '' },
      { date: '17-Dec-14', thpPsi: '300', qOilStbD: '1200', gorScfStb: '384', wcPct: '5', pwfPsi: '' },
    ],
    liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
    espStages: '145', espFreqHz: '50', pumpAhM: '2985', espSepEffPct: '95',
  };
  const rsv = api.oilReserve({ ...f, presSource: 'prod' });
  assert.equal(rsv.error, undefined);
  assert.ok(rsv.fit.nAvgMMstb > 0);

  // this threw "missing required input(s): pumpDpPsi" before the fallback
  const fc = api.oilForecastApi(f);
  assert.equal(fc.error, undefined);
  assert.ok(fc.rows.length > 1, 'the forecast must step');
  // and the N it reports is the one the reserve module solved, not a typed one
  assert.ok(Math.abs(fc.nMMstb - rsv.fit.nAvgMMstb) < 1e-6, 'N must come from the reserve chain');
  for (const r of fc.rows) assert.ok(Number.isFinite(r.pwfPsi), 'every step needs a finite Pwf');
});
