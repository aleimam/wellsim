// ESP stack — pump catalog, curve/affinity math, intake gas & separator
// block, coupled dP solve, operating point, and the two matches.
// Pins from Oil well model_ESP_V5.01 (demo: ESP B 538-3600, 145 stages,
// 50 Hz, wear 0, separator 95 %).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESP_PUMPS, pumpByName, THRUST } from '../src/core/vlp/esp-catalog.js';
import {
  pumpCurveAt,
  headAtRateFt,
  thrustStatus,
  espIntakeState,
  espSolveDp,
  espOperatingPoint,
  matchStages,
  matchWearAndPi,
} from '../src/core/vlp/esp.js';
import { createOilIpr } from '../src/core/ipr/oil-ipr.js';
import { deriveOilFlow } from '../src/core/vlp/oil-march.js';
import * as api from '../src/server/api.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// the workbook demo well (same cfg as the pinned ESP march tests)
const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };
const CFG = {
  ...HEAT,
  thpPsi: 160, qOilStbD: 2565, gorScfStb: 384, wcPct: 5, api: 32,
  gasSg: 0.812, tresF: 230, perfTvdM: 3240, devStartM: 1500, devAngleDeg: 0,
  tubingIdIn: 2.992, roughness: 0.00006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 384, pbPsi: 1911.80724408471, matchHead: 1, matchFriction: 1,
  esp: { pumpTvdM: 2985, pumpDpPsi: 0 },
};
const PUMP = pumpByName('ESP B 538-3600');
const OPTS = { stages: 145, freqHz: 50, wearFactor: 0, sepEffPct: 95 };
// the workbook's PI-input IPR: PI 2.7 bbl/d/psi at constant Pres 2650
const IPR = createOilIpr({ jTest: 2.7, priPsi: 2650, pbPsi: 1911.80724408471, prPsi: 2650 });

test('catalog: 69 pumps, demo curve verbatim, thrust markers', () => {
  assert.equal(ESP_PUMPS.length, 69);
  assert.ok(PUMP, 'demo pump present');
  assert.equal(PUMP.refFreqHz, 60);
  assert.deepEqual(PUMP.points[0], { headFt: 64, rateBpd: 0 });
  assert.deepEqual(PUMP.points[5], { headFt: 54.5, rateBpd: 3000 }); // BEP
  assert.deepEqual(PUMP.points[10], { headFt: 0, rateBpd: 5700 });
  assert.equal(THRUST.bep, 5);
});

test('affinity + stages scaling pinned (ESP!E21, H21)', () => {
  const at60 = pumpCurveAt(PUMP, { stages: 145, freqHz: 60 });
  close(at60[0].headFt, 9280); // E21 = 64*145
  const at30 = pumpCurveAt(PUMP, { stages: 145, freqHz: 30 });
  close(at30[0].headFt, 2320); // H21 = (30/60)^2*9280
  close(at30[1].rateBpd, 250); // I22 = 500*(30/60)
});

test('theoretical head + dP pinned (ESP!AK23, B4)', () => {
  const curve = pumpCurveAt(PUMP, OPTS);
  const head = headAtRateFt(curve, 3332.4373630216); // B10 Qgross @ pump
  close(head, 4303.97372559841, 1e-9); // AK23
  close(head * 0.307891727757973, 1325.15790659941, 1e-9); // B4 (grad = BJ39)
});

test('intake state pinned to the BHP 63-69 block', () => {
  // the workbook block at its converged intake (Pint 1397.59, station T)
  const s = espIntakeState(CFG, { pIntakePsi: 1397.59061968516, tIntakeF: 230, sepEffPct: 95 });
  // Rs/Bo/Bg at intake are Standing-metric at the station temperature — the
  // sheet used the march station T (~229 F near TD); at Tres the values pin
  // within a small band
  close(s.rs, 263.65928755432, 0.02); // AV65
  close(s.bo, 1.20509194767988, 0.01); // AU65
  close(s.bgBblScf, 0.00213260471943437, 0.03); // AX65
  close(s.qGrossPumpNoSepBpd, 5327.94119025296, 0.03); // BD65
  close(s.qGrossPumpBpd, 3332.4373630216, 0.03); // BD69
  close(s.freeGasPct, 12.3552316154176, 0.05); // BE65
  close(s.sepCutPct, 11.3675469229856, 0.06); // BE74
  close(s.gradPsiFt, 0.307891727757973, 0.03); // BJ39 (sep branch active)
  assert.equal(s.sepRequired, true); // BF65 (>10 %)
  // BOTH gradient branches from one call, sheet quirk preserved: the no-sep
  // row's gas MASS is the separated tubing gas (BI65 = S18 = 0.0765*gg*P10)
  close(s.gradSepPsiFt, 0.307891727757973, 0.03); // BL69
  close(s.gradNoSepPsiFt, 0.204440252648098, 0.01); // BL65 — tight: exact mass basis
  assert.ok(s.gradNoSepPsiFt < s.gradSepPsiFt); // gassier column is lighter
});

test('coupled dP solve converges near the workbook operating state', () => {
  const sol = espSolveDp(CFG, PUMP, OPTS);
  assert.ok(sol.converged, 'dP fixed point must converge');
  close(sol.dpPsi, 1325.15790659941, 0.06); // march drift band
  close(sol.tubingGasScfD, 872994.209827361, 0.08); // BHP!P10
  close(sol.march.intakePsi, 1397.59061968516, 0.06);
  close(sol.march.dischargePsi, 2722.74852628457, 0.06);
});

test('ESP operating point: traverses meet at the intake (PI 2.7, Pres const)', () => {
  const op = espOperatingPoint(CFG, IPR, PUMP, OPTS);
  assert.equal(op.status, 'ok');
  // the workbook demo ran at 2565 stb/d with a ~6 psi residual mismatch;
  // our converged match lands in the same neighbourhood
  close(op.qOilStbD, 2565, 0.08);
  assert.ok(Math.abs(op.pintTraversePsi - op.pintIprPsi) < 0.5, 'intake match must close');
  assert.ok(op.pdisPsi > op.pintTraversePsi);
  close(op.dpPsi, op.pdisPsi - op.pintTraversePsi, 1e-6);
  assert.equal(op.thrust.status, 'ok');
  assert.ok(op.state.sepRequired);
});

test('stage match (new pump, wear 0) recovers the installed stage count with the design proof', () => {
  const m = matchStages(CFG, IPR, PUMP, { freqHz: 50, sepEffPct: 95, testQOilStbD: 2565 });
  assert.ok(m.stages >= 120 && m.stages <= 175, `stages=${m.stages}`); // 145 +- march drift
  // design proof at the default 300 psi floor: the demo intake (~1390 psi)
  // clears it comfortably
  assert.equal(m.capped, false);
  assert.equal(m.designOk, true);
  assert.ok(m.intakePsi > 300, `intake=${m.intakePsi}`);
});

test('design floor caps the stage count when the match would starve the intake', () => {
  // an artificially high floor forces the cap branch
  const m = matchStages(CFG, IPR, PUMP, {
    freqHz: 50, sepEffPct: 95, testQOilStbD: 2565, minIntakePsi: 1500,
  });
  assert.equal(m.capped, true);
  assert.ok(m.stages < m.stagesMatch, `capped ${m.stages} must undercut the match ${m.stagesMatch}`);
  // the capped design proves the floor: intake at/above 1500 psi
  assert.ok(m.intakePsi >= 1500 - 2, `intake=${m.intakePsi}`);
});

test('ESP API: final charts, and ESP sets solved through the MAIN sensitivity', async () => {
  const { oilEsp, oilSensitivity } = await import('../src/server/api.js');
  const F = {
    thpPsi: 160, qOilStbD: 2565, wcPct: 5, gorScfStb: 384, api: 32,
    gasSg: 0.812, rsiScfStb: 384, tresF: 230, oilViscCp: 6, waterSg: 1.05,
    tubingIdIn: 2.992, roughness: 0.00006, topPerfAhM: 3240, devStartM: 1500,
    devAngleDeg: 0, soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
    priPsi: 2650, prPsi: 2650, permMd: 54.816, thicknessFt: 42.653,
    reFt: 1640.5, rwFt: 0.5104166667, skin: 0, matchHead: 1, matchFriction: 1,
    liftType: 'esp', pumpTvdM: 2985, espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
    espStages: 145, espFreqHz: 50, espWearFactor: 0, espSepEffPct: 95,
  };
  const r = oilEsp(F);
  assert.ok(!r.error, r.error);
  assert.ok(r.iprCurve.length > 5 && r.vlpCurve.length > 5 && r.whpCurve.length > 5);
  assert.ok(r.op.designFloor.ok, 'demo intake clears the 300 psi floor');
  // The ESP-only Pres sensitivity was removed; the main VLP/IPR sensitivity
  // is the single place ESP cases are run. It solves each VLP set against the
  // CURRENT Pr with the coupled pump, and draws the future-pressure IPRs.
  const s = oilSensitivity({
    ...F,
    presList: [2400, 2100],
    vlpSets: [
      { label: 'VLP1', freqHz: '50' },
      { label: 'VLP2', freqHz: '55' },
    ],
  });
  assert.ok(!s.error, s.error);
  // current-Pr reference curve leads, then the two future pressures
  assert.equal(s.iprFamily[0].isCurrent, true);
  assert.equal(s.iprFamily.length, 3);
  for (const m of s.iprFamily) assert.ok(m.j > 0 && m.curve.length > 5);
  // every ESP set solves, with real pump state at its node
  assert.equal(s.vlpFamily.length, 2);
  for (const m of s.vlpFamily) {
    assert.ok(m.op, `${m.label}: ${m.opStatus}`);
    assert.ok(m.op.qOilStbD > 0 && m.op.pwfPsi > 0);
    assert.ok(m.esp.dpPsi > 0 && m.esp.dischargePsi > m.esp.intakePsi);
    assert.ok(m.esp.point && m.esp.point.stages > 0);
  }
  // a higher frequency lifts more: affinity head goes as (f/f0)^2
  assert.ok(s.vlpFamily[1].op.qOilStbD > s.vlpFamily[0].op.qOilStbD);
});

test('manual-dP ESP nodal returns the traverse with the dP step at pump depth', async () => {
  const { oilNodal } = await import('../src/server/api.js');
  const r = oilNodal({
    thpPsi: 160, qOilStbD: 2565, wcPct: 5, gorScfStb: 384, api: 32,
    gasSg: 0.812, rsiScfStb: 384, tresF: 230, oilViscCp: 6, waterSg: 1.05,
    tubingIdIn: 2.992, roughness: 0.00006, topPerfAhM: 3240, devStartM: 1500,
    devAngleDeg: 0, soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
    priPsi: 2650, prPsi: 2650, permMd: 54.816, thicknessFt: 42.653,
    reFt: 1640.5, rwFt: 0.5104166667, skin: 0, matchHead: 1, matchFriction: 1,
    liftType: 'esp', pumpTvdM: 2985, pumpDpPsi: 1325.158,
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.espTraverse, 'espTraverse expected in manual-dP mode');
  const t = r.espTraverse;
  // the input dP appears as a same-depth step in the station list
  const pumpFt = 2985 * 3.281;
  const atPump = t.stations.filter((s) => Math.abs(s.tvdFt - pumpFt) < 0.5);
  assert.equal(atPump.length, 2, 'discharge AND intake stations at pump depth');
  close(atPump[0].pPsi - atPump[1].pPsi, 1325.158, 1e-9);
  close(t.dischargePsi - t.intakePsi, 1325.158, 1e-9);
  assert.ok(t.backStations.length >= 3);
});

test('wear + PI match from the measured Pint/Pdis couple', () => {
  const m = matchWearAndPi(CFG, IPR, PUMP, {
    stages: 145, freqHz: 50, sepEffPct: 95,
    measPintPsi: 1392, measPdisPsi: 2720, qOilStbD: 2565,
  });
  // demo gauges sit on the new-pump curve: wear ~ 0, PI ~ 2.7
  assert.ok(Math.abs(m.wearFactor) < 0.08, `wear=${m.wearFactor}`);
  close(m.dpMeasPsi, 1328);
  close(m.jMatched, 2.7, 0.15);
});

// ---- Water Well: the pump intake must not invent an oil phase ----
// espIntakeState read cfg.qOilStbD directly, but on the Water Well tab that
// field carries the GROSS WATER rate — oil-march.js encodes exactly that for
// fluid:'water' (qo = 0, qw = cfg.qOilStbD). The water was therefore counted
// a SECOND time as oil, so the pump curve was read at ~2x the true rate:
// head 169 ft where it should have been 5608 ft, and a false up-thrust.
// Fixed 31 Aug 2026.
//
// The six water-ESP tests in sens-params.test.js did not catch it — one of
// them was PASSING BECAUSE OF IT, the doubled loading having pushed the stage
// match up into the search range. These pin the invariant directly instead.
const WATER_ESP_CFG = {
  fluid: 'water',
  api: 10,
  wcPct: 100,
  gorScfStb: 0,
  rsiScfStb: 0,
  pbPsi: 0,
  oilViscCp: 0.5,
  waterSg: 1.05,
  gasSg: 0.842,
  qOilStbD: 2278.768252127327, // the GROSS WATER rate on this tab
  tresF: 201,
  tubingIdIn: 2.992,
};

test('water well: the pump sees water ONLY — no phantom oil phase', () => {
  const s = espIntakeState(WATER_ESP_CFG, { pIntakePsi: 1500, tIntakeF: 180, sepEffPct: 0 });
  assert.equal(s.voBbl, 0, 'a water well has no oil phase at the pump');
  assert.equal(s.freeGasBbl, 0, 'and no free gas');
  assert.equal(s.totalGasBbl, 0, 'and no solution gas');

  // the whole pump throughput is the water and only the water; the sheet's
  // BC65 x1.01 volume factor is the only thing between the rate and the volume
  const flow = deriveOilFlow(WATER_ESP_CFG);
  close(s.vwBbl, flow.qw * 1.01, 1e-12);
  close(s.qGrossPumpBpd, s.vwBbl, 1e-12);

  // the doubling this guards against was 2.05x — anything near that is it back
  assert.ok(
    s.qGrossPumpBpd < flow.qw * 1.2,
    `pump throughput ${s.qGrossPumpBpd} is far above the water rate ${flow.qw}`
  );
});

test('water well: the intake gradient is a water gradient', () => {
  const s = espIntakeState(WATER_ESP_CFG, { pIntakePsi: 1500, tIntakeF: 180, sepEffPct: 0 });
  // pure water at SG 1.05 carrying the x1.01 volume factor:
  //   (1.05 * 62.4) / 1.01 / 62.42 * 0.433 = 0.4500 psi/ft
  // the phantom oil phase used to drag this down to 0.4302
  assert.ok(
    Math.abs(s.gradPsiFt - 0.45) < 5e-3,
    `water gradient ${s.gradPsiFt} should sit at ~0.45 psi/ft, not the 0.43 the phantom oil produced`
  );
});

// ---- an unmatchable stage count must say WHY ----
// The message used to be "no stage count in [...] closes the traverse match —
// check PI/Pres and the test rate", which sends the engineer off to adjust two
// inputs that cannot possibly help: the real cause is a duty point past the
// RIGHT-HAND END of the pump curve, where headAtRateFt floors head at zero and
// the pump develops nothing at ANY stage count. Named properly 31 Aug 2026.
//
// Checked against the shipped UI defaults too (WC 50, 2100 stb/d, the demo
// pump): 5156 bbl/d against a 4750 bbl/d curve. Each remedy the message offers
// resolves that case — WG 5200 matches at 276 stages, 60 Hz at 235, 1800 stb/d
// at 370 — so the advice it gives is advice that works.
test('stage match names an off-curve duty point instead of blaming PI/Pres', () => {
  // WD 150 tops out at 308 bbl/d at 50 Hz; this well puts 3333 through the pump
  const tooSmall = pumpByName('WD 150');
  assert.throws(
    () => matchStages(CFG, IPR, tooSmall, { freqHz: 50, sepEffPct: 95, testQOilStbD: 2565 }),
    (e) => {
      assert.match(e.message, /cannot pass this rate/, 'must state the pump cannot pass it');
      assert.match(e.message, /WD 150/, 'must name the pump');
      assert.ok(e.message.includes('308 bbl/d end of its curve'), 'must quote the curve limit');
      assert.ok(e.message.includes('3333 bbl/d through the pump'), 'must quote the duty rate');
      assert.match(e.message, /50 Hz/, 'must say which frequency the limit applies at');
      assert.ok(
        !e.message.includes('check PI/Pres'),
        'must NOT blame PI/Pres, which cannot fix an off-curve duty point'
      );
      return true;
    }
  );
});

test('the off-curve check stays silent when the pump can pass the rate', () => {
  // guard the other direction: a pump with the range still matches normally,
  // so the new diagnostic cannot swallow a legitimate result
  const big = pumpByName('WG 5200');
  const m = matchStages(CFG, IPR, big, { freqHz: 50, sepEffPct: 95, testQOilStbD: 2100 });
  assert.ok(m.stages > 0, `WG 5200 should match, got ${JSON.stringify(m)}`);
  assert.equal(m.designOk, true);
});

// The workbook gained a fourth vendor group (Novomet) after the original
// 68-pump extract, and the app never picked it up -- found on 2 Sep 2026 by
// reading ESP_DataBase back and diffing it against this catalog, which
// reproduced the other 68 pumps with zero numeric mismatches. The rates are
// the workbook's own m3/day -> BPD conversion (943.4716 BPD = 150 m3/d), kept
// unrounded so this file stays a verbatim copy of the sheet.
test('the Novomet 50 Hz pump from the workbook is in the catalog', () => {
  const p = ESP_PUMPS.find((x) => x.name === 'NB(630-1000)H');
  assert.ok(p, 'NB(630-1000)H must be present');
  assert.equal(p.refFreqHz, 50);
  assert.equal(p.points.length, 11);
  assert.deepEqual(p.points[0], { headFt: 13.1, rateBpd: 0 });
  assert.equal(p.points[10].headFt, 0);
  close(p.points[10].rateBpd, 943.4716155648157);
  // thrust markers must land on a sane, increasing window
  const [down, bep, up] = [p.points[3].rateBpd, p.points[5].rateBpd, p.points[7].rateBpd];
  assert.ok(down < bep && bep < up, `window ${down} < ${bep} < ${up}`);
  // and head must fall across that window, or it is not a pump curve
  assert.ok(p.points[3].headFt > p.points[7].headFt);
});

// ---- the Borets 2015 catalogue, recovered from vendor curves ----
// Kept in its own module rather than merged into ESP_PUMPS: those are verbatim
// workbook transcriptions, these carry ~3% spread on head from being read off
// a printed curve. The separation is the point, so it is asserted.
test('Borets 2015 catalogue is separate, well-formed and reachable', async () => {
  const { BORETS_2015_PUMPS } = await import('../src/core/vlp/esp-catalog-borets-2015.js');
  const { espPumps } = await import('../src/server/api.js');

  assert.ok(BORETS_2015_PUMPS.length >= 10, `expected a real catalogue, got ${BORETS_2015_PUMPS.length}`);
  for (const p of BORETS_2015_PUMPS) {
    assert.equal(p.points.length, 11, `${p.name} must have 11 points like every other pump`);
    assert.equal(p.refFreqHz, 60);
    assert.equal(p.points[0].rateBpd, 0, `${p.name} must start at zero flow`);
    assert.equal(p.points[10].headFt, 0, `${p.name} must end at zero head`);
    for (let i = 1; i < 11; i++) {
      assert.ok(
        p.points[i].rateBpd > p.points[i - 1].rateBpd,
        `${p.name} rates must increase (point ${i})`
      );
    }
    // the thrust window the physics reads must be ordered and the head must
    // fall across it, or it is not a usable pump curve
    const [down, bep, up] = [p.points[3], p.points[5], p.points[7]];
    assert.ok(down.rateBpd < bep.rateBpd && bep.rateBpd < up.rateBpd, `${p.name} thrust window disordered`);
    assert.ok(down.headFt > up.headFt, `${p.name} head must fall across its window`);
  }

  // none of these may collide with a workbook pump
  const names = new Set(ESP_PUMPS.map((x) => x.name));
  for (const p of BORETS_2015_PUMPS) {
    assert.ok(!names.has(p.name), `${p.name} duplicates a workbook pump`);
  }

  // and the API must offer both, tagged by source, so the UI can group them
  const r = espPumps();
  assert.ok(Array.isArray(r.bySource), 'espPumps must report bySource');
  const sources = r.bySource.map((s) => s.source);
  // catalogues stay ordered workbook-first; each added vendor appends
  assert.equal(sources[0], 'workbook');
  assert.ok(sources.includes('borets-2015'), 'Borets catalogue must be offered');
  assert.ok(sources.includes('slb-reda-2020'), 'SLB catalogue must be offered');
  const total = r.bySource.reduce((a, g) => a + g.pumps.length, 0);
  assert.equal(r.pumps.length, total, 'the flat list must be exactly the catalogues concatenated');
  assert.equal(new Set(r.pumps).size, r.pumps.length, 'no duplicate pump names across catalogues');
});

test('a Borets 2015 pump can actually be selected and solved', async () => {
  const { oilEsp } = await import('../src/server/api.js');
  const { BORETS_2015_PUMPS } = await import('../src/core/vlp/esp-catalog-borets-2015.js');
  // The demo well with a pump reachable ONLY through the new catalogue: if the
  // lookup did not span both, this would come back "not in the database".
  const F = {
    qOilStbD: 1500, wcPct: 50, gorScfStb: 384, thpPsi: 200, api: 30,
    gasSg: 0.812, rsiScfStb: 384, tresF: 230, oilViscCp: 6, waterSg: 1.05,
    tubingIdIn: 2.992, roughness: 0.00006, topPerfAhM: 3240, devStartM: 1500,
    devAngleDeg: 0, soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51,
    priPsi: 2650, prPsi: 2650, permMd: 54.816, thicknessFt: 42.653,
    reFt: 1640.5, rwFt: 0.5104166667, skin: 0, matchHead: 1, matchFriction: 1,
    liftType: 'esp', pumpTvdM: 2985, espPumpMode: 'db',
    espPumpName: BORETS_2015_PUMPS[0].name,
    espStages: 145, espFreqHz: 50, espWearFactor: 0, espSepEffPct: 95,
  };
  const r = oilEsp(F);
  assert.ok(!r.error, `selecting a Borets 2015 pump failed: ${r.error}`);
  assert.ok(r.op && r.op.qOilStbD > 0, 'the well must actually flow on it');
});

// The SLB REDA 2020 catalogue. Unlike Borets, these pumps share no model with
// the workbook, so they were checked against the catalogue's OWN printed
// "Optimum operating range": the recovered efficiency peak had to fall inside
// it. Structure is asserted here because the builder's guards are the only
// thing standing between a mis-read chart and a pump curve that looks fine.
test('SLB REDA 2020 catalogue is well-formed and physically sane', async () => {
  const { SLB_REDA_2020_PUMPS } = await import('../src/core/vlp/esp-catalog-slb-2020.js');
  assert.ok(SLB_REDA_2020_PUMPS.length >= 15, `expected a real catalogue, got ${SLB_REDA_2020_PUMPS.length}`);

  for (const p of SLB_REDA_2020_PUMPS) {
    assert.match(p.name, /^REDA /, `${p.name} must carry its vendor prefix`);
    assert.equal(p.points.length, 11);
    assert.equal(p.refFreqHz, 60);
    assert.equal(p.points[0].rateBpd, 0);

    // shut-in head must be REAL. An earlier build substituted 0 whenever the
    // plotted curve did not reach zero flow, which produced pumps whose head
    // rose from nothing -- structurally valid, physically meaningless.
    assert.ok(p.points[0].headFt > 0, `${p.name} has no shut-in head`);

    for (let i = 1; i < 11; i++) {
      assert.ok(p.points[i].rateBpd > p.points[i - 1].rateBpd, `${p.name} rates must increase at ${i}`);
    }
    const [down, bep, up] = [p.points[3], p.points[5], p.points[7]];
    assert.ok(down.rateBpd < bep.rateBpd && bep.rateBpd < up.rateBpd, `${p.name} thrust window disordered`);
    assert.ok(down.headFt > up.headFt, `${p.name} head must fall across its window`);

    // a centrifugal stage makes its BEP head well below shut-in but not near
    // zero; outside this band the head axis was mis-identified
    const ratio = bep.headFt / p.points[0].headFt;
    assert.ok(ratio > 0.4 && ratio < 0.95, `${p.name} BEP head is ${(ratio * 100).toFixed(0)}% of shut-in`);
  }

  // no name may collide with another catalogue
  const { BORETS_2015_PUMPS } = await import('../src/core/vlp/esp-catalog-borets-2015.js');
  const others = new Set([...ESP_PUMPS, ...BORETS_2015_PUMPS].map((p) => p.name));
  for (const p of SLB_REDA_2020_PUMPS) assert.ok(!others.has(p.name), `${p.name} collides with another catalogue`);
});

// The Novomet catalogue. Its charts draw every axis twice (bpd and m3/day, ft
// and m, hp and kW), so it needed unit-aware axis pairing rather than the
// shared extractor's magnitude rule; and every pump is drawn at both 60 and
// 50 Hz with neither page saying which, separated by the exact 1.2 ratio
// between their printed ranges. Structure is asserted because those two facts
// are exactly what a silent mis-read would corrupt.
test('Novomet catalogue is well-formed, 60 Hz, and physically sane', async () => {
  const { NOVOMET_PUMPS } = await import('../src/core/vlp/esp-catalog-novomet.js');
  assert.ok(NOVOMET_PUMPS.length >= 12, `expected a real catalogue, got ${NOVOMET_PUMPS.length}`);

  for (const p of NOVOMET_PUMPS) {
    // the design suffix must be present: the same model ships in several
    // designs with DIFFERENT ranges, so a bare model name would collide
    assert.match(p.name, /^NOV \S+ (FL|C|SEMI|CP)$/, `${p.name} needs a vendor prefix and design suffix`);
    assert.equal(p.refFreqHz, 60, `${p.name} must be the 60 Hz page`);
    assert.equal(p.points.length, 11);
    assert.equal(p.points[0].rateBpd, 0);
    assert.ok(p.points[0].headFt > 0, `${p.name} has no shut-in head`);
    for (let i = 1; i < 11; i++) {
      assert.ok(p.points[i].rateBpd > p.points[i - 1].rateBpd, `${p.name} rates must increase at ${i}`);
    }
    const [down, bep, up] = [p.points[3], p.points[5], p.points[7]];
    assert.ok(down.rateBpd < bep.rateBpd && bep.rateBpd < up.rateBpd, `${p.name} thrust window disordered`);
    assert.ok(down.headFt > up.headFt, `${p.name} head must fall across its window`);
    const ratio = bep.headFt / p.points[0].headFt;
    assert.ok(ratio > 0.4 && ratio < 0.95, `${p.name} BEP head is ${(ratio * 100).toFixed(0)}% of shut-in`);
  }

  // no collision with any other catalogue
  const { BORETS_2015_PUMPS } = await import('../src/core/vlp/esp-catalog-borets-2015.js');
  const { SLB_REDA_2020_PUMPS } = await import('../src/core/vlp/esp-catalog-slb-2020.js');
  const others = new Set([...ESP_PUMPS, ...BORETS_2015_PUMPS, ...SLB_REDA_2020_PUMPS].map((p) => p.name));
  for (const p of NOVOMET_PUMPS) assert.ok(!others.has(p.name), `${p.name} collides with another catalogue`);

  // and the API offers it as its own source
  const { espPumps } = await import('../src/server/api.js');
  const r = espPumps();
  assert.ok(r.bySource.some((s) => s.source === 'novomet'), 'Novomet must be offered as a catalogue');
  assert.equal(r.pumps.length, r.bySource.reduce((a, g) => a + g.pumps.length, 0));
});

// ---- an ESP failure must name the thing that is actually wrong ----
// The solve reported BOTH of its failure modes with one message, and when
// the IPR was degenerate every number in it was NaN:
//   "no traverse match found (closest residual NaN psi at NaN stb/d) —
//    check PI/Pres, stages or frequency"
// A NaN open-flow potential makes the whole rate grid NaN, so the "closest"
// residual was picked out of an all-NaN array -- and the advice pointed at
// the pump when the well simply had no IPR yet. Found 3 Sep 2026 while
// sweeping the pump catalogue: it cost real time chasing pumps.
const ESP_WELL = {
  thpPsi: '160', wcPct: '5', gorScfStb: '384', tubingIdIn: '2.992', roughness: '0.00006',
  topPerfAhM: '3240', devStartM: '1500', devAngleDeg: '0', api: '32', gasSg: '0.812',
  rsiScfStb: '384', tresF: '230', oilViscCp: '6', waterSg: '1.05', pbPsi: '',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51', priPsi: '3550',
  iprMode: 'pi', userPresPsi: '2650', userJ: '2.7', matchHead: '1', matchFriction: '1',
  liftType: 'esp', espPumpMode: 'db', espStages: '145', espFreqHz: '50',
  pumpAhM: '2985', espSepEffPct: '95', testThpPsi: '160', testPwfPsi: '',
};
const GEOM = { prPsi: '2650', permMd: '50', thicknessFt: '42.653', reFt: '1640.5', rwFt: '0.5104166667', skin: '0' };

test('a degenerate IPR is reported as such, not as a NaN pump mismatch', () => {
  const r = api.oilEsp({ ...ESP_WELL, espPumpName: 'WD 150', qOilStbD: '150', testQOilStbD: '150' });
  assert.ok(r.error, 'this case must fail');
  assert.doesNotMatch(r.error, /NaN/, 'no NaN may reach the user');
  assert.match(r.error, /IPR could not be evaluated/);
  // and it must NOT blame the pump, which is not the problem here
  assert.match(r.error, /not the problem here/);
});

test('a real traverse mismatch still reports its residual, with finite numbers', () => {
  const r = api.oilEsp({ ...ESP_WELL, ...GEOM, espPumpName: 'WD 150', qOilStbD: '150', testQOilStbD: '150' });
  assert.ok(r.error);
  assert.doesNotMatch(r.error, /NaN/);
  // pull the two numbers out without a regex: the point is that they are
  // finite, and an escaped pattern here is just another thing to get wrong
  const after = r.error.split('residual ')[1] ?? '';
  const resid = Number.parseFloat(after);
  const rate = Number.parseFloat(after.split(' at ')[1] ?? '');
  assert.ok(Number.isFinite(resid), 'residual must be finite: ' + r.error);
  assert.ok(Number.isFinite(rate), 'rate must be finite: ' + r.error);
});

test('a pump that suits the well is unaffected by the message change', () => {
  const r = api.oilEsp({ ...ESP_WELL, ...GEOM, espPumpName: 'ESP B 538-3600', qOilStbD: '2565', testQOilStbD: '2565' });
  assert.equal(r.error, undefined);
  assert.ok(r.op.qOilStbD > 2000);
  assert.equal(r.point.thrust, 'ok');
});
