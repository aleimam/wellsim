// The gas well model's defaults against "Gas Well model_temp V6.0.0.xls",
// extracted 31 Aug 2026. The VLP inputs already matched the workbook; the
// DARCY BLOCK did not — the app shipped placeholders (K 5 / H 80 / Re 1640.5
// / Rw 0.5104 / S 0) where the workbook says K 8.7 / H 45.934 / Re 2460.75 /
// Rw 0.2916667 / S 5 ('VLP-IPR'!B30:B34). Fixed the same day; these tests
// hold the workbook's numbers so the defaults cannot drift back.
//
// Two findings about the workbook worth keeping:
//  - Its "IPR from C & N" block (B15:B17, n = 1 exactly) is NOT a test fit:
//    D32:E35 sample the DARCY curve (J_2·(Pr²−P²)/1000), so C = J_2/1000 and
//    n = 1 by construction. The C&n-from-tests fit lives on 'Calc C&n'.
//  - The saved 'Calc C&n' fit (n = 1.00631) double-weights the last test:
//    the 4-row table's B25 duplicates B24 by formula. On the 3 UNIQUE tests
//    the sheet's own regression gives n = 0.98051 — which is what WellSim's
//    calibrate reproduces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/server/api.js';
import { gasMarch } from '../src/core/vlp/gas-march.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// the gas demo exactly as the UI ships it after the defaults fix
const GAS_WB = {
  thpPsi: '1625', cgrStbMMscf: '57.4358974359', wgrStbMMscf: '3.84615384615',
  tubingIdIn: '2.992', roughnessBase: '0.0021',
  topPerfAhM: '3013', devStartM: '690', devAngleDeg: '23.65',
  condApi: '48.7', gasSg: '0.763', n2Pct: '1.2', co2Pct: '3', h2sPpm: '2',
  tresF: '232', oilViscCp: '2', sigmaDyneCm: '30',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '3800', prPsi: '',
  permMd: '8.7', thicknessFt: '45.934', reFt: '2460.75', rwFt: '0.2916666667', skin: '5',
  matchHead: '1', matchFriction: '1', iprMode: 'j',
  testPoints: [
    { thpPsi: '2440', qMMscfd: '5.192', pwfPsi: '' },
    { thpPsi: '2000', qMMscfd: '10.002', pwfPsi: '' },
    { thpPsi: '1625', qMMscfd: '14.137', pwfPsi: '' },
  ],
};

// fixtures for the forecast wellhead tests below
const GAS_FORM = GAS_WB;
const GAS_PROD_ROWS = [
  { date: '17-Nov-14', thpPsi: '1625', qMMscfd: '18.56', cgrStbMMscf: '57', wgrStbMMscf: '3.8' },
  { date: '17-Nov-19', thpPsi: '1000', qMMscfd: '17', cgrStbMMscf: '40', wgrStbMMscf: '2.1' },
  { date: '26-Nov-24', thpPsi: '500', qMMscfd: '11', cgrStbMMscf: '20', wgrStbMMscf: '2.7' },
];
// the same well in core units, for marching directly
const GAS_MARCH_CFG = {
  thpPsi: 1625, qGasMMscfd: 14.137, cgrStbMMscf: 57.4358974359, wgrStbMMscf: 3.84615384615,
  tubingIdIn: 2.992, roughnessBase: 0.0021, perfTvdM: 2817.74337301, devStartM: 690,
  devAngleDeg: 23.65, topPerfAhM: 3013, condApi: 48.7, gasSg: 0.763,
  n2: 0.012, co2: 0.03, h2s: 0.000002, tresF: 232, oilViscCp: 2, sigmaDyneCm: 30,
  soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51, matchHead: 1, matchFriction: 1,
};

test('gas workbook: the Darcy J_2 reproduces to the cell (B38)', () => {
  const r = handlers['gas/nodal'](GAS_WB);
  assert.ok(!r.error, r.error);
  // 703e-6·K·h / (mu·Z·(T+460)·(ln(0.472·Re/Rw)+S)) with mu (B36) and Z (B37)
  // from the sour-PVT chain at Pr — matches the sheet to ~11 significant figures
  close(r.ipr.j, 0.00174848658949, 1e-9);
  assert.equal(r.ipr.jSource, 'darcy');
});

test('gas workbook: AOF equals the C&n block\'s Qmax (B15) exactly', () => {
  // B15 "fits" C&n to the Darcy curve itself, so its Qmax IS J_2·Pr²/1000
  const r = handlers['gas/nodal'](GAS_WB);
  close((r.ipr.j * 3800 ** 2) / 1000, 25.2481463522, 1e-9);
});

test('gas workbook: get_Pwf reproduces the macro-written test Pwf (C22:C24)', () => {
  const c = handlers['gas/calibrate'](GAS_WB);
  assert.ok(!c.error, c.error);
  const pts = c.points ?? c.fitPoints;
  assert.equal(pts.length, 3);
  // the gas march is bit-exact vs the workbook; these landed within 0.005 psi
  close(pts[0].pwfPsi, 3414.01525252, 1e-5);
  close(pts[1].pwfPsi, 2913.97067333, 1e-5);
  close(pts[2].pwfPsi, 2647.81711594, 1e-5);
});

test('gas workbook: the C&n fit is the sheet\'s own regression on the unique tests', () => {
  const c = handlers['gas/calibrate'](GAS_WB);
  assert.ok(!c.error, c.error);
  // the sheet's math, run on its own numbers WITHOUT the duplicated 4th row:
  // n = SLOPE(log Q, log(Pri² − Pwf²)) over the three unique tests
  const Q = [5.192, 10.002, 14.137];
  const P = [3414.01525252, 2913.97067333, 2647.81711594];
  const x = P.map((p) => Math.log10(3800 ** 2 - p ** 2));
  const y = Q.map((q) => Math.log10(q));
  const mx = x.reduce((a, b) => a + b) / 3;
  const my = y.reduce((a, b) => a + b) / 3;
  const slope =
    x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0) /
    x.reduce((s, xi) => s + (xi - mx) ** 2, 0);
  close(c.n, slope, 1e-3); // ~0.9805; the saved sheet's 1.00631 carries the dup-row quirk
  assert.ok(c.qMaxMMscfd > 24 && c.qMaxMMscfd < 27, `Qmax ${c.qMaxMMscfd}`);
});

test('gas workbook: the operating point sits on both of its own curves', () => {
  const r = handlers['gas/nodal'](GAS_WB);
  assert.ok(r.op && r.op.qMMscfd > 0, 'well flows');
  // IPR identity at the op: Pwf = sqrt(Pr² − 1000·q/J)
  const pwfIpr = Math.sqrt(3800 ** 2 - (1000 * r.op.qMMscfd) / r.ipr.j);
  close(r.op.pwfPsi, pwfIpr, 1e-3);
});

// ---- forecast wellhead state: FTHP / FTHT per step ----
// Off plateau the produced rate IS the nodal intersection at the forecast
// FTHP, so the wellhead pressure is that input. ON PLATEAU the well is choked:
// Pwf comes from the IPR at the constrained rate, so the real wellhead
// pressure is HIGHER than the input and is back-solved through the same
// downward march (Brent), never by a second upward march -- the march is an
// explicit Euler integration and an upward pass would not reproduce the Pwf
// printed beside it. Added 2 Sep 2026.
test('forecast reports the flowing wellhead state, back-solved when choked', () => {
  const base = {
    ...GAS_FORM,
    prodRows: GAS_PROD_ROWS,
    stepDays: '30', forecastFthpPsi: '300', minRateMMscfd: '1', maxSteps: '6',
    startDate: '', startGpBscf: '', startPresPsi: '', giipBscf: '', pziPsi: '',
  };

  // a plateau well below the natural rate forces the choked branch
  const choked = handlers['gas/forecast']({ ...base, plateauMMscfd: '6' });
  assert.ok(!choked.error, choked.error);
  const onPlateau = choked.rows.filter((p) => p.onPlateau);
  assert.ok(onPlateau.length > 0, 'this case must actually hit the plateau');
  for (const p of onPlateau) {
    assert.equal(p.fthpSource, 'solved');
    assert.ok(
      p.fthpPsi > 300,
      `choked back to ${p.qMMscfd} MMscf/d, so FTHP must EXCEED the 300 psi input, got ${p.fthpPsi}`
    );
    assert.ok(p.fthtF > 0 && p.fthtF < 300, `FTHT out of range: ${p.fthtF}`);
  }

  // THE PROPERTY THAT JUSTIFIES ROOT-FINDING over a separate upward march:
  // marching DOWN from the reported FTHP at the reported rate must land back
  // on the reported Pwf. An upward Euler pass would not close this loop.
  for (const p of onPlateau) {
    const m = gasMarch({ ...GAS_MARCH_CFG, thpPsi: p.fthpPsi, qGasMMscfd: p.qMMscfd });
    assert.ok(
      Math.abs(m.pwfPsi - p.pwfPsi) < 1e-3,
      `FTHP ${p.fthpPsi} should reproduce Pwf ${p.pwfPsi}, marched to ${m.pwfPsi}`
    );
  }

  // unconstrained: the wellhead pressure IS the input, no solving involved
  const free = handlers['gas/forecast']({ ...base, plateauMMscfd: '' });
  assert.ok(!free.error, free.error);
  for (const p of free.rows) {
    assert.equal(p.onPlateau, false);
    assert.equal(p.fthpSource, 'input');
    assert.equal(p.fthpPsi, 300);
  }
});

test('forecast FTHT tracks rate, not pressure', () => {
  // the march temperature is the geothermal shelf with Ramey relaxation: a
  // function of rate and depth, independent of pressure. Verified directly --
  // one rate at THP 1000/1625/2200/2800 gives an identical WHT -- which is why
  // FTHT needs no inversion even when FTHP does.
  const at = (thp) => gasMarch({ ...GAS_MARCH_CFG, thpPsi: thp, qGasMMscfd: 14.137 }).whtF;
  const t0 = at(1000);
  for (const thp of [1625, 2200, 2800]) {
    assert.ok(Math.abs(at(thp) - t0) < 1e-9, `WHT moved with pressure: ${at(thp)} vs ${t0}`);
  }
  // but it must move with rate
  const lo = gasMarch({ ...GAS_MARCH_CFG, qGasMMscfd: 5 }).whtF;
  const hi = gasMarch({ ...GAS_MARCH_CFG, qGasMMscfd: 18 }).whtF;
  assert.ok(hi > lo + 10, `WHT should rise with rate: ${lo} -> ${hi}`);
});

// The forecast chart draws the MEASURED wellhead pressure of each prod row
// into the forecast FTHP as one line, so the history payload has to carry
// thpPsi -- it is the only place the typed prod THP reaches the UI. Added
// 2 Sep 2026, when the chart dropped its FTHT axis (FTHT stays in the table).
test('forecast history carries the measured FTHP of every prod row', () => {
  const r = handlers['gas/forecast']({
    ...GAS_FORM,
    prodRows: GAS_PROD_ROWS,
    stepDays: '30', forecastFthpPsi: '300', minRateMMscfd: '1', maxSteps: '6',
    plateauMMscfd: '', startDate: '', startGpBscf: '', startPresPsi: '',
    giipBscf: '', pziPsi: '',
  });
  assert.ok(!r.error, r.error);
  assert.equal(r.history.length, GAS_PROD_ROWS.length);
  assert.deepEqual(
    r.history.map((p) => p.thpPsi),
    GAS_PROD_ROWS.map((p) => Number(p.thpPsi))
  );
  // and the rest of the chart's history series stay populated
  for (const p of r.history) {
    for (const k of ['tDays', 'qMMscfd', 'presPsi', 'gpBscf']) {
      assert.ok(Number.isFinite(p[k]), `history ${k} is ${p[k]}`);
    }
  }
});

// ---- forecast condensate: CGR input, rate, cumulative ----
// Added 3 Sep 2026. The forecast CGR is input-or-calculated: blank reads the
// LATEST CGR in the prod table. Condensate rate is q x CGR at every step and
// its cumulative CONTINUES from the history (trapezoid on q x CGR, like cumGp
// on gas) rather than restarting at zero -- the same convention Gp follows.
test('forecast condensate: CGR defaults to the latest prod row, rate = q x CGR, cum continues from history', () => {
  const base = {
    ...GAS_FORM,
    prodRows: GAS_PROD_ROWS, // CGR 57 / 40 / 20, latest by date = 20
    stepDays: '30', forecastFthpPsi: '300', minRateMMscfd: '1', maxSteps: '4', plateauMMscfd: '',
    startDate: '', startGpBscf: '', startPresPsi: '', giipBscf: '', pziPsi: '',
  };
  const r = handlers['gas/forecast'](base);
  assert.ok(!r.error, r.error);
  assert.equal(r.forecastCgrStbMMscf, 20, 'blank CGR must read the LATEST prod row, not the first or the well base');

  // rate = q x CGR on every row, in STB/d
  for (const p of r.rows) close(p.qCondStbD, p.qMMscfd * 20, 1e-12);

  // the history cumulative: trapezoid of q x CGR over the prod table, MMstb
  const days = GAS_PROD_ROWS.map((x) => Number(handlers['gas/reserve']({ ...GAS_FORM, prodRows: GAS_PROD_ROWS, presSource: 'prod' }).rows.find((y) => Math.abs(y.qMMscfd - Number(x.qMMscfd)) < 1e-9).tDays));
  const qc = GAS_PROD_ROWS.map((x) => Number(x.qMMscfd) * Number(x.cgrStbMMscf));
  let stb = 0;
  for (let i = 1; i < days.length; i++) stb += ((days[i] - days[i - 1]) * (qc[i] + qc[i - 1])) / 2;
  close(r.startCondMMstb, stb / 1e6, 1e-9);
  close(r.rows[0].condMMstb, r.startCondMMstb, 1e-12); // first step starts where history ended

  // and advances by rate x step, ending at the reported EUR
  for (let i = 1; i < r.rows.length; i++) {
    close(r.rows[i].condMMstb, r.rows[i - 1].condMMstb + (r.rows[i - 1].qCondStbD * 30) / 1e6, 1e-9);
  }
  const last = r.rows.at(-1);
  close(r.eurCondMMstb, last.condMMstb + (last.qCondStbD * 30) / 1e6, 1e-9);

  // a typed CGR wins over the derived one
  const r2 = handlers['gas/forecast']({ ...base, forecastCgrStbMMscf: '35' });
  assert.equal(r2.forecastCgrStbMMscf, 35);
  close(r2.rows[0].qCondStbD, r2.rows[0].qMMscfd * 35, 1e-12);
});

// ---- condensate specific gravity and molecular weight ----
// PZ_Ashry.xlsx, sheet "P_Z MB (new)": SG = 141.5/(131.5+API) and
// MW = 42.43*SG/(1.008-SG). Pinned to the sheet's own cells for its API 49.3,
// and reported by both reserve and forecast for the well's condApi.
test('condensate SG and MW reproduce the P_Z MB (new) sheet and reach both gas modules', async () => {
  const { condProps } = await import('../src/core/reserve/gas-reserve.js');
  const c = condProps(49.3);
  close(c.sg, 0.78263274336, 1e-10); // sheet B2
  close(c.mw, 147.346636758, 1e-10); // sheet B3
  // the demo well (condApi 48.7): pure arithmetic, no fitting
  const d = condProps(48.7);
  close(d.sg, 141.5 / (131.5 + 48.7), 1e-14);
  close(d.mw, (42.43 * d.sg) / (1.008 - d.sg), 1e-14);

  const base = { ...GAS_FORM, prodRows: GAS_PROD_ROWS };
  const rsv = handlers['gas/reserve']({ ...base, presSource: 'prod' });
  assert.ok(!rsv.error, rsv.error);
  close(rsv.cond.sg, d.sg, 1e-14);
  close(rsv.cond.mw, d.mw, 1e-14);
  assert.equal(rsv.cond.api, 48.7);
  const fc = handlers['gas/forecast']({
    ...base, stepDays: '30', forecastFthpPsi: '300', minRateMMscfd: '1', maxSteps: '2', plateauMMscfd: '',
    startDate: '', startGpBscf: '', startPresPsi: '', giipBscf: '', pziPsi: '',
  });
  assert.ok(!fc.error, fc.error);
  close(fc.cond.sg, d.sg, 1e-14);
  close(fc.cond.mw, d.mw, 1e-14);
});

// ---- gas-equivalent material balance: PZ_Ashry.xlsx, sheet "P_Z MB (new)" ----
// Condensate in Bscf = cum STB x GE, GE = 133.01*SG/MW Mscf/STB (the sheet's
// constant; 133.00 misses its cell by 0.008%). Gp total = Gp + that, and the
// p/Z line is fitted on Gp TOTAL. Pinned to the sheet's own cells.
test('gas-equivalent chain reproduces the P_Z MB (new) sheet: cond Bscf, Gp total, GIIP on total', async () => {
  const { condProps, gasEquivMscfPerStb, condBscfFrom, giipFromPz } = await import('../src/core/reserve/gas-reserve.js');
  const c = condProps(49.3);
  const ge = gasEquivMscfPerStb(c.sg, c.mw);
  // the sheet's two rows: 17 MMscf/d for 3652 days, CGR 40 -> 30 (trapezoid)
  const gp = (17 * 3652) / 1000; // 62.084 Bscf
  const condStb = ((17 * 40 + 17 * 30) / 2) * 3652; // 2,172,940 STB
  close(gp, 62.084, 1e-12);
  const condBscf = condBscfFrom(condStb / 1e6, ge);
  close(condBscf, 1.53514645623, 1e-9); // sheet G7
  const gpTotal = gp + condBscf;
  close(gpTotal, 63.6191464562, 1e-9); // sheet I7
  // the sheet's own p/Z values and the fit on Gp TOTAL
  const pts = [
    { gpBscf: 0, gpTotalBscf: 0, pOverZ: 10500 / 1.46295 },
    { gpBscf: gp, gpTotalBscf: gpTotal, pOverZ: 5000 / 0.97422470061 },
  ];
  const fit = giipFromPz(pts);
  close(fit.pziPsi, 7177.27878601, 1e-9); // sheet J7 (b)
  close(fit.slope, -32.144294386, 1e-8); // sheet K7 (m)
  close(fit.giipBscf, 223.283133849, 1e-8); // sheet M7
  // and the same points fitted on DRY Gp give the lower, old answer
  const dry = giipFromPz(pts.map((p) => ({ gpBscf: p.gpBscf, pOverZ: p.pOverZ })));
  assert.ok(dry.giipBscf < fit.giipBscf, 'ignoring condensate under-states GIIP');
  close(dry.giipBscf, 217.895, 1e-3);
});

// ---- forecast start state and depletion on the Gp-total basis ----
// The GIIP handed to the forecast is fitted on Gp total, so every place the
// forecast reports a cumulative must be on that basis too: the start state
// (gas + cond equiv = total), each row's gpTotalBscf continuing from it, and
// the history overlay the chart draws.
test('forecast reports its start state and cumulative on the Gp-total basis', async () => {
  const { condProps, gasEquivMscfPerStb } = await import('../src/core/reserve/gas-reserve.js');
  const base = {
    ...GAS_FORM, prodRows: GAS_PROD_ROWS,
    stepDays: '30', forecastFthpPsi: '300', minRateMMscfd: '1', maxSteps: '4', plateauMMscfd: '',
    startDate: '', startGpBscf: '', startPresPsi: '', giipBscf: '', pziPsi: '',
  };
  const r = handlers['gas/forecast'](base);
  assert.ok(!r.error, r.error);
  const cp = condProps(Number(GAS_FORM.condApi));
  const ge = gasEquivMscfPerStb(cp.sg, cp.mw);
  // start: cond Bscf is the history cumulative x GE; total is gas + that
  close(r.startCondBscf, r.startCondMMstb * ge, 1e-12);
  close(r.startGpTotalBscf, r.startGpBscf + r.startCondBscf, 1e-12);
  // and the history overlay ends exactly where the forecast starts, on both bases
  const hLast = r.history.at(-1);
  close(hLast.gpBscf, r.startGpBscf, 1e-9);
  close(hLast.gpTotalBscf, r.startGpTotalBscf, 1e-9);
  // first row starts at the start total; each row's total = gas + cond x GE
  close(r.rows[0].gpTotalBscf, r.startGpTotalBscf, 1e-9);
  for (const p of r.rows) {
    close(p.condBscf, p.condMMstb * ge, 1e-12);
    close(p.gpTotalBscf, p.gpBscf + p.condBscf, 1e-12);
  }
  // EUR total is the last total plus the last step's gas and condensate
  const L = r.rows.at(-1);
  close(r.eurTotalBscf, L.gpTotalBscf + (L.qMMscfd * 30) / 1000 + ((L.qCondStbD * 30) / 1e6) * ge, 1e-9);
  // recovery is on the total basis
  close(r.recoveryPct, (r.eurTotalBscf / r.giipBscf) * 100, 1e-9);
});
