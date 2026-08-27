// WellSim whole-project validation sweep: 5 sensitivity cases per module,
// compared to origin-sheet stored values (SHEET) or closed-form/physics
// identities (ANALYTIC). Run from D:\TheSimplestNode.
import { oilMarch, espBackMarch } from '../src/core/vlp/oil-march.js';
import { gasMarch } from '../src/core/vlp/gas-march.js';
import { futureOilJ } from '../src/core/nodal/sensitivity.js';
import { pumpCurveAt, headAtRateFt, espIntakeState, espOperatingPoint } from '../src/core/vlp/esp.js';
import { pumpByName } from '../src/core/vlp/esp-catalog.js';
import { createOilIpr } from '../src/core/ipr/oil-ipr.js';
import { createGasIpr } from '../src/core/ipr/gas-ipr.js';
import {
  gasPresSolver, giipFromPz, staticGasMarch, presFromPz, zAtRes, gasForecast,
} from '../src/core/reserve/gas-reserve.js';
import { oilStaticMb } from '../src/core/reserve/oil-reserve.js';
import { tarnerForecast } from '../src/core/reserve/tarner.js';
import { oilNodal, gasNodal, gasCalibrate } from '../src/server/api.js';
import { bubblePointPsi, oilFvf } from '../src/core/pvt/oil.js';

const rows = [];
const add = (mod, cas, kind, ours, ref, tolPct) => {
  const rel = ref === 0 ? Math.abs(ours) : Math.abs((ours - ref) / ref) * 100;
  rows.push({ mod, cas, kind, ours, ref, relPct: rel, ok: rel <= tolPct });
};
const addBool = (mod, cas, kind, ok, note) =>
  rows.push({ mod, cas, kind, ours: note, ref: '-', relPct: null, ok });

const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };

// ============ 1. GAS WELL MODEL (vs gas workbook) ============
const GAS = {
  ...HEAT, thpPsi: 1625, qGasMMscfd: 14.137, cgrStbMMscf: 57.4358974358974,
  wgrStbMMscf: 3.84615384615385, condApi: 48.7, gasSg: 0.763, n2: 0.012,
  co2: 0.03, h2s: 2e-6, tresF: 232, tubingIdIn: 2.992, perfTvdM: 2817.7433730104,
  devStartM: 690, devAngleDeg: 23.65, roughnessBase: 0.0021, sigmaDyneCm: 30,
  oilViscCp: 2, waterSg: 1.05, matchHead: 1, matchFriction: 1,
};
add('1 Gas well', 'a base march D51 (2440/14.137)', 'SHEET', gasMarch({ ...GAS, thpPsi: 2440 }).pwfPsi, 3598.66511095252, 1e-6);
add('1 Gas well', 'b get_Pwf 2440/5.192', 'SHEET', gasMarch({ ...GAS, thpPsi: 2440, qGasMMscfd: 5.192 }).pwfPsi, 3414.01935418286, 0.001);
add('1 Gas well', 'c get_Pwf 2000/10.002', 'SHEET', gasMarch({ ...GAS, thpPsi: 2000, qGasMMscfd: 10.002 }).pwfPsi, 2913.97367170315, 0.001);
add('1 Gas well', 'd get_Pwf 1625/14.137', 'SHEET', gasMarch({ ...GAS, thpPsi: 1625, qGasMMscfd: 14.137 }).pwfPsi, 2647.82940604655, 0.001);
{
  const F = { ...GAS, topPerfAhM: 3013, n2Pct: 1.2, co2Pct: 3, h2sPpm: 2, priPsi: 3800,
    permMd: 5, thicknessFt: 80, reFt: 1640.5, rwFt: 0.5104166667, skin: 0, iprMode: 'j' };
  const cal = gasCalibrate({ ...F, testPoints: [
    { qMMscfd: 5.192, thpPsi: 2440 }, { qMMscfd: 10.002, thpPsi: 2000 }, { qMMscfd: 14.137, thpPsi: 1625 }] });
  const r = gasNodal({ ...F, permMd: cal.matchedPermMd });
  add('1 Gas well', 'e op lands on matched test', 'ANALYTIC', r.op.qMMscfd, 14.137, 3.5);
}

// ============ 2. OIL NATURAL (vs oil natural workbook) ============
const NAT = {
  ...HEAT, thpPsi: 700, qOilStbD: 6369.37106982661, gorScfStb: 5000, wcPct: 50,
  api: 46, gasSg: 0.842, tresF: 201, perfTvdM: 2803.28614181045, devStartM: 1910,
  devAngleDeg: 7, tubingIdIn: 2.992, roughness: 0.00006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 700, pbPsi: 1920.00761413201, rhoGscKgm3: 0.938693049598781,
  matchHead: 1, matchFriction: 1,
};
add('2 Oil natural', 'a base march D51', 'SHEET*', oilMarch(NAT).pwfPsi, 6897.525558667, 2); // Z + Ramey deviations
{
  const pvt = { pbPsi: 1920.00761413201, rsiScfStb: 700, gasSg: 0.842, api: 46, tempF: 201 };
  const darcy = { permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0 };
  const rsCur = 700;
  const pins = [[2662.5, 5.27146844059], [1775, 5.8313895807703], [887.5, 6.78094220552862]];
  pins.forEach(([p, ref], i) =>
    add('2 Oil natural', `${'bcd'[i]} future J @${p}`, 'SHEET', futureOilJ(p, { darcy, pvt, rsCurScfStb: rsCur }).j, ref, 1e-6));
}
{
  const F = { thpPsi: 700, qOilStbD: 2100, wcPct: 50, gorScfStb: 5000, tubingIdIn: 2.992,
    roughness: 0.00006, topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7, api: 46, gasSg: 0.842,
    rsiScfStb: 700, tresF: 201, oilViscCp: 6, waterSg: 1.05, ...HEAT, priPsi: 3550, permMd: 50,
    thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0, matchHead: 1, matchFriction: 1,
    liftType: 'natural' };
  const r = oilNodal(F);
  add('2 Oil natural', 'e op vs current-rate input', 'ANALYTIC', r.op.qOilStbD, 2100, 3);
}

// ============ 3. OIL GAS LIFT (vs GL workbook + physics) ============
const GL = {
  ...HEAT, thpPsi: 300, qOilStbD: 2428.8092730636, gorScfStb: 412, wcPct: 25,
  api: 33, gasSg: 0.812, tresF: 220, perfTvdM: 3290.98087338564, devStartM: 2400,
  devAngleDeg: 24.6, tubingIdIn: 2.992, roughness: 0.0006, oilViscCp: 6, waterSg: 1.05,
  rsiScfStb: 442, pbPsi: 2185.18736342052, matchHead: 1, matchFriction: 1,
  gasLift: { injDepthTvdM: 2490.9164156516, injRateMMscfd: 0 },
};
add('3 Oil gas-lift', 'a base march inj=0', 'SHEET*', oilMarch(GL).pwfPsi, 3548.8671808735, 5.5);
{
  const injs = [0.25, 0.5, 1, 2];
  let prev = oilMarch(GL).pwfPsi;
  let mono = true;
  const vals = [prev];
  for (const inj of injs) {
    const p = oilMarch({ ...GL, gasLift: { ...GL.gasLift, injRateMMscfd: inj } }).pwfPsi;
    if (p >= prev) mono = false;
    vals.push(p); prev = p;
  }
  ['b', 'c', 'd', 'e'].forEach((c, i) =>
    addBool('3 Oil gas-lift', `${c} Pwf falls w/ inj ${injs[i]}`, 'ANALYTIC', vals[i + 1] < vals[i],
      `${vals[i].toFixed(0)}→${vals[i + 1].toFixed(0)} psi`));
}

// ============ 4. ESP (vs ESP workbook stored affinity cells) ============
const PUMP = pumpByName('ESP B 538-3600');
{
  // sheet-stored total-head first points at 145 stages: H21/J21/L21/N21/R21
  const pins = [[30, 2320], [35, 3157.77777777778], [40, 4124.44444444444], [45, 5220], [55, 7797.77777777778]];
  pins.forEach(([hz, ref], i) =>
    add('4 ESP', `${'abcde'[i]} affinity head @${hz}Hz`, 'SHEET',
      pumpCurveAt(PUMP, { stages: 145, freqHz: hz })[0].headFt, ref, 1e-9));
  const curve = pumpCurveAt(PUMP, { stages: 145, freqHz: 50 });
  add('4 ESP', '+ head interp AK23', 'SHEET', headAtRateFt(curve, 3332.4373630216), 4303.97372559841, 1e-6);
  const s = espIntakeState({ ...HEAT, thpPsi: 160, qOilStbD: 2565, gorScfStb: 384, wcPct: 5, api: 32,
    gasSg: 0.812, tresF: 230, perfTvdM: 3240, devStartM: 1500, devAngleDeg: 0, tubingIdIn: 2.992,
    roughness: 0.00006, oilViscCp: 6, waterSg: 1.05, rsiScfStb: 384, pbPsi: 1911.80724408471,
    matchHead: 1, matchFriction: 1, esp: { pumpTvdM: 2985, pumpDpPsi: 0 } },
    { pIntakePsi: 1397.59061968516, tIntakeF: 230, sepEffPct: 95 });
  add('4 ESP', '+ BJ38 no-sep grad (S18 mass)', 'SHEET', s.gradNoSepPsiFt, 0.204440252648098, 1);
  add('4 ESP', '+ BJ39 sep grad', 'SHEET', s.gradSepPsiFt, 0.307891727757973, 3);
}

// ============ 5. GAS RESERVE (sheet + closed form) ============
add('5 Gas reserve', 'a SITHP static march', 'SHEET*',
  staticGasMarch({ perfTvdM: 5041, tresF: 315, gasSg: 0.71, n2: 0.018, co2: 0.08, h2s: 18e-6 },
    { sithpPsi: 5545, surfTempF: 120 }).presPsi, 7661.93317505748, 3.5);
{
  const J = 1.74848658948593e-3;
  const IPR = createGasIpr({ jTest: J, priPsi: 3800 });
  const zi = zAtRes(GAS, 3800);
  const pzi = 3800 / zi;
  [30, 60, 90, 150].forEach((G, i) => {
    const q = 10;
    const days = [0, 100, 200, 300];
    const rws = days.map((d) => {
      const pz = pzi * (1 - (q * d) / 1000 / G);
      const pres = presFromPz(GAS, pz);
      return { date: d, qMMscfd: q, pwfPsi: Math.sqrt(pres ** 2 - (1000 * q) / J) };
    });
    const fit = giipFromPz(gasPresSolver(GAS, IPR, rws));
    add('5 Gas reserve', `${'bcde'[i]} p/Z tank G=${G}`, 'ANALYTIC', fit.giipBscf, G, 0.05);
  });
}

// ============ 6. OIL RESERVE (sheet-pinned formulas + closed form) ============
{
  const PVT_IN = { rsiScfStb: 700, gasSg: 0.842, api: 46, tempF: 201 };
  const PB = bubblePointPsi(PVT_IN);
  const PVT = { pbPsi: PB, ...PVT_IN };
  const CFG = { tresF: 201, gasSg: 0.842, gorScfStb: 700, wcPct: 0, thpPsi: 700 };
  const darcy = { permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0 };
  [10, 15, 20, 25, 30].forEach((N, i) => {
    const ipr = createOilIpr({ darcy: { ...darcy, viscCp: 1, bo: 1 }, priPsi: 3550, pbPsi: PB, prPsi: 3550 });
    const boi = oilFvf(3550, PVT);
    const pr2 = 3300;
    const bo2 = oilFvf(pr2, PVT);
    const np2 = (N * (bo2 - boi)) / bo2;
    const q = (np2 * 1e6) / 100;
    const r = oilStaticMb(CFG, ipr, PVT,
      [{ date: 0, presPsi: 3550 }, { date: 100, presPsi: pr2 }],
      [{ date: 0, qOilStbD: q, gorScfStb: 700 }, { date: 100, qOilStbD: q, gorScfStb: 700 }]);
    add('6 Oil reserve', `${'abcde'[i]} H-O MB N=${N}`, 'ANALYTIC', r.fit.nAvgMMstb, N, 0.01);
  });
}

// ============ 7. GAS FORECAST (physics ordering) ============
{
  const J = 1.74848658948593e-3;
  const IPR = createGasIpr({ jTest: J, priPsi: 3800 });
  const zi = zAtRes(GAS, 3800);
  const giips = [60, 90, 120, 150, 200];
  const eurs = giips.map((G) =>
    gasForecast({ marchCfg: GAS, ipr: IPR, giipBscf: G, pziPsi: 3800 / zi, stepDays: 30,
      fthpPsi: 300, plateauMMscfd: 12, minRateMMscfd: 1, maxSteps: 250 }).eurBscf);
  giips.forEach((G, i) => {
    const ok = i === 0 ? eurs[0] > 0 : eurs[i] > eurs[i - 1];
    addBool('7 Gas forecast', `${'abcde'[i]} EUR(G=${G})=${eurs[i].toFixed(1)}`, 'ANALYTIC', ok,
      i === 0 ? 'positive' : `> EUR(G=${giips[i - 1]})`);
  });
}

// ============ 8. OIL FORECAST — TARNER (physics ordering) ============
{
  const PVT_IN = { rsiScfStb: 700, gasSg: 0.842, api: 46, tempF: 201 };
  const PVT = { pbPsi: bubblePointPsi(PVT_IN), ...PVT_IN };
  const CFG = { thpPsi: 300, qOilStbD: 2000, gorScfStb: 700, wcPct: 0, api: 46, gasSg: 0.842,
    rsiScfStb: 700, tresF: 201, oilViscCp: 6, waterSg: 1.05, tubingIdIn: 2.992, roughness: 0.00006,
    topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7, perfTvdM: 2802.3, ...HEAT,
    matchHead: 1, matchFriction: 1 };
  const DARCY = { permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0 };
  const ns = [20, 30, 40, 50, 60];
  const res = ns.map((N) =>
    tarnerForecast({ cfg: CFG, pvt: PVT, darcy: DARCY, nMMstb: N, priPsi: 3550,
      pwfMode: 'fixed', minPwfPsi: 500, stepDays: 30, maxSteps: 60 }));
  ns.forEach((N, i) => {
    const conv = res[i].rows.every((r) => r.converged);
    const ok = conv && (i === 0 ? res[0].eurMMstb > 0 : res[i].eurMMstb > res[i - 1].eurMMstb);
    addBool('8 Oil forecast', `${'abcde'[i]} EUR(N=${N})=${res[i].eurMMstb.toFixed(2)}`, 'ANALYTIC', ok,
      `${res[i].rows.length} steps, all converged=${conv}`);
  });
}

// ============ report ============
let pass = 0;
console.log('MODULE            | CASE                          | REF     | OURS         | SHEET/REF    | rel%   | OK');
for (const r of rows) {
  if (r.ok) pass++;
  const ours = typeof r.ours === 'number' ? r.ours.toFixed(4) : String(r.ours);
  const ref = typeof r.ref === 'number' ? r.ref.toFixed(4) : String(r.ref);
  console.log(
    `${r.mod.padEnd(17)}| ${r.cas.padEnd(30)}| ${r.kind.padEnd(8)}| ${ours.padEnd(13)}| ${ref.padEnd(13)}| ${r.relPct == null ? '  -   ' : r.relPct.toFixed(3).padStart(6)} | ${r.ok ? 'PASS' : 'FAIL'}`
  );
}
console.log(`\n${pass}/${rows.length} PASS`);
