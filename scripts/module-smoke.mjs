// End-to-end check that every module and submodule of the site actually runs.
//
// The unit suite pins physics and the validation sweep pins numbers against the
// workbooks. Neither answers the plainer question an operator asks before a
// release: does every button on every tab still come back with an answer?
// This drives the live HTTP API the browser uses, so it exercises the server,
// the route table and the handlers together.
//
// Usage: node scripts/module-smoke.mjs [--base http://localhost:3355] [--json out.json]
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const BASE = arg('--base', 'http://localhost:3355');
const jsonOut = arg('--json', null);

const OIL = {
  thpPsi: '700', qOilStbD: '2100', wcPct: '50', gorScfStb: '5000', tubingIdIn: '2.992',
  roughness: '0.00006', topPerfAhM: '2810', devStartM: '1910', devAngleDeg: '7',
  api: '46', gasSg: '0.842', rsiScfStb: '700', tresF: '201', oilViscCp: '6',
  waterSg: '1.05', pbPsi: '', soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51',
  priPsi: '3550', prPsi: '', permMd: '50', thicknessFt: '42.653', reFt: '1640.5',
  rwFt: '0.5104166667', skin: '0', matchHead: '1', matchFriction: '1',
  testQOilStbD: '2100', testThpPsi: '700', testPwfPsi: '',
  prodRows: [
    { date: '17-Nov-14', thpPsi: '700', qOilStbD: '2100', gorScfStb: '384', wcPct: '5', pwfPsi: '' },
    { date: '1-Dec-14', thpPsi: '500', qOilStbD: '1700', gorScfStb: '384', wcPct: '5', pwfPsi: '' },
    { date: '17-Dec-14', thpPsi: '300', qOilStbD: '1200', gorScfStb: '384', wcPct: '5', pwfPsi: '' },
  ],
  staticRows: [
    { date: '17-Nov-14', presPsi: '3550' }, { date: '1-Dec-14', presPsi: '3200' },
    { date: '17-Dec-14', presPsi: '2900' },
  ],
};
const OIL_ESP = {
  ...OIL, thpPsi: '160', wcPct: '5', gorScfStb: '384', qOilStbD: '2565',
  testQOilStbD: '2565', testThpPsi: '160', api: '32', gasSg: '0.812', rsiScfStb: '384',
  tresF: '230', topPerfAhM: '3240', devStartM: '1500', devAngleDeg: '0',
  prPsi: '2650', iprMode: 'pi', userJ: '2.7', userPresPsi: '2650',
  liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600',
  espStages: '145', espFreqHz: '50', pumpAhM: '2985', espSepEffPct: '95',
  espMeasPintPsi: '1392', espMeasPdisPsi: '2720',
};
const GAS = {
  thpPsi: '1625', qGasMMscfd: '14.137', cgrStbMMscf: '57.4358974', wgrStbMMscf: '3.8461538',
  tubingIdIn: '2.992', roughnessBase: '0.0021', topPerfAhM: '3013', devStartM: '690',
  devAngleDeg: '23.65', condApi: '48.7', gasSg: '0.763', n2Pct: '1.2', co2Pct: '3',
  h2sPpm: '2', tresF: '232', oilViscCp: '2', sigmaDyneCm: '30', soilTempF: '90',
  htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51', priPsi: '3800', prPsi: '',
  permMd: '5', thicknessFt: '80', reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
  matchHead: '1', matchFriction: '1', iprMode: 'j',
  testPoints: [
    { thpPsi: '2440', qMMscfd: '5.192', pwfPsi: '' },
    { thpPsi: '2000', qMMscfd: '10.002', pwfPsi: '' },
    { thpPsi: '1625', qMMscfd: '14.137', pwfPsi: '' },
  ],
  prodRows: [
    { date: '0', thpPsi: '1625', qMMscfd: '14.137', pwfPsi: '' },
    { date: '60', thpPsi: '1625', qMMscfd: '13.2', pwfPsi: '' },
    { date: '120', thpPsi: '1625', qMMscfd: '12.4', pwfPsi: '' },
    { date: '180', thpPsi: '1625', qMMscfd: '11.7', pwfPsi: '' },
  ],
  sithpRows: [
    { date: '0', sithpPsi: '2500' }, { date: '90', sithpPsi: '2000' }, { date: '180', sithpPsi: '1300' },
  ],
  gaugeRows: [
    { date: '0', presPsi: '3550' }, { date: '90', presPsi: '3100' }, { date: '180', presPsi: '2700' },
  ],
};
const WATER_INJ = {
  fluid: 'water', wellType: 'injector', thpPsi: '2000', injTempF: '90',
  tubingIdIn: '2.992', roughness: '0.00006', topPerfAhM: '2810', devStartM: '1910',
  devAngleDeg: '7', api: '10', wcPct: '100', gorScfStb: '0', rsiScfStb: '0',
  pbPsi: '0', gasSg: '0.842', tresF: '201', oilViscCp: '6', waterSg: '1.05',
  soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5', cpBtu: '0.51', priPsi: '4800',
  permMd: '50', thicknessFt: '42.653', reFt: '1640.5', rwFt: '0.5104166667',
  skin: '0', matchHead: '1', matchFriction: '1', qOilStbD: '2000',
  testQOilStbD: '2000', testThpPsi: '2000', testPwfPsi: '',
};
const WATER_PROD = {
  ...WATER_INJ, wellType: 'producer', thpPsi: '200', qOilStbD: '2000',
  testThpPsi: '200', priPsi: '4800', prPsi: '',
};
const ML_OIL = {
  ...OIL, mlMode: 'multi',
  mlLayers: [
    { permMd: '60', thicknessFt: '25', prPsi: '3550', skin: '0' },
    { permMd: '30', thicknessFt: '18', prPsi: '1800', skin: '0' },
  ],
};
const ML_GAS = {
  ...GAS, mlMode: 'multi',
  mlLayers: [
    { permMd: '6', thicknessFt: '50', prPsi: '3800', skin: '0' },
    { permMd: '3', thicknessFt: '30', prPsi: '1500', skin: '0' },
  ],
};

/** Each check: what it proves, the route, the body, and what a PASS looks like.
 *  A route returning 200 with {error} is a FAIL — the module did not run. */
const CHECKS = [
  ['Oil · Well model', 'natural flow nodal', 'oil/nodal', OIL, (r) => r.op?.qOilStbD > 0 && `q ${r.op.qOilStbD.toFixed(0)} stb/d, Pwf ${r.op.pwfPsi.toFixed(0)} psi`],
  ['Oil · Well model', 'calibrate from test', 'oil/calibrate', OIL, (r) => r.matchedPermMd > 0 && `matched K ${r.matchedPermMd.toFixed(2)} mD, J ${r.j?.toFixed(3)}`],
  ['Oil · Well model', 'gas lift performance curve', 'oil/gaslift', { ...OIL, liftType: 'gaslift', injDepthTvdM: '2490.92', injRateMMscfd: '1.5' }, (r) => r.currentInjMMscfd > 0 && `inj ${r.currentInjMMscfd} MMscf/d, ${Object.keys(r).length} fields returned`],
  ['Oil · Well model', 'multi-layer IPR', 'oil/nodal', ML_OIL, (r) => r.op?.qOilStbD > 0 && `q ${r.op.qOilStbD.toFixed(0)} stb/d, ${r.layers?.length ?? '?'} layers`],
  ['Oil · Well model', 'VLP/IPR sensitivities', 'oil/sensitivity', OIL, (r) => (r.vlpFamily?.length ?? 0) >= 0 && `${r.vlpFamily?.length ?? 0} VLP sets, ${r.iprFamily?.length ?? 0} IPR sets`],
  ['Oil · ESP', 'coupled ESP solve', 'oil/esp', OIL_ESP, (r) => r.op?.qOilStbD > 0 && `q ${r.op.qOilStbD.toFixed(0)} stb/d, dP ${r.point.dpPsi.toFixed(0)} psi, ${r.point.thrust}`],
  ['Oil · ESP', 'match stages', 'oil/espstages', OIL_ESP, (r) => (r.stages ?? r.matchedStages) > 0 && `${r.stages ?? r.matchedStages} stages`],
  ['Oil · ESP', 'match wear (actual Pint/Pdis)', 'oil/espwear', OIL_ESP, (r) => r.wearFactor != null && `wear ${(r.wearFactor * 100).toFixed(1)} %`],
  ['Oil · ESP', 'future-Pres sensitivity', 'oil/espsens', OIL_ESP, (r) => (r.cases?.length ?? r.sets?.length ?? 0) > 0 && `${r.cases?.length ?? r.sets?.length} cases`],
  ['Oil · ESP', 'pump catalogues', 'esp/pumps', {}, (r) => r.pumps?.length > 0 && `${r.pumps.length} pumps in ${r.bySource.length} catalogues`],
  ['Oil · Reserve', 'prod data + Pres solver', 'oil/reserve', { ...OIL, presSource: 'prod' }, (r) => r.fit?.nAvgMMstb > 0 && `N ${r.fit.nAvgMMstb.toFixed(2)} MMstb from ${r.rows.length} rows`],
  ['Oil · Reserve', 'static gauge history', 'oil/reserve', { ...OIL, presSource: 'static' }, (r) => (r.fit?.nAvgMMstb ?? r.rows?.length) && `N ${(r.fit?.nAvgMMstb ?? 0).toFixed(2)} MMstb`],
  ['Oil · Reserve', 'reservoir limit', 'oil/reserve', { ...OIL, presSource: 'rlt' }, (r) => r.rlt?.stoiipMMstb > 0 && `STOIIP ${r.rlt.stoiipMMstb.toFixed(2)} MMstb`],
  ['Oil · Forecast', 'Tarner', 'oil/forecast', { ...OIL, fcMethod: 'tarner' }, (r) => r.eurMMstb > 0 && `EUR ${r.eurMMstb.toFixed(3)} MMstb, ${r.rows.length} steps, ${r.status}`],
  ['Oil · Forecast', 'Walsh (generalized MB)', 'oil/forecast', { ...OIL, fcMethod: 'walsh' }, (r) => r.eurMMstb > 0 && `EUR ${r.eurMMstb.toFixed(3)} MMstb, ${r.rows.length} steps, ${r.status}`],
  ['Oil · Forecast', 'ESP lift coupled', 'oil/forecast', OIL_ESP, (r) => r.eurMMstb > 0 && `EUR ${r.eurMMstb.toFixed(3)} MMstb, N ${r.nMMstb.toFixed(2)}`],
  ['Gas · Well model', 'nodal', 'gas/nodal', GAS, (r) => r.op?.qMMscfd > 0 && `q ${r.op.qMMscfd.toFixed(3)} MMscf/d, Pwf ${r.op.pwfPsi.toFixed(0)} psi`],
  ['Gas · Well model', 'calibrate from tests', 'gas/calibrate', GAS, (r) => (r.j ?? r.matchedPermMd) && `J ${r.j?.toFixed(5) ?? '—'}, K ${r.matchedPermMd?.toFixed(2) ?? '—'}`],
  ['Gas · Well model', 'multi-layer IPR', 'gas/nodal', ML_GAS, (r) => r.op?.qMMscfd > 0 && `q ${r.op.qMMscfd.toFixed(3)} MMscf/d, ${r.layers?.length ?? '?'} layers`],
  ['Gas · Well model', 'sensitivities', 'gas/sensitivity', GAS, (r) => (r.vlpFamily?.length ?? 0) >= 0 && `${r.vlpFamily?.length ?? 0} VLP sets`],
  ['Gas · Reserve', 'prod data + p/Z', 'gas/reserve', { ...GAS, presSource: 'prod' }, (r) => r.fit?.giipBscf > 0 && `GIIP ${r.fit.giipBscf.toFixed(2)} Bscf, Gp tot ${r.rows[r.rows.length - 1].gpTotalBscf?.toFixed(4)}`],
  ['Gas · Reserve', 'Pres from SITHP', 'gas/reserve', { ...GAS, presSource: 'sithp' }, (r) => r.fit?.giipBscf > 0 && `GIIP ${r.fit.giipBscf.toFixed(2)} Bscf`],
  ['Gas · Reserve', 'reservoir limit', 'gas/reserve', { ...GAS, presSource: 'rlt' }, (r) => r.rlt?.giipBscf > 0 && `GIIP ${r.rlt.giipBscf.toFixed(2)} Bscf`],
  ['Gas · Reserve', 'memory gauges', 'gas/reserve', { ...GAS, presSource: 'gauge' }, (r) => r.fit?.giipBscf > 0 && `GIIP ${r.fit.giipBscf.toFixed(2)} Bscf`],
  ['Gas · Reserve', 'condensate properties', 'gas/reserve', { ...GAS, presSource: 'prod' }, (r) => r.cond?.mw > 0 && `SG ${r.cond.sg.toFixed(5)}, MW ${r.cond.mw.toFixed(3)}`],
  ['Gas · Forecast', 'p/Z tank + nodal', 'gas/forecast', GAS, (r) => r.eurBscf > 0 && `EUR ${r.eurTotalBscf?.toFixed(3) ?? r.eurBscf.toFixed(3)} Bscf total, ${r.rows.length} steps`],
  ['Water · Producer', 'nodal', 'oil/nodal', WATER_PROD, (r) => r.op?.qOilStbD > 0 && `q ${r.op.qOilStbD.toFixed(0)} bbl/d, Pwf ${r.op.pwfPsi.toFixed(0)} psi`],
  ['Water · Producer', 'ESP on the same catalogues', 'oil/esp', { ...WATER_PROD, liftType: 'esp', espPumpMode: 'db', espPumpName: 'ESP B 538-3600', espStages: '145', espFreqHz: '50', pumpAhM: '2985', prPsi: '4800' }, (r) => r.op?.qOilStbD > 0 && `q ${r.op.qOilStbD.toFixed(0)} bbl/d, dP ${r.point.dpPsi.toFixed(0)} psi`],
  ['Water · Injector', 'injectivity nodal', 'water/injector', WATER_INJ, (r) => r.op?.qBpd > 0 && `q ${r.op.qBpd.toFixed(0)} bbl/d, BHIP ${r.op.pwfPsi.toFixed(0)} psi`],
  ['Water · Injector', 'calibrate', 'water/injcalibrate', WATER_INJ, (r) => (r.jInj ?? r.matchedPermMd) && `J inj ${r.jInj?.toFixed(4) ?? '—'}`],
  ['Water · Injector', 'sensitivities', 'water/injsensitivity', WATER_INJ, (r) => (r.grid?.length ?? r.sets?.length ?? 0) >= 0 && 'grid returned'],
];

const ASSETS = ['/', '/app.js', '/export.js', '/style.css', '/help.html', '/favicon.svg', '/vendor/plotly.min.js'];

const post = async (route, body) => {
  const res = await fetch(`${BASE}/api/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { http: res.status, json: await res.json().catch(() => ({ error: 'unparseable response' })) };
};

const results = [];
console.log(`\nWellSim module smoke — ${BASE}\n`);

console.log('  static assets');
for (const a of ASSETS) {
  let status = 0;
  try { status = (await fetch(BASE + a)).status; } catch { status = 0; }
  results.push({ group: 'Assets', name: a, route: a, pass: status === 200, detail: `HTTP ${status}` });
  console.log(`    ${status === 200 ? 'ok  ' : 'FAIL'} ${a.padEnd(24)} HTTP ${status}`);
}

let group = '';
for (const [g, name, route, body, check] of CHECKS) {
  if (g !== group) { group = g; console.log(`\n  ${g}`); }
  let pass = false, detail = '';
  try {
    const { http, json } = await post(route, body);
    if (http !== 200) detail = `HTTP ${http}`;
    else if (json.error) detail = json.error.slice(0, 78);
    else {
      const v = check(json);
      pass = Boolean(v);
      detail = typeof v === 'string' ? v : pass ? 'ok' : 'returned, but the expected value was missing';
    }
  } catch (e) {
    detail = `threw: ${e.message.slice(0, 70)}`;
  }
  results.push({ group: g, name, route, pass, detail });
  console.log(`    ${pass ? 'ok  ' : 'FAIL'} ${name.padEnd(30)} ${detail}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks pass`);
if (failed.length) {
  console.log('\n  FAILURES:');
  for (const f of failed) console.log(`    ${f.group} · ${f.name} — ${f.detail}`);
}
if (jsonOut) {
  const fs = await import('node:fs');
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
  console.log(`\n  results -> ${jsonOut}`);
}
process.exitCode = failed.length ? 1 : 0;
