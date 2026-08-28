// Walsh generalized-MB forecast — pins against the workbook
// "new oil reservoir forecast Final Walsh and turner variable Pwf_V1.1.xls",
// Walsh sheet row 16 (the first solved step), with the sheet's own frozen
// PVT injected so every transcribed formula is isolated and cell-exact.
import { test } from 'node:test';
import assert from 'node:assert';
import { rvWalsh, gpWalsh, soWalsh, gorWalsh, walshForecast } from '../src/core/reserve/walsh.js';
import { kroTarner, krgTarner, ctTermTarner } from '../src/core/reserve/tarner.js';

// sheet row-16 state (values read from the workbook at full precision)
const N = 4.4, PI = 3300, SWI = 0.15, CW = 2.63e-6, CF = 3.25e-6;
const BOI = 1.5892620848989838, RSI = 1000;
const P16 = 3108.7177353687543, PWF16 = 2164.0067008654373;
const SO16 = 0.7996063974801619, SG16 = 0.05039360251983807;
const F = { rs: 984.1022139550696, bo: 1.581969273878256, bg: 0.005859191461407339,
  muO: 0.19418187816263727, muG: 0.19418187816263727 };
const J2 = 1.195609234151654;
const NP13 = 0.2, GP13 = 200, GOR13 = 1000;

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${msg}: ${a} vs ${b}`);

test('Walsh: Rv polynomial pin (AH16)', () => {
  close(rvWalsh(P16), 0.00005783451014088964, 1e-12, 'Rv(H16)');
  // (AH13 = 2.374e-4 is a typed initial value on the sheet, not the polynomial)
});

test('Walsh: rel-perm at row-16 saturations (F16, G16)', () => {
  close(kroTarner(SO16), 0.5579749484772847, 1e-12, 'Kro');
  close(krgTarner(SG16), 3.1668304432269645e-7, 1e-9, 'Krg');
});

test('Walsh: ct term (R16)', () => {
  close(ctTermTarner(P16, { priPsi: PI, swi: SWI, cwPsi: CW, cfPsi: CF }),
    0.0008201508393512643, 1e-12, 'ct');
});

test('Walsh: generalized-MB Gp and So (O16, Y16)', () => {
  const rv = rvWalsh(P16);
  const ct = ctTermTarner(P16, { priPsi: PI, swi: SWI, cwPsi: CW, cfPsi: CF });
  const np16 = 0.24103233234563837;
  close(gpWalsh({ nMMstb: N, npMMstb: np16, rsi: RSI, ...F, boi: BOI, rv, ct, swi: SWI }),
    240.70758951361023, 1e-9, 'Gp MB');
  close(soWalsh({ swi: SWI, nMMstb: N, npMMstb: np16, bo: F.bo, boi: BOI, bg: F.bg, rv, ct }),
    0.7996088129522079, 1e-9, 'So MB');
});

test('Walsh: GOR with Foo (P16, AI16)', () => {
  const rv = rvWalsh(P16);
  const { foo, gor } = gorWalsh({ rs: F.rs, kro: kroTarner(SO16), krg: krgTarner(SG16),
    muO: F.muO, muG: F.muG, bo: F.bo, bg: F.bg, rv });
  close(foo, 0.999999991245803, 1e-9, 'Foo');
  close(gor, 984.1023567063671, 5e-9, 'GOR');
});

test('Walsh: mobility rates qt/qo and the step bookkeeping (J16,K16,M16,N16,AD16)', () => {
  const kro = kroTarner(SO16), krg = krgTarner(SG16);
  const lambdaT = kro / F.muO + krg / F.muG;
  const lambdaO = kro / F.muO;
  close(lambdaT, 2.8734672382404094, 1e-10, 'lambda_t');
  close(lambdaO, 2.873465607382539, 1e-10, 'lambda_o');
  const qt = J2 * lambdaT * (P16 - PWF16);
  close(qt, 3245.596292380543, 1e-9, 'qt');
  const qo = (qt * lambdaO) / (F.bo * lambdaT);
  close(qo, 2051.616617281917, 1e-9, 'qo');
  const np16 = NP13 + (qo * 20) / 1e6;
  close(np16, 0.24103233234563837, 1e-9, 'Np');
  const gor16 = 984.1023567063671;
  const gpTrap = GP13 + ((GOR13 + gor16) / 2) * (np16 - NP13);
  close(gpTrap, 240.70617365406997, 1e-9, 'Gp trapezoid');
  // and the sheet's converged residuals really are ~0 at this state
  const rv = rvWalsh(P16);
  const ct = ctTermTarner(P16, { priPsi: PI, swi: SWI, cwPsi: CW, cfPsi: CF });
  const gpMb = gpWalsh({ nMMstb: N, npMMstb: np16, rsi: RSI, ...F, boi: BOI, rv, ct, swi: SWI });
  assert.ok(Math.abs((gpTrap - gpMb) / gpMb) < 1e-4, 'Gp residual ~0 at sheet state');
});

test('Walsh: fixed-Pwf forecast runs, converges, depletes sensibly', () => {
  const cfg = {
    thpPsi: 500, qOilStbD: 1300, wcPct: 3, gorScfStb: 1000,
    tubingIdIn: 2.992, roughness: 0.00006,
    topPerfMah: 2810, kickoffM: 1910, deviationDeg: 7,
    api: 48, gasSg: 0.72, rsiScfStb: 1000, tresF: 225,
    muOilCp: 6, waterSg: 1.05,
    soilTempF: 90, uBtu: 3, tubingOdIn: 3.5, cpOil: 0.51,
  };
  const r = walshForecast({
    cfg,
    pvt: { pbPsi: 2931.6206812604, rsiScfStb: 1000, gasSg: 0.72, api: 48, tempF: 225 },
    jStbDPsi: J2, nMMstb: N, priPsi: PI,
    startPresPsi: PI, startNpMMstb: NP13, startGpMMscf: GP13,
    stepDays: 20, maxSteps: 64, pwfMode: 'fixed', minPwfPsi: 1050,
    abandonQoStbD: 10,
  });
  assert.ok(r.rows.length > 10, `rows ${r.rows.length}`);
  assert.ok(r.rows.every((x) => x.converged), 'all steps converged');
  const last = r.rows[r.rows.length - 1];
  assert.ok(last.presPsi < PI && last.presPsi > 500, `P declines: ${last.presPsi}`);
  assert.ok(last.npMMstb > NP13 && last.npMMstb < N, `Np grows: ${last.npMMstb}`);
  // pressure monotone non-increasing, rates positive
  for (let i = 1; i < r.rows.length; i++)
    assert.ok(r.rows[i].presPsi <= r.rows[i - 1].presPsi + 1e-6, 'P monotone');
  assert.ok(r.rows.every((x) => x.qOilStbD > 0), 'qo > 0');
});
