// Artificial-lift selection — golden tests on the workbook demo well
// ("Artificial Lift Method Selection" workbook: ESP / gas lift / sucker rod /
// jet / PCP screened across three life snapshots, then costed on the one-year
// cumulative oil from those snapshots).
//
// GLR is CALCULATED from the GOR and the water cut, never typed:
//   GLR = GOR x (1 - W.C/100)
// The workbook's own typed figures are exactly that (400 x 0.98/0.80/0.50 =
// 392 / 320 / 200), so deriving it reproduces the sheet rather than departing
// from it — these tests pin both the derivation and the screen it feeds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/server/api.js';
import { screenLifecycle } from '../src/core/allift/screen.js';
import { economicScreen, trapezoidCumStb } from '../src/core/allift/economics.js';

const SNAPS = [
  { j: 0.7, prPsi: 5200, pbPsi: 2000, pwfPsi: 2000, depthFt: 3200, whpPsi: 250, wcPct: 2, gorScfStb: 400, devDeg: 1, dogLegDeg: 7 },
  { j: 0.7, prPsi: 3500, pbPsi: 2000, pwfPsi: 2000, depthFt: 3200, whpPsi: 250, wcPct: 20, gorScfStb: 400, devDeg: 1, dogLegDeg: 7 },
  { j: 0.7, prPsi: 2500, pbPsi: 2000, pwfPsi: 2000, depthFt: 3200, whpPsi: 250, wcPct: 50, gorScfStb: 400, devDeg: 1, dogLegDeg: 7 },
];
const FORM = {
  snapshots: SNAPS,
  capexUsd: { ESP: 500000, GL: 150000, SRP: 300000, JET: 292000, PCP: 400000 },
  opexUsdPerBbl: 3,
  udcLimitUsdPerBbl: 11,
  gates: { naturalFlow: true, nearGasCompression: true, sourGasHigh: false },
};
const run = (f = {}) => api.handlers['allift/select']({ ...FORM, ...f });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}±${tol}, got ${a}`);

test('allift: GLR is derived from GOR and W.C, matching the workbook figures', () => {
  const r = run();
  assert.equal(r.snapshots.length, 3);
  near(r.snapshots[0].glr, 392, 1e-9, 'initial GLR'); // 400 x 0.98
  near(r.snapshots[1].glr, 320, 1e-9, '+6 mo GLR'); //  400 x 0.80
  near(r.snapshots[2].glr, 200, 1e-9, '+1 yr GLR'); //  400 x 0.50
  for (const s of r.snapshots) near(s.glr, s.gorScfStb * (1 - s.wcPct / 100), 1e-12, 'GLR identity');
});

test('allift: a typed GLR cannot contradict its own GOR/W.C — it is ignored', () => {
  const r = run({ snapshots: SNAPS.map((s) => ({ ...s, glr: 9999 })) });
  near(r.snapshots[0].glr, 392, 1e-9, 'typed GLR must not survive');
});

test('allift: Qgross is the composite Vogel across the three snapshots', () => {
  const r = run();
  near(r.snapshots[0].qGrossStbD, 2240, 1e-6, 'initial');
  near(r.snapshots[1].qGrossStbD, 1050, 1e-6, '+6 mo');
  near(r.snapshots[2].qGrossStbD, 350, 1e-6, '+1 yr');
});

test('allift: the demo well screens to ESP + Gas Lift + Jet, SRP and PCP out', () => {
  const r = run();
  assert.deepEqual(r.screen.technicallyApplicable, ['ESP', 'GL', 'JET']);
  assert.ok(r.screen.byMethod.SRP.failedParams.includes('depthFt'));
  assert.ok(r.screen.byMethod.SRP.failedParams.includes('dogLegDeg'));
  assert.ok(r.screen.byMethod.PCP.failedParams.includes('depthFt'));
});

test('allift: the UDC denominator is cumulative OIL, not gross liquid', () => {
  const r = run();
  assert.equal(r.cumBasis.stream, 'oil');
  // each snapshot's oil rate is the gross rate less the water cut ...
  for (const s of r.snapshots) near(s.oilRateStbD, s.qGrossStbD * (1 - s.wcPct / 100), 1e-9, 'oil rate');
  // ... so the cum is the trapezoid of THOSE, and sits below the gross cum by
  // the water cut: 369,581 against 427,963 stb, 13.6% on this well. The
  // trapezoid weights the early, driest snapshots most, which is why the gap is
  // smaller than the 50% water cut of the final one - but it is enough to move
  // the ESP's UDC by 0.18 $/bbl, so the two are not interchangeable.
  const oil = trapezoidCumStb(r.snapshots.map((s) => s.oilRateStbD));
  const gross = trapezoidCumStb(r.snapshots.map((s) => s.qGrossStbD));
  near(r.cumBasis.oneYearCumStb, oil, 1e-9, 'cum is the oil trapezoid');
  assert.ok(oil < gross * 0.9, `oil cum ${oil} should sit below gross ${gross}`);
  near(500000 / oil - 500000 / gross, 0.1845, 0.001, 'what costing on gross would hide');
  // and the UDC that quotes it is $/bbl of oil
  near(r.economics.byMethod.GL.udcUsdPerBbl, 150000 / oil + 3, 1e-9, 'UDC = capex/cum-oil + opex');
});

test('allift: one-year cum and UDC tie to the workbook; Gas Lift is the pick', () => {
  const r = run();
  near(r.cumBasis.oneYearCumStb, 369580.75, 1, 'one-year cum'); // trapezoid of 2195.2 / 840 / 175
  near(r.economics.byMethod.ESP.udcUsdPerBbl, 4.353, 0.01, 'ESP UDC');
  near(r.economics.byMethod.GL.udcUsdPerBbl, 3.406, 0.01, 'GL UDC');
  near(r.economics.byMethod.JET.udcUsdPerBbl, 3.79, 0.01, 'JET UDC');
  assert.equal(r.recommendation, 'GL');
  // technical acceptance comes first: a rejected method is not costed at all,
  // so a cheap-but-undeployable option never sits beside the real candidates
  assert.ok(!r.economics.byMethod.SRP, 'SRP is not costed');
  assert.ok(!r.economics.byMethod.PCP, 'PCP is not costed');
  assert.deepEqual(Object.keys(r.economics.byMethod).sort(), ['ESP', 'GL', 'JET']);
  assert.deepEqual(r.economics.notCosted.sort(), ['PCP', 'SRP']); // reported, not silent
});

// ---- well-condition gates: rule a method out, with its reason ----

test('gate: no gas compression rules Gas Lift out, and the pick falls to Jet', () => {
  const r = run({ gates: { naturalFlow: false, nearGasCompression: false, sourGasHigh: false } });
  // it still clears its envelope — the exclusion is a facility question
  assert.ok(r.screen.technicallyApplicable.includes('GL'), 'GL clears the bands');
  assert.ok(!r.applicable.includes('GL'), 'GL is ruled out');
  assert.match(r.gateExclusions.GL[0], /no source of injection gas/i);
  // GL was the cheapest; with it out the recommendation moves to the next one
  assert.equal(r.recommendation, 'JET');
  // and a gated method is dropped from the economics entirely, not priced
  assert.ok(!r.economics.byMethod.GL, 'GL is not costed once ruled out');
  assert.ok(r.economics.notCosted.includes('GL'), 'GL is reported as not costed');
  assert.ok(r.warnings.some((w) => /GL clears its envelope but is ruled out/.test(w)), 'the reason is surfaced');
});

test('gate: natural flow rules Sucker Rod out, with its reason', () => {
  const r = run({ gates: { naturalFlow: true, nearGasCompression: true, sourGasHigh: false } });
  assert.ok(r.gateExclusions.SRP, 'SRP excluded');
  assert.match(r.gateExclusions.SRP[0], /flows naturally/i);
  assert.ok(!r.applicable.includes('SRP'));
});

test('gate: high H2S/CO2 rules Sucker Rod out, with its reason', () => {
  const r = run({ gates: { naturalFlow: false, nearGasCompression: true, sourGasHigh: true } });
  assert.ok(r.gateExclusions.SRP, 'SRP excluded');
  assert.match(r.gateExclusions.SRP[0], /sour service|sulphide/i);
  assert.ok(!r.applicable.includes('SRP'));
});

test('gate: both sucker-rod conditions give both reasons, not one', () => {
  const r = run({ gates: { naturalFlow: true, nearGasCompression: true, sourGasHigh: true } });
  assert.equal(r.gateExclusions.SRP.length, 2, 'each condition states itself');
});

// A shallower, gentler, lower-rate well than the demo, so PCP actually clears
// its envelope — on the demo well it fails on depth and dog-leg, which would
// hide whether the sour-gas gate fired at all.
const PCP_OK = [2, 20, 50].map((wcPct, i) => ({
  j: 0.5, prPsi: [5200, 3500, 2500][i], pbPsi: 2000, pwfPsi: 2000,
  depthFt: 2200, whpPsi: 250, wcPct, gorScfStb: 400, devDeg: 3, dogLegDeg: 2,
}));

test('gate: high H2S/CO2 also rules PCP out, on the stator elastomer', () => {
  const clean = run({ snapshots: PCP_OK, gates: { naturalFlow: false, nearGasCompression: true, sourGasHigh: false } });
  assert.ok(clean.applicable.includes('PCP'), 'PCP clears its envelope on this well');

  const r = run({ snapshots: PCP_OK, gates: { naturalFlow: false, nearGasCompression: true, sourGasHigh: true } });
  assert.ok(r.screen.technicallyApplicable.includes('PCP'), 'still inside its bands — the exclusion is metallurgy');
  assert.ok(!r.applicable.includes('PCP'), 'but ruled out by the well');
  assert.match(r.gateExclusions.PCP[0], /stator|elastomer/i);
  assert.ok(!r.economics.byMethod.PCP, 'and therefore never costed');
  assert.ok(r.economics.notCosted.includes('PCP'), 'reported, not silently dropped');
  assert.ok(r.warnings.some((w) => /^PCP clears its envelope but is ruled out/.test(w)), 'the reason reaches the user');
});

test('gate: high H2S/CO2 leaves the jet pump IN, with a power-fluid warning', () => {
  // The published screening tables rate the jet pump well on corrosion: no
  // moving parts downhole, carbide nozzle and throat, inhibitor carried in the
  // power fluid. What sour gas raises is a surface-facilities question, so it
  // is a named note rather than an exclusion.
  const r = run({ snapshots: PCP_OK, gates: { naturalFlow: false, nearGasCompression: true, sourGasHigh: true } });
  assert.ok(!r.gateExclusions.JET, 'jet pump is not excluded by sour gas');
  assert.ok(r.applicable.includes('JET'), 'and stays in the costed set');
  assert.ok(r.economics.byMethod.JET, 'jet pump is costed');
  const jetNote = (r.gateNotes || []).find((g) => g.method === 'JET');
  assert.ok(jetNote, 'the sour-service caveat is stated against the jet pump');
  assert.match(jetNote.text, /power[- ]fluid/i);
});

test('gate: with no condition set, nothing is excluded and the demo is unchanged', () => {
  const r = run({ gates: { naturalFlow: false, nearGasCompression: true, sourGasHigh: false } });
  assert.deepEqual(r.gateExclusions, {});
  assert.deepEqual(r.applicable, ['ESP', 'GL', 'JET']);
  assert.equal(r.recommendation, 'GL');
});

test('gate: excluding every survivor leaves no recommendation, and says why', () => {
  // ESP and JET out on their envelopes (a shallow, low-rate well), GL by gate
  const shallow = SNAPS.map((s) => ({ ...s, depthFt: 1200, j: 0.02 }));
  const r = run({ snapshots: shallow, gates: { naturalFlow: false, nearGasCompression: false, sourGasHigh: false } });
  assert.ok(!r.applicable.includes('GL'));
  assert.equal(r.recommendation, null);
  assert.ok(r.warnings.length > 0, 'the user is told why nothing was picked');
});

test('allift: the core screen is reachable directly and agrees with the handler', () => {
  const r = run();
  const points = r.snapshots.map((s) => ({
    qGrossStbD: s.qGrossStbD, depthFt: s.depthFt, glr: s.glr, whpPsi: s.whpPsi,
    wcPct: s.wcPct, gorScfStb: s.gorScfStb, devDeg: s.devDeg, dogLegDeg: s.dogLegDeg,
  }));
  const s = screenLifecycle(points);
  assert.deepEqual(s.technicallyApplicable, r.screen.technicallyApplicable);
  const cum = trapezoidCumStb(r.snapshots.map((x) => x.oilRateStbD));
  near(cum, r.cumBasis.oneYearCumStb, 1e-6, 'cum via the core');
  const econ = economicScreen({
    methods: ['ESP', 'GL', 'SRP', 'JET', 'PCP'],
    applicable: s.technicallyApplicable,
    capexUsdByMethod: FORM.capexUsd,
    opexUsdPerBbl: 3,
    udcLimitUsdPerBbl: 11,
    cumByMethod: Object.fromEntries(['ESP', 'GL', 'SRP', 'JET', 'PCP'].map((m) => [m, { value: cum, source: 'prod-data' }])),
  });
  assert.equal(econ.cheapestApplicable, 'GL');
});
