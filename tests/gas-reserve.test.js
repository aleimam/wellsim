// Gas reserve & forecast tests — synthetic round-trips against a known tank
// plus a workbook sanity pin for the SITHP static column.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zAtRes,
  gasPresSolver,
  giipFromPz,
  staticPresFromSithp,
  presFromPz,
  gasForecast,
} from '../src/core/reserve/gas-reserve.js';
import { createGasIpr } from '../src/core/ipr/gas-ipr.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

const GASCFG = {
  thpPsi: 1625, qGasMMscfd: 14.137, cgrStbMMscf: 57.4358974358974,
  wgrStbMMscf: 3.84615384615385, condApi: 48.7, gasSg: 0.763,
  n2: 0.012, co2: 0.03, h2s: 2e-6, tresF: 232, soilTempF: 90, htcBtu: 3,
  cpBtu: 0.51, tubingIdIn: 2.992, tubingOdIn: 3.5, perfTvdM: 2817.7433730104,
  devStartM: 690, devAngleDeg: 23.65, roughnessBase: 0.0021, sigmaDyneCm: 30,
  oilViscCp: 2, waterSg: 1.05, matchHead: 1, matchFriction: 1,
};
const J = 1.74848658948593e-3;
const IPR = createGasIpr({ jTest: J, priPsi: 3800 });

test('synthetic tank round-trip: Pres solver + p/Z fit recover the true GIIP', () => {
  const G = 90; // Bscf truth
  const zi = zAtRes(GASCFG, 3800);
  const pzi = 3800 / zi;
  const q = 10;
  const days = [0, 100, 200, 300]; // constant rate -> Gp = 0,1,2,3 Bscf
  const rows = days.map((d) => {
    const gp = (q * d) / 1000;
    const pz = pzi * (1 - gp / G);
    const pres = presFromPz(GASCFG, pz);
    const pwf = Math.sqrt(pres ** 2 - (1000 * q) / J);
    return { date: d, qMMscfd: q, pwfPsi: pwf, _pres: pres, _pz: pz };
  });
  const solved = gasPresSolver(GASCFG, IPR, rows);
  solved.forEach((s, i) => {
    assert.equal(s.pwfSource, 'input');
    close(s.presPsi, rows[i]._pres, 1e-7); // closed-form Pr round trip
    close(s.pOverZ, rows[i]._pz, 1e-6);
    close(s.gpBscf, (q * days[i]) / 1000, 1e-9); // trapezoid cumulative
  });
  const fit = giipFromPz(solved);
  close(fit.giipBscf, G, 1e-4); // exact line -> exact GIIP
  close(fit.pziPsi, pzi, 1e-5);
});

test('sporadic dd/mm/yyyy hh:mm:ss dates parse to fractional days; dt and dp calculated', async () => {
  const { toDays } = await import('../src/core/reserve/gas-reserve.js');
  // dd/mm/yyyy with time — 12 h apart = 0.5 day
  const a = toDays('05/03/2014 00:00:00');
  const b = toDays('05/03/2014 12:00:00');
  close(b - a, 0.5);
  close(toDays('06/03/2014') - a, 1);
  close(toDays('05-03-2014 06:00'), a + 0.25);
  close(toDays(41960.5416657407), 41960.5416657407); // Excel-style serial passes through
  // d-MMM-yy — the workbook's date format (17-Nov-14 ...)
  close(toDays('26-Nov-14') - toDays('17-Nov-14'), 9);
  close(toDays('3-Dec-14') - toDays('17-Nov-14'), 16);
  close(toDays('17-Nov-14 13:00:00') - toDays('17-Nov-14'), 13 / 24);
  close(toDays('17-Nov-2014') - toDays('17-Nov-14'), 0);
  assert.ok(Number.isNaN(toDays('35-Nov-14')));
  assert.ok(Number.isNaN(toDays('17-Xyz-14')));

  const rows = [
    { date: '05/03/2014 13:00:00', qMMscfd: 14.137, thpPsi: 1625 },
    { date: '05/03/2014 19:00:00', qMMscfd: 14.137, thpPsi: 1625 },
    { date: '07/03/2014 01:00:00', qMMscfd: 12, thpPsi: 1500 },
  ];
  const solved = gasPresSolver(GASCFG, IPR, rows);
  close(solved[0].dtDays, 0);
  close(solved[1].dtDays, 0.25); // 6 h
  close(solved[2].dtDays, 1.5); // 36 h
  close(solved[1].gpBscf, (0.25 * 14.137) / 1000, 1e-9); // fractional-day trapezoid
  for (const s of solved) close(s.dpPsi, s.presPsi - s.pwfPsi); // calculated drawdown
});

test('Pres solver marches when Pwf is not given (get_Pwf per row)', () => {
  const rows = [
    { date: 0, qMMscfd: 14.137, thpPsi: 1625 },
    { date: 60, qMMscfd: 12, thpPsi: 1500 },
  ];
  const solved = gasPresSolver(GASCFG, IPR, rows);
  for (const s of solved) {
    assert.equal(s.pwfSource, 'calculated');
    assert.ok(Number.isFinite(s.pwfPsi) && s.pwfPsi > 1500);
    assert.ok(s.presPsi > s.pwfPsi);
    assert.ok(s.z > 0.6 && s.z < 1.4);
  }
});

test('SITHP static column lands near the workbook value (pasted 7661.9)', () => {
  // gas reserve workbook well: 5041 mTVD, gg=0.71, CO2 8%, N2 1.8%,
  // H2S 18 ppm, Tres 315 F, SITHT 120 F, SITHP 5545 -> Pres 7661.93 (pasted)
  const r = staticPresFromSithp({
    sithpPsi: 5545,
    surfTempF: 120,
    cfg: { perfTvdM: 5041, tresF: 315, gasSg: 0.71, n2: 0.018, co2: 0.08, h2s: 18e-6 },
  });
  const rel = Math.abs(r.presPsi - 7661.93317505748) / 7661.93317505748;
  console.log(`    SITHP static: js=${r.presPsi.toFixed(1)} workbook=7661.9 rel=${(rel * 100).toFixed(2)}% (zAvg=${r.zAvg.toFixed(4)})`);
  assert.ok(rel < 0.035, `Pres ${r.presPsi} vs 7661.93 (rel ${rel})`);
  assert.ok(r.gradientPsiFt > 0.09 && r.gradientPsiFt < 0.16);
});

test('reservoir limit (workbook method): slope, Ct, GIIP chain', async () => {
  const { reservoirLimitWorkbook } = await import('../src/core/reserve/gas-reserve.js');
  // synthetic pss decline: Pwf falls 2 psi/day at constant 10 MMscf/d
  const rows = [0, 10, 20, 30, 40].map((d) => ({
    dtDays: d,
    pwfPsi: 3000 - 2 * d,
    presPsi: 3400 - 2 * d,
    z: zAtRes(GASCFG, 3400 - 2 * d),
    qMMscfd: 10,
  }));
  // exact chain with a known Cg override (workbook Ct formula)
  const r = reservoirLimitWorkbook(GASCFG, rows, { sg: 0.85, so: 0, sw: 0.15, cgOverride: 2e-4 });
  close(r.slopePsiDay, 2);
  const ct = 0.85 * 2e-4 + 0.15 * 1e-6 + 3e-6;
  close(r.ct, ct);
  close(r.giipBscf, 10 / (ct * 2) / 1000);
  close(r.qAvgMMscfd, 10);
  // calculated-Cg path: real-gas cg should sit near 1/p
  const r2 = reservoirLimitWorkbook(GASCFG, rows, {});
  assert.ok(Math.abs(r2.cg - 1 / 3350) / (1 / 3350) < 0.4, `cg=${r2.cg}`);
  assert.ok(r2.giipBscf > 0);
});

test('SITHP route recovers a known tank via the static gas march (no IPR)', async () => {
  const { sithpReserve, staticGasMarch } = await import('../src/core/reserve/gas-reserve.js');
  const { brent } = await import('../src/core/solvers/brent.js');
  const G = 90;
  const zi = zAtRes(GASCFG, 3800);
  const pzi = 3800 / zi;
  const q = 10;
  // surveys at days 0/150/300; truth Pres from the tank; SITHP found by
  // inverting the STATIC MARCH so the round trip is exact
  const days = [0, 150, 300];
  const sithpRows = days.map((d) => {
    const pz = pzi * (1 - (q * d) / 1000 / G);
    const presTrue = presFromPz(GASCFG, pz);
    const sithp = brent(
      (s) => staticGasMarch(GASCFG, { sithpPsi: s, surfTempF: 90 }).presPsi - presTrue,
      presTrue * 0.5,
      presTrue,
      { tol: 1e-8 }
    ).root;
    return { date: d, sithpPsi: sithp, qMMscfd: 0, cgrStbMMscf: 40, wgrStbMMscf: 2.1 };
  });
  const prodRows = days.map((d) => ({ date: d, qMMscfd: q }));
  const r = sithpReserve(GASCFG, sithpRows, prodRows);
  close(r.fit.giipBscf, G, 1e-3);
  assert.equal(r.points.length, 3);
  close(r.points[1].gpBscf, 1.5, 1e-9); // Gp integration from rates only
});

test('static gas march agrees with the zero-rate correlation and the workbook', async () => {
  const { staticGasMarch } = await import('../src/core/reserve/gas-reserve.js');
  const cfg = { perfTvdM: 5041, tresF: 315, gasSg: 0.71, n2: 0.018, co2: 0.08, h2s: 18e-6 };
  const march = staticGasMarch(cfg, { sithpPsi: 5545, surfTempF: 120 });
  const cs = staticPresFromSithp({ sithpPsi: 5545, surfTempF: 120, cfg });
  // multi-station march vs single-step average-T&Z: within 1%
  assert.ok(Math.abs(march.presPsi - cs.presPsi) / cs.presPsi < 0.01, `${march.presPsi} vs ${cs.presPsi}`);
  const rel = Math.abs(march.presPsi - 7661.93317505748) / 7661.93317505748;
  console.log(`    static march: ${march.presPsi.toFixed(1)} psi (CS ${cs.presPsi.toFixed(1)}, workbook 7661.9, rel ${(rel * 100).toFixed(2)}%)`);
  assert.ok(rel < 0.035);
  assert.equal(march.stations.length, 30);
});

test('forecast start state: first step anchors on the given Pres/Gp/day (workbook AH8/AH11/AH7)', () => {
  const zi = zAtRes(GASCFG, 3800);
  const f = gasForecast({
    marchCfg: GASCFG,
    ipr: IPR,
    giipBscf: 90,
    pziPsi: 3800 / zi,
    startGpBscf: 5,
    startDay: 16400,
    startPresPsi: 3456,
    stepDays: 30,
    fthpPsi: 1200,
    plateauMMscfd: 12,
    minRateMMscfd: 1,
    maxSteps: 5,
  });
  close(f.rows[0].presPsi, 3456); // anchored, not from the p/Z line
  close(f.rows[0].gpBscf, 5);
  close(f.rows[0].tDays, 16400);
  close(f.rows[1].tDays, 16430);
  // from step 2 on, Pres comes off the p/Z line at the accumulated Gp
  const pz1 = (3800 / zi) * (1 - f.rows[1].gpBscf / 90);
  close(f.rows[1].pOverZ, pz1, 1e-5);
});

test('coupled p/Z + nodal forecast: plateau, decline, sane termination', () => {
  const zi = zAtRes(GASCFG, 3800);
  const f = gasForecast({
    marchCfg: GASCFG,
    ipr: IPR,
    giipBscf: 90,
    pziPsi: 3800 / zi,
    stepDays: 30,
    fthpPsi: 1200,
    plateauMMscfd: 12,
    minRateMMscfd: 1,
    maxSteps: 40,
  });
  assert.ok(f.rows.length > 5, `rows=${f.rows.length}`);
  assert.ok(f.rows[0].onPlateau, 'expected plateau at start');
  for (const r of f.rows) assert.ok(r.qMMscfd <= 12 + 1e-9);
  for (let i = 1; i < f.rows.length; i++) {
    assert.ok(f.rows[i].presPsi < f.rows[i - 1].presPsi, 'Pr must decline');
  }
  const offPlateau = f.rows.filter((r) => !r.onPlateau);
  assert.ok(offPlateau.length > 0, 'expected decline after plateau');
  assert.ok(f.eurBscf < 90 && f.eurBscf > 5);
  assert.ok(['max-steps', 'abandoned', 'died', 'depleted'].includes(f.status));
  console.log(
    `    forecast: ${f.rows.length} steps, plateau ${f.rows.filter((r) => r.onPlateau).length} steps, EUR ${f.eurBscf.toFixed(1)} Bscf (${f.recoveryPct.toFixed(1)}%), status ${f.status}`
  );
});

test('gauge route recovers a known tank from measured Pr (no march, no IPR)', async () => {
  const { gaugeReserve, sithpReserve, staticGasMarch } = await import('../src/core/reserve/gas-reserve.js');
  const { brent } = await import('../src/core/solvers/brent.js');
  const G = 90;
  const pzi = 3800 / zAtRes(GASCFG, 3800);
  const q = 10;
  const days = [0, 150, 300];
  const truth = days.map((d) => presFromPz(GASCFG, pzi * (1 - (q * d) / 1000 / G)));
  const prodRows = days.map((d) => ({ date: d, qMMscfd: q }));
  const r = gaugeReserve(GASCFG, days.map((d, i) => ({ date: d, presPsi: truth[i] })), prodRows);
  close(r.fit.giipBscf, G, 1e-9); // exact: the tank is the input
  close(r.fit.pziPsi, pzi, 1e-9);
  assert.equal(r.points.length, 3);
  close(r.points[1].gpBscf, 1.5, 1e-9); // Gp from the rate records alone
  close(r.points[1].pOverZ, r.points[1].presPsi / r.points[1].z, 1e-12);
  close(r.points[1].dtDays, 150, 1e-12);

  // route 2 and route 4 must agree when the gauge reads what the static
  // march computes from the SITHP — the cross-check the demo defaults show
  const sithpRows = truth.map((presTrue, i) => ({
    date: days[i],
    sithpPsi: brent((x) => staticGasMarch(GASCFG, { sithpPsi: x, surfTempF: 90 }).presPsi - presTrue,
      presTrue * 0.5, presTrue, { tol: 1e-8 }).root,
    qMMscfd: 0,
  }));
  const r2 = sithpReserve(GASCFG, sithpRows, prodRows);
  close(r2.fit.giipBscf, r.fit.giipBscf, 1e-3);
});

test('gauge route needs two surveys to see depletion', async () => {
  const { gaugeReserve } = await import('../src/core/reserve/gas-reserve.js');
  assert.throws(
    () => gaugeReserve(GASCFG, [{ date: 0, presPsi: 3800 }], [{ date: 0, qMMscfd: 10 }]),
    /at least 2 surveys/
  );
});

test('gauge datum correction: a gauge off datum is corrected through the gas column', async () => {
  const { gaugeToDatum, gaugeReserve } = await import('../src/core/reserve/gas-reserve.js');
  const cfg = { perfTvdM: 2810, tresF: 201, gasSg: 0.842, n2: 0, co2: 0, h2s: 0 };
  // at datum: no correction at all, so the previous behaviour is preserved
  const same = gaugeToDatum({ pPsi: 3266.3, dTvdFt: 0, cfg });
  close(same.presPsi, 3266.3, 1e-12);
  // above datum: pressure is ADDED, at a sane gas gradient
  const up = gaugeToDatum({ pPsi: 3266.3, dTvdFt: 100 * 3.281, cfg });
  assert.ok(up.presPsi > 3266.3, 'a gauge above datum reads low');
  assert.ok(
    up.gradientPsiFt > 0.05 && up.gradientPsiFt < 0.25,
    `gas gradient out of range: ${up.gradientPsiFt} psi/ft`
  );
  // below datum: symmetric, and the round trip returns the original
  const down = gaugeToDatum({ pPsi: up.presPsi, dTvdFt: -100 * 3.281, cfg });
  close(down.presPsi, 3266.3, 2e-3);
  // and it moves the fitted GIIP the right way
  const prod = [{ date: 0, qMMscfd: 18.56 }, { date: 1826, qMMscfd: 17 }, { date: 3662, qMMscfd: 11 }];
  const mk = (gaugeTvdM) => gaugeReserve(cfg,
    [{ date: 0, presPsi: 3266.3, gaugeTvdM }, { date: 1826, presPsi: 2607.1, gaugeTvdM },
     { date: 3662, presPsi: 1671, gaugeTvdM }], prod);
  const atDatum = mk(undefined), above = mk(2400);
  close(atDatum.points[0].corrPsi, 0, 1e-12);
  assert.ok(above.points[0].corrPsi > 100, 'a 410 m offset is worth more than 100 psi');
  assert.ok(above.fit.giipBscf > atDatum.fit.giipBscf, 'correcting up raises the fitted GIIP');
});
