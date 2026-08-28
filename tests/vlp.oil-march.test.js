// Oil-family march regression vs the Natural / GasLift / ESP workbooks.
// Station-level values pin at 1e-9 with the sheet's Z injected; full-march
// pressures carry the workbooks' GoalSeek-tolerance drift in Z, so the
// integration comparisons use a small percentage band (our Z is converged).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfTvdM, tvdToAhFt } from '../src/core/vlp/wellpath.js';
import { ashryHeadFactor } from '../src/core/vlp/ashry.js';
import {
  deriveOilFlow,
  resolveOilPvt,
  oilStationGradients,
  oilMarch,
  espBackMarch,
} from '../src/core/vlp/oil-march.js';

function close(actual, expected, rel = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

// Heat-transfer inputs for the calculated flowing wellhead temperature (the
// project's only oil temperature model). Values from the gas workbook's
// convention: soil 90 F, U=3 BTU/hr.ft2.F, OD 3.5", Cp 0.51.
const HEAT = { soilTempF: 90, htcBtu: 3, tubingOdIn: 3.5, cpBtu: 0.51 };

// ---- Natural oil well live case (Oil well model Natural_V3.1.7) ----
const NAT = {
  ...HEAT,
  thpPsi: 700,
  qOilStbD: 6369.37106982661,
  gorScfStb: 5000,
  wcPct: 50,
  api: 46,
  gasSg: 0.842,
  thtF: 120,
  tresF: 201,
  perfTvdM: 2803.28614181045,
  devStartM: 1910,
  devAngleDeg: 7,
  tubingIdIn: 2.992,
  roughness: 0.00006,
  oilViscCp: 6,
  waterSg: 1.05,
  rsiScfStb: 700,
  pbPsi: 1920.00761413201,
  rhoGscKgm3: 0.938693049598781, // workbook rouhgsc (BHP!AA18)
  matchHead: 1,
  matchFriction: 1,
};

test('wellpath: perf TVD and TVD->AH ("VLP-IPR"!I3, BHP!A50)', () => {
  close(perfTvdM({ topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7 }), 2803.28614181045);
  close(tvdToAhFt(8880.42383709803, { devStartM: 1910, devAngleDeg: 7 }), 8900.06827489796);
});

test('Ashry head factor (Natural D17, ESP D17, GasLift H17)', () => {
  close(ashryHeadFactor(5000, 50), 0.788623453194032);
  close(ashryHeadFactor(384, 5), 1.0482790415274);
  close(ashryHeadFactor(412, 25), 1.00553976901283);
});

test('oil flow derivations (BHP!I4, I9, P10, P15, R17, P6, S15, R18)', () => {
  const f = deriveOilFlow(NAT);
  close(f.qw, 6369.37106982661);
  close(f.qL, 12738.7421396532);
  close(f.gasFormationScfD, 31846855.3491331);
  close(f.liqSg, 0.923591549295775);
  close(f.massFormation, 6173663.38806371);
  close(f.areaFt2, 0.0488011822222222);
  close(f.vslFtS, 16.964154601061);
  close(f.muLCp, 3.25);
});

test('oil station 22 — full modified-Griffith chain with sheet Z (BHP row 22)', () => {
  const flow = deriveOilFlow(NAT);
  const pvt = resolveOilPvt(NAT);
  const s = oilStationGradients(
    {
      pPsi: 700,
      tF: 120,
      z: 0.843712163913253, // BHP!AA22 (GoalSeek value, injected for parity)
      gasScfD: flow.gasFormationScfD,
      massNreLbDay: flow.massFormation,
      massFricLbDay: flow.massFormation,
    },
    NAT,
    flow,
    pvt
  );
  close(s.rhoG, 3.2518956475522); // AB22
  close(s.vsg, 149.265941583993); // AD22
  close(s.vm, 166.230096185054); // AE22
  close(s.rs, 213.440464457472); // AF22
  close(s.el, 0.317896166554007); // AG22
  close(s.rhoO, 44.4353237677132); // AK22
  close(s.rhoL, 54.9593368848566); // AL22
  close(s.rhoMix, 19.6894929992078); // AM22
  close(s.nre, 642434.993405653); // AN22
  close(s.f, 0.00338523287495417); // AO22
  close(s.gradHead, 0.107830527504687); // AP22
  close(s.gradFric, 0.637062000914817); // AQ22
  // D23 march mechanics from these gradients (B23 = A23 = 317.157994182072)
  const d23 = 700 + s.gradHead * 317.157994182072 + s.gradFric * 317.157994182072;
  close(d23, 936.248620194742);
});

test('oil station 50 — deep station with sheet Z, above-Pb density branch (BHP row 50)', () => {
  const flow = deriveOilFlow(NAT);
  const pvt = resolveOilPvt(NAT);
  const s = oilStationGradients(
    {
      pPsi: 6684.57466648165, // D50
      tF: 198.206896551724, // N50
      z: 1.25104708835146, // AA50 — stored GoalSeek value (residual -0.0715!)
      gasScfD: flow.gasFormationScfD,
      massNreLbDay: flow.massFormation,
      massFricLbDay: flow.massFormation,
    },
    NAT,
    flow,
    pvt
  );
  close(s.vsg, 26.3026052488249); // AD50
  close(s.rs, 700); // AF50 (>= Pb)
  close(s.el, 0.541345545920576); // AG50
  close(s.rhoO, 40.2866179818181); // AK50 — undersaturated branch
  close(s.rhoMix, 37.0932165636512); // AM50
  close(s.nre, 92757.4168175341); // AN50
  close(s.f, 0.00465298293145063); // AO50
  close(s.gradHead, 0.203142920392366); // AP50
  close(s.gradFric, 0.464798426477775); // AQ50
});

test('gas impurities are inputs to the oil march (sour pcrit route)', () => {
  const sweet = oilMarch(NAT).pwfPsi;
  const sour = oilMarch({ ...NAT, co2: 0.1, n2: 0.02, pcritMethod: 'sour' }).pwfPsi;
  assert.ok(Number.isFinite(sour));
  assert.notEqual(sweet, sour);
  // composition is ignored on the default sweet (workbook-parity) route
  const sweetIgnores = oilMarch({ ...NAT, co2: 0.1, n2: 0.02 }).pwfPsi;
  assert.equal(sweetIgnores, sweet);
});

test('oil natural full march lands near sheet Pwf (BHP!D51)', () => {
  // Two deliberate model differences vs the workbook remain: (1) explicit
  // Brill & Beggs Z vs the sheet's often-unconverged GoalSeek H-Y (BHP!Z50
  // residual -0.0715), and (2) the CALCULATED flowing wellhead temperature
  // (Ramey chain; WHT ~191 F here) vs the sheet's 120 F input THT. Station
  // rows pin exactly with the sheet's T and Z injected (tests above), so
  // the offsets are purely those model decisions — absorbed in practice by
  // the head/friction matching factors.
  const r = oilMarch(NAT);
  assert.equal(r.stations.length, 30);
  const rel = Math.abs(r.pwfPsi - 6897.525558667) / 6897.525558667;
  console.log(`    natural Pwf: js=${r.pwfPsi.toFixed(3)} excel=6897.526 rel=${(rel * 100).toFixed(3)}%`);
  assert.ok(rel < 0.02, `Pwf ${r.pwfPsi} vs 6897.525558667 (rel ${rel})`);
});

// ---- Gas lift live case (Oil well model_GasLift_V3.1.7, injection = 0) ----
const GL = {
  ...HEAT,
  thpPsi: 300,
  qOilStbD: 2428.8092730636,
  gorScfStb: 412,
  wcPct: 25,
  api: 33,
  gasSg: 0.812,
  thtF: 115,
  tresF: 251,
  perfTvdM: 3290.98087338564,
  devStartM: 2400,
  devAngleDeg: 24.6,
  tubingIdIn: 2.992,
  roughness: 0.0006, // GasLift workbook S6 (10x the Natural value)
  oilViscCp: 6,
  waterSg: 1.05,
  rsiScfStb: 442,
  pbPsi: 2185.18736342052,
  rhoGscKgm3: 0.93489880969514, // gg=0.812 workbook value (ESP AA16)
  matchHead: 1,
  matchFriction: 1,
  gasLift: { injDepthTvdM: 2490.9164156516, injRateMMscfd: 0 },
};

test('gas lift flow derivations (GasLift BHP!I4, R17/T17)', () => {
  const f = deriveOilFlow(GL);
  close(f.qw, 809.6030910212); // I4
  close(f.massFormation, 1092020.51819812); // R17
  close(f.massLifted, 1092020.51819812); // T17 (injection = 0)
});

test('gas lift two-zone march lands near sheet Pwf (GasLift BHP!D51)', () => {
  const r = oilMarch(GL);
  assert.equal(r.stations.length, 30); // 15 + 14 steps
  close(r.stations[15].tvdFt, 2490.9164156516 * 3.281, 1e-9); // B37 = injection depth
  // Same deliberate model differences as the natural case (explicit Z +
  // calculated WHT ~175 F vs the sheet's 115 F input); deeper well and a
  // low-GLR head-dominated column make the temperature effect larger here.
  const rel = Math.abs(r.pwfPsi - 3548.8671808735) / 3548.8671808735;
  console.log(`    gaslift Pwf: js=${r.pwfPsi.toFixed(3)} excel=3548.867 rel=${(rel * 100).toFixed(3)}%`);
  assert.ok(rel < 0.055, `Pwf ${r.pwfPsi} vs 3548.8671808735 (rel ${rel})`);
});

// ---- ESP live case (Oil well model_ESP_V5.01) ----
const ESP = {
  ...HEAT,
  thpPsi: 160,
  qOilStbD: 2565,
  gorScfStb: 384,
  wcPct: 5,
  api: 32,
  gasSg: 0.812,
  thtF: 130,
  tresF: 230,
  perfTvdM: 3240,
  devStartM: 1500,
  devAngleDeg: 0,
  tubingIdIn: 2.992,
  roughness: 0.00006,
  oilViscCp: 6,
  waterSg: 1.05,
  rsiScfStb: 384,
  pbPsi: 1911.80724408471,
  rhoGscKgm3: 0.93489880969514, // ESP BHP!AA16
  matchHead: 1,
  matchFriction: 1,
  esp: {
    pumpTvdM: 2985,
    pumpDpPsi: 1325.15790659941, // ESP!B4
    tubingGasScfD: 872994.209827361, // BHP!P10 = GLR*(1 - sep%/100)*qL
  },
};

test('ESP flow derivations (ESP BHP!P15, P17, P18)', () => {
  const f = deriveOilFlow(ESP);
  close(f.qw, 135); // I4
  close(f.qL, 2700); // I9/M15
  close(f.liqSg, 0.87467125382263); // P15
  close(f.massTubing, 881680.955445322); // P17
  close(f.muLCp, 5.725); // P18
});

test('ESP march: discharge, pump insertion, Pwf (BHP!D48, D49, D51)', () => {
  const r = oilMarch(ESP);
  close(r.stations[26].tvdFt, 2985 * 3.281, 1e-9); // B48 = pump depth
  const relD = Math.abs(r.dischargePsi - 2722.74852628457) / 2722.74852628457;
  console.log(`    ESP discharge: js=${r.dischargePsi.toFixed(3)} excel=2722.749 rel=${(relD * 100).toFixed(3)}%`);
  assert.ok(relD < 0.03); // explicit Z + calculated WHT (~159 F vs 130 F input)
  close(r.intakePsi, r.dischargePsi - 1325.15790659941, 1e-12); // D49 mechanics
  const relW = Math.abs(r.pwfPsi - 1634.1128026245) / 1634.1128026245;
  console.log(`    ESP Pwf: js=${r.pwfPsi.toFixed(3)} excel=1634.113 rel=${(relW * 100).toFixed(3)}%`);
  assert.ok(relW < 0.05);
});

test('ESP back-march from IPR Pwf to pump intake (BHP!D67 -> D65)', () => {
  const r = espBackMarch(ESP, 1624.45782984539);
  const rel = Math.abs(r.pipPsi - 1391.50309550872) / 1391.50309550872;
  console.log(`    ESP intake(IPR): js=${r.pipPsi.toFixed(3)} excel=1391.503 rel=${(rel * 100).toFixed(3)}%`);
  assert.ok(rel < 0.01, `PIP ${r.pipPsi} vs 1391.50309550872`);
});

test('ESP pump dP floor engages at 60 psi', () => {
  const r = oilMarch({ ...ESP, esp: { ...ESP.esp, pumpDpPsi: 99999 } });
  assert.equal(r.intakePsi, 60);
});

test('input validation names every missing field and guards the edges', () => {
  const { roughness, oilViscCp, ...m } = NAT;
  assert.throws(() => oilMarch(m), /missing required input\(s\): roughness, oilViscCp/);
  assert.throws(() => oilMarch({ ...NAT, wcPct: 100 }), /wcPct must be < 100/);
  assert.throws(() => oilMarch({ ...NAT, qOilStbD: 0 }), /qOilStbD must be > 0/);
  assert.throws(
    () => oilMarch({ ...NAT, esp: { pumpTvdM: 2985 } }),
    /esp: missing required input\(s\): pumpDpPsi/
  );
  assert.throws(
    () => oilMarch({ ...NAT, gasLift: {} }),
    /gasLift: missing required input\(s\): injDepthTvdM/
  );
});

test('flowing wellhead temperature is CALCULATED (single oil temp model)', () => {
  const r = oilMarch(NAT);
  assert.ok(r.whtF > NAT.soilTempF && r.whtF < NAT.tresF, `whtF=${r.whtF}`);
  assert.equal(r.stations[0].tF, r.whtF);
  assert.ok(Math.abs(r.stations[r.stations.length - 1].tF - NAT.tresF) < 1e-9);
  assert.ok(r.k11 > 0 && r.k11 < 1);
  // WHT rises with rate (dying wells cool down)
  const lo = oilMarch({ ...NAT, qOilStbD: 500 });
  assert.ok(r.whtF > lo.whtF, `${lo.whtF} -> ${r.whtF}`);
  // heat inputs are required
  const { soilTempF, ...missing } = NAT;
  assert.throws(() => oilMarch(missing), /missing required input\(s\): soilTempF/);
  // ESP back-march shares the same temperature chain at the intake station
  const top = oilMarch(ESP);
  const back = espBackMarch(ESP, 1624.45782984539);
  assert.equal(back.stations[back.stations.length - 1].tF, top.stations[27].tF);
});

// ---- pump setting depth entered as MEASURED (along-hole) depth ----
test('ESP pump depth: AH input converts to the same TVD physics', () => {
  // deviated trajectory: kick-off 1910 m at 7 deg (the demo well)
  const dev = { devStartM: 1910, devAngleDeg: 7, perfTvdM: 3100 };
  const ahOf = (tvdM) => 1910 + (tvdM - 1910) / Math.cos((7 * (22 / 7)) / 180);
  const base = { ...ESP, ...dev };
  const byTvd = oilMarch({ ...base, esp: { ...ESP.esp, pumpTvdM: 2985 } });
  const byAh = oilMarch({ ...base, esp: { ...ESP.esp, pumpAhM: ahOf(2985), pumpTvdM: undefined } });
  close(byAh.pwfPsi, byTvd.pwfPsi, 1e-9);
  close(byAh.intakePsi, byTvd.intakePsi, 1e-9);
  close(byAh.dischargePsi, byTvd.dischargePsi, 1e-9);
  // a DEEPER measured depth must place the pump deeper (higher intake P)
  const deeper = oilMarch({ ...base, esp: { ...ESP.esp, pumpAhM: ahOf(2985) + 200, pumpTvdM: undefined } });
  assert.ok(deeper.intakePsi > byTvd.intakePsi, 'deeper pump sees more head');
});

test('ESP pump depth: AH wins when both are given, and one is required', () => {
  const dev = { devStartM: 1910, devAngleDeg: 7, perfTvdM: 3100 };
  const both = oilMarch({ ...ESP, ...dev, esp: { ...ESP.esp, pumpAhM: 2993.08, pumpTvdM: 1 } });
  const ahOnly = oilMarch({ ...ESP, ...dev, esp: { ...ESP.esp, pumpAhM: 2993.08, pumpTvdM: undefined } });
  close(both.pwfPsi, ahOnly.pwfPsi, 1e-12);
  assert.throws(
    () => oilMarch({ ...ESP, ...dev, esp: { pumpDpPsi: 100 } }),
    /pumpAhM/,
    'a pump depth is still required'
  );
});
