// Sweep every pump in every catalogue and ask one question: does the coupled
// ESP solve produce a WELL-BEHAVED VLP curve, or a disturbed one?
//
// Raised 3 Sep 2026 after NOV NHV3000M FL drew a broken-looking VLP at the ESP
// demo defaults. The demo's PI (2.7 @ 2650 psi) suits the demo's own pump; it
// does not suit a 123-pump catalogue spanning 150 to 27000 bpd. Judging a pump
// against a well it was never sized for measures the mismatch, not the pump.
//
// So each pump is given a well it can actually lift: the PI is retuned so the
// operating point lands near that pump's BEP, exactly as the report asked.
// Then the VLP is checked for the things that make a curve look "disturbed":
//
//   reversals   direction changes along the curve. A VLP is U-shaped, so ONE
//               is correct; more than one is a wobble.
//   nonFinite   NaN/Infinity points -- these break the line entirely.
//   overPri     points above the reservoir pressure. The chart pins its
//               pressure axis to [0, Pri], so these are drawn outside it and
//               appear as fragments entering and leaving the top edge.
//   converged   whether the coupled dP solve actually converged at every rate.
//
// Usage: node scripts/esp-catalogue-sweep.mjs [--json out.json] [--limit N]
import { oilEsp } from '../src/server/api.js';
import { ESP_PUMPS } from '../src/core/vlp/esp-catalog.js';
import { BORETS_2015_PUMPS } from '../src/core/vlp/esp-catalog-borets-2015.js';
import { SLB_REDA_2020_PUMPS } from '../src/core/vlp/esp-catalog-slb-2020.js';
import { NOVOMET_PUMPS } from '../src/core/vlp/esp-catalog-novomet.js';

// read the curves straight from the catalogues: probing with the demo PI
// fails for every pump the demo well is too big for, which is most of them
const SOURCES = [
  { source: 'workbook', pumps: ESP_PUMPS },
  { source: 'borets-2015', pumps: BORETS_2015_PUMPS },
  { source: 'slb-reda-2020', pumps: SLB_REDA_2020_PUMPS },
  { source: 'novomet', pumps: NOVOMET_PUMPS },
];

const argv = process.argv.slice(2);
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;

// The ESP demo well (Oil well model_ESP_V5.01), PI basis so J is ours to set.
const WELL = {
  thpPsi: '160', wcPct: '5', gorScfStb: '384', tubingIdIn: '2.992',
  roughness: '0.00006', topPerfAhM: '3240', devStartM: '1500', devAngleDeg: '0',
  api: '32', gasSg: '0.812', rsiScfStb: '384', tresF: '230', oilViscCp: '6',
  waterSg: '1.05', pbPsi: '', soilTempF: '90', htcBtu: '3', tubingOdIn: '3.5',
  cpBtu: '0.51', priPsi: '3550', prPsi: '2650', iprMode: 'pi', userPresPsi: '2650',
  permMd: '50', thicknessFt: '42.653', reFt: '1640.5', rwFt: '0.5104166667', skin: '0',
  matchHead: '1', matchFriction: '1',
  liftType: 'esp', espPumpMode: 'db', espStages: '145', espFreqHz: '50',
  pumpAhM: '2985', espSepEffPct: '95',
};
const PR = 2650;
const FREQ = 50;

const run = (pumpName, j) => {
  const q = String(Math.max(50, Math.round(j * (PR - 1200))));
  try {
    return oilEsp({ ...WELL, espPumpName: pumpName, userJ: String(j),
                    qOilStbD: q, testQOilStbD: q, testThpPsi: '160', testPwfPsi: '' });
  } catch (e) {
    return { error: e.message };
  }
};

/** The pump's own rate window at the run frequency (points 3/5/7 are the
 *  down-thrust, BEP and up-thrust markers; the affinity law scales them). */
function window(pump) {
  const fr = FREQ / pump.refFreqHz;
  return {
    down: pump.points[3].rateBpd * fr,
    bep: pump.points[5].rateBpd * fr,
    up: pump.points[7].rateBpd * fr,
  };
}

/** Retune the PI until the well delivers a rate this pump can handle.
 *  q ~ J*(Pr - Pwf), so scaling J by the rate ratio is a good Newton step. */
function tuneJ(pumpName, w) {
  const targetGross = w.bep;
  let j = Math.max(0.05, targetGross / (PR - 1200)); // first guess
  let best = null;
  for (let i = 0; i < 5; i++) {
    const r = run(pumpName, j);
    if (r.error || !(r.op?.qOilStbD > 0)) return { j, r, tuned: false };
    const gross = r.point?.qGrossPumpBpd ?? r.op.qOilStbD;
    if (!best || Math.abs(gross - targetGross) < Math.abs(best.gross - targetGross))
      best = { j, r, gross };
    if (gross > w.down && gross < w.up) return { j, r, tuned: true, gross };
    const ratio = targetGross / gross;
    if (!Number.isFinite(ratio) || ratio <= 0) break;
    j = j * Math.min(4, Math.max(0.25, ratio)); // damped, so one bad step cannot run away
  }
  return best ? { ...best, tuned: false } : { j, r: run(pumpName, j), tuned: false };
}

function inspect(vlp) {
  const pts = (vlp ?? []).filter((p) => p && typeof p.pwfPsi === 'number');
  const nonFinite = (vlp ?? []).filter((p) => !Number.isFinite(p?.pwfPsi)).length;
  let reversals = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d1 = pts[i].pwfPsi - pts[i - 1].pwfPsi;
    const d2 = pts[i + 1].pwfPsi - pts[i].pwfPsi;
    if (d1 * d2 < 0) reversals++;
  }
  const maxPwf = pts.length ? Math.max(...pts.map((p) => p.pwfPsi)) : null;
  return { n: pts.length, reversals, nonFinite, maxPwf, overPri: pts.filter((p) => p.pwfPsi > 3550).length };
}

const results = [];
let done = 0;
for (const src of SOURCES) {
  for (const pump of src.pumps) {
    const name = pump.name;
    if (done >= limit) break;
    done++;
    const w = window(pump);
    const { j, r, tuned, gross } = tuneJ(name, w);
    if (r.error) { results.push({ source: src.source, name, error: r.error, window: w }); continue; }
    results.push({
      source: src.source, name,
      window: { down: +w.down.toFixed(0), bep: +w.bep.toFixed(0), up: +w.up.toFixed(0) },
      tunedPI: +j.toFixed(4), tuned,
      qOil: +(r.op?.qOilStbD ?? 0).toFixed(0),
      qGross: +(gross ?? r.point?.qGrossPumpBpd ?? 0).toFixed(0),
      dpPsi: +(r.point?.dpPsi ?? 0).toFixed(0),
      headFt: +(r.point?.headFt ?? 0).toFixed(0),
      thrust: r.point?.thrust ?? '?',
      dpConverged: r.point?.dpConverged ?? null,
      vlp: inspect(r.vlpCurve),
    });
    if (done % 10 === 0) process.stderr.write(`  ...${done} pumps\n`);
  }
}

const bad = results.filter((r) => r.error || r.vlp?.nonFinite > 0 || r.vlp?.reversals > 1 || r.dpConverged === false);
console.log(`\nESP catalogue sweep — ${results.length} pumps\n`);
console.log(`  clean (one U-minimum, finite, converged) : ${results.length - bad.length}`);
console.log(`  needing attention                        : ${bad.length}`);
console.log(`  PI retuned into the pump's window        : ${results.filter((r) => r.tuned).length}`);
console.log(`  curves rising above Pri (3550 psi)       : ${results.filter((r) => r.vlp?.overPri > 0).length}\n`);
if (bad.length) {
  console.log('  pumps needing attention:');
  for (const b of bad)
    console.log(`    ${b.name.padEnd(22)} ${b.error ?? `reversals ${b.vlp.reversals}, nonFinite ${b.vlp.nonFinite}, converged ${b.dpConverged}`}`);
}
if (jsonOut) {
  const fs = await import('node:fs');
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
  console.log(`\n  full results -> ${jsonOut}`);
}
