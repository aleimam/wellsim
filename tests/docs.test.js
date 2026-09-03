// Documentation is part of the deliverable: the workbooks are the
// specification, and the manual is how a user learns what was ported. These
// checks catch the drift that kept appearing — stale test counts, references
// to features that were removed, and claims about the code that stopped being
// true. They read the docs and the source, never a hardcoded expectation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// help.html is the same reference as the markdown docs, but its numbers sit
// inside markup (<b>216</b> regression tests). Strip tags before matching, or
// the guard cannot see them — which is exactly how the manual's headline chip
// sat at 196 while the suite grew past 200. Widened 31 Aug 2026.
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const DOCS = [
  'README.md',
  'README-PORTABLE.md', // left out until 31 Aug 2026 — that is how "201-test suite" survived
  'HANDOVER.md',
  'docs/user-guide.md',
  'src/ui/help.html',
];

/** Every test( call across the suite — what `node --test` will report. */
function actualTestCount() {
  return fs
    .readdirSync(path.join(root, 'tests'))
    .filter((f) => f.endsWith('.test.js'))
    .reduce((n, f) => n + (read(`tests/${f}`).match(/^test\(/gm) ?? []).length, 0);
}

test('docs quote the real test count', () => {
  const actual = actualTestCount();
  for (const doc of DOCS) {
    const text = read(doc);
    const scan = text + stripTags(text);
    // any "<n> tests" claim in a doc must be the real number
    for (const m of scan.matchAll(/(\d{2,4})\s+(?:unit \+ regression |regression |unit )?tests\b/g)) {
      assert.equal(
        Number(m[1]),
        actual,
        `${doc} claims "${m[0]}" but the suite has ${actual} tests`
      );
    }
  }
});

test('docs quote the real number of test FILES', () => {
  // the test count was guarded and the file count was not, so "25 test files"
  // sat in the handover while the suite had 24 — the same drift, one line up
  const actual = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.js')).length;
  for (const doc of DOCS) {
    const text = read(doc);
    // two shapes are in use: "25 test files" in prose, and "tests/   25 files"
    // in the handover's tree diagram. The second drifted unguarded until
    // 31 Aug 2026 — sitting wrong one line above the count that WAS guarded.
    for (const re of [/(\d{1,3})\s+test files\b/g, /^tests\/\s+(\d{1,3})\s+files\b/gm]) {
      for (const m of text.matchAll(re)) {
        assert.equal(Number(m[1]), actual, `${doc} claims "${m[0].trim()}" but tests/ holds ${actual}`);
      }
    }
  }
});

test('docs quote the real validation-sweep size', () => {
  const sweep = read('scripts/validation-sweep.mjs');
  // the sweep prints "<pass>/<total> PASS"; the total is rows.length
  const rows = (sweep.match(/^\s{2}\{ *m: /gm) ?? []).length;
  for (const doc of DOCS) {
    for (const m of read(doc).matchAll(/(\d{1,3})\s*\/\s*(\d{1,3})\s+(?:validation sweep|PASS)/g)) {
      assert.equal(m[1], m[2], `${doc}: sweep claim "${m[0]}" is not all-passing`);
      if (rows > 0)
        assert.equal(Number(m[2]), rows, `${doc} claims ${m[2]} sweep cases, the script has ${rows}`);
    }
  }
});

test('docs do not describe endpoints that no longer exist', () => {
  const api = read('src/server/api.js');
  const routes = [...api.matchAll(/'([a-z]+\/[a-zA-Z]+)':/g)].map((m) => m[1]);
  assert.ok(routes.length > 10, 'route table not found');
  for (const doc of DOCS) {
    const text = read(doc);
    // a doc naming an api path must name one that is wired
    for (const m of text.matchAll(/\b(oil|gas|water|esp)\/([a-zA-Z]+)\b/g)) {
      const ref = `${m[1]}/${m[2]}`;
      if (/^(oil|gas|water)\/(well|excel)$/.test(ref)) continue; // prose, not a route
      if (!routes.includes(ref)) continue; // not every slash pair is a route reference
      assert.ok(routes.includes(ref), `${doc} references removed endpoint ${ref}`);
    }
  }
});

test('the portable build recipe is in the repo, not only on a USB stick', () => {
  // it lived solely on the backup drive until 30 Aug 2026: losing the stick
  // meant losing the ability to rebuild WellSim.exe at all
  for (const f of [
    'portable/main.js',
    'portable/strip-signature.js',
    'sea-config.json',
    'build.ps1',
    'src/ui/vendor/plotly.min.js',
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} must be committed`);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.devDependencies?.esbuild, 'esbuild pinned for the portable build');
  assert.ok(pkg.devDependencies?.postject, 'postject pinned for the portable build');
  // the SEA config must reference assets that actually exist
  const sea = JSON.parse(read('sea-config.json'));
  for (const src of Object.values(sea.assets ?? {}))
    assert.ok(fs.existsSync(path.join(root, src)), `sea-config asset missing: ${src}`);
});

test('the service-worker cache version tracks the asset stamp', () => {
  // a worker whose cache key never changes serves an old index.html forever,
  // pinning users to an old bundle and defeating the stamp entirely
  const stamp = read('src/ui/index.html').match(/app\.js\?v=([0-9a-z-]+)/)?.[1];
  assert.ok(stamp, 'asset stamp not found in index.html');
  const sw = read('src/ui/sw.js');
  const cacheV = sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.equal(cacheV, stamp, 'sw.js CACHE_VERSION must equal the index.html asset stamp');
  // a cached calculation is worse than no calculation
  assert.ok(sw.includes("pathname.startsWith('/api/')"), 'sw must bypass /api/');
  assert.ok(/network first/i.test(sw), 'HTML must be network-first');
});

test('the portable build serves Plotly from the embedded copy, not the CDN', () => {
  // builds 1.0 and 1.1 were offline-safe only because src/ui/index.html had
  // been hand-edited in the build tree and never committed — a rebuild from a
  // clean checkout would have shipped an exe with the whole UI and no charts
  const main = read('portable/main.js');
  // the host appears inside a regex literal there, so compare with the
  // backslashes stripped rather than trying to match them
  assert.ok(
    main.includes("'/vendor/plotly.min.js'") && main.replace(/\\/g, '').includes('cdn.plot.ly'),
    'portable/main.js must rewrite the CDN Plotly tag to the embedded asset'
  );
  const sea = JSON.parse(read('sea-config.json'));
  assert.ok(sea.assets?.['vendor/plotly.min.js'], 'the vendored Plotly must be embedded in the exe');

  // and the swap has to be version-identical, or the portable quietly runs a
  // different Plotly than the web app it is supposed to mirror
  const wanted = read('src/ui/index.html').match(/cdn\.plot\.ly\/plotly-([\d.]+)\.min\.js/)?.[1];
  assert.ok(wanted, 'index.html should still name a CDN Plotly version');
  const fd = fs.openSync(path.join(root, 'src/ui/vendor/plotly.min.js'), 'r');
  const head = Buffer.alloc(200);
  fs.readSync(fd, head, 0, 200, 0);
  fs.closeSync(fd);
  const shipped = head.toString('utf8').match(/plotly\.js v([\d.]+)/)?.[1];
  assert.equal(shipped, wanted, `vendored Plotly is v${shipped}, index.html asks for v${wanted}`);
});

// ---- pressure axes never show negative pressure ----
// Pressure is absolute: an axis dipping below zero states something that
// cannot exist. Nine pressure axes were left on Plotly autorange — including
// the MAIN nodal chart on all three tabs and the reservoir-limit charts,
// whose fitted slope line genuinely extrapolates below 0. Floored centrally
// in plot() on 31 Aug 2026 so the rule also holds for charts not yet written.
//
// floorPressureAxes is UI code with no module system, so it is read out of
// app.js and evaluated — the same trick keeps this honest about the shipped
// source rather than a copy.
test('every pressure axis is floored at zero, whatever the data does', () => {
  const src = fs.readFileSync(path.join(root, 'src/ui/app.js'), 'utf8');
  // CRLF-tolerant. A fresh clone gets CRLF under core.autocrlf, and a regex
  // anchored on a bare-LF closing brace silently fails to match there. This
  // test passed in a working tree whose app.js happened to be LF and FAILED
  // on a clean clone — found by a restore drill on 1 Sep 2026.
  const m = src.match(/function floorPressureAxes[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(m, 'floorPressureAxes must exist in app.js');
  const floorPressureAxes = new Function(m[0] + '; return floorPressureAxes;')();

  // a pressure axis on autorange gets pinned to [0, max]
  const nodal = floorPressureAxes({ yaxis: { title: 'Pressure, psi' } }, [{ y: [3550, 2000, 500] }]);
  assert.equal(nodal.yaxis.range[0], 0);

  // THE POINT: negative data must not drag the axis below zero
  const rlt = floorPressureAxes({ yaxis: { title: 'Pwf, psi' } }, [{ y: [2600, 1200, -450] }]);
  assert.equal(rlt.yaxis.range[0], 0, 'a slope extrapolating below 0 must not open a negative axis');

  // pressure on the X axis (the traverse charts)
  const trav = floorPressureAxes(
    { xaxis: { title: 'Pressure, psi' }, yaxis: { title: 'Depth TVD, ft', autorange: 'reversed' } },
    [{ x: [160, 900, 2600], y: [0, 5000, 9000] }]
  );
  assert.equal(trav.xaxis.range[0], 0);
  assert.equal(trav.yaxis.range, undefined, 'the reversed depth axis must be left alone');

  // secondary axis reads its OWN traces, not the primary's
  const fc = floorPressureAxes({ yaxis2: { title: 'Pres, psi' } }, [
    { y: [99999] },
    { y: [3550, 900], yaxis: 'y2' },
  ]);
  assert.ok(fc.yaxis2.range[1] < 5000, `y2 must scale to its own data, got ${fc.yaxis2.range[1]}`);

  // an axis that pins its own range keeps it (the sensitivity charts use [0, Pri])
  const pinned = floorPressureAxes({ yaxis: { title: 'Pressure, psi', range: [0, 3550] } }, [{ y: [9999] }]);
  assert.deepEqual(pinned.yaxis.range, [0, 3550]);

  // non-pressure axes are untouched
  for (const t of ['WHT, °F', 'Head, ft', 'Rate stb/d · GOR scf/stb', 'Depth TVD, ft']) {
    const o = floorPressureAxes({ yaxis: { title: t } }, [{ y: [-5, 100] }]);
    assert.equal(o.yaxis.range, undefined, `${t} must not be floored`);
  }
});

test('no chart layout leaves a pressure axis on bare autorange', () => {
  // the guard above only works if plot() actually applies it
  const src = fs.readFileSync(path.join(root, 'src/ui/app.js'), 'utf8');
  assert.match(
    src,
    /Plotly\.newPlot\([^)]*floorPressureAxes\(/,
    'plot() must route its layout through floorPressureAxes'
  );
});

// The IPR/VLP rate axis must start at zero: a well does not make a negative
// rate, and before this the axis ran left of zero whenever a multi-layer
// crossflow curve went negative, squeezing the entire operating range into
// the right half of the plot. Guarded here because it is a single property of
// one shared helper that four charts depend on (oil natural, oil ESP, water
// injection, gas).
test('the IPR/VLP rate axis is floored at zero', () => {
  const src = fs.readFileSync(path.join(root, 'src/ui/app.js'), 'utf8');
  const m = src.match(/function plotNodal[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(m, 'plotNodal must exist in app.js');
  assert.match(
    m[0],
    /xaxis:\s*\{[^}]*rangemode:\s*'nonnegative'/,
    "plotNodal's x axis must set rangemode 'nonnegative' so the rate axis starts at 0"
  );
});

// Proprietary vendor material must never reach the remote. github.com/aleimam/
// wellsim is PUBLIC, and "ESP PUMPS DATA Base/" holds Borets, APC and Levare
// catalogues -- the Borets one carries a notice on its first page forbidding
// reproduction or distribution. .gitignore already excludes them, but an
// ignore rule is a default, not a guarantee: `git add -f`, a new tool, or a
// rule edited in good faith all bypass it silently. This asserts the actual
// index, which is the thing that gets pushed. Added 2 Sep 2026.
test('no proprietary vendor material is tracked by git', async () => {
  const { execFileSync } = await import('node:child_process');
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
  } catch {
    return; // no git available (a tarball export) -- nothing to assert against
  }

  const forbiddenDir = /^(ESP PUMPS DATA Base|oil excel|gas excel|training slids)\//i;
  const forbiddenExt = /\.(pdf|xls|xlsx|xlsm|pptx|docx)$/i;

  const badDir = tracked.filter((f) => forbiddenDir.test(f));
  assert.deepEqual(
    badDir,
    [],
    `proprietary source directories must not be tracked: ${badDir.join(', ')}`
  );

  const badExt = tracked.filter((f) => forbiddenExt.test(f));
  assert.deepEqual(
    badExt,
    [],
    `vendor documents and workbooks must not be tracked: ${badExt.join(', ')}`
  );
});

// Pump selection is two-step: pick a catalogue, then pick from THAT catalogue.
// The catalogue is DERIVED from the pump name, never stored in the case — so a
// case saved before catalogues existed still restores. That derivation is
// load-bearing: applyCase sets selects with `el.value = v`, and assigning a
// value that is not among the current options leaves the select EMPTY rather
// than erroring, so the pump would vanish silently. Added 3 Sep 2026.
test('the pump selector filters by catalogue and can recover any pump', () => {
  const html = read('src/ui/index.html');
  const app = read('src/ui/app.js');

  for (const prefix of ['oil', 'water']) {
    assert.match(html, new RegExp(`id="${prefix}-espCatalogSel"`), `${prefix} needs a catalogue selector`);
    assert.match(html, new RegExp(`id="${prefix}-espPumpSel"`), `${prefix} needs a pump selector`);
  }

  // the pump list is built from ONE catalogue, not all of them
  assert.match(app, /function fillPumpSel\(/, 'fillPumpSel must exist');
  assert.match(
    app,
    /ESP_SOURCES\.find\(\(s\) => s\.source === cat\?\.value\)/,
    'the pump list must come from the selected catalogue only'
  );

  // Manual dP and Custom pump are not catalogue entries and must survive a switch
  const fill = app.slice(app.indexOf('function fillPumpSel('));
  assert.match(fill.slice(0, 1200), /__manual/, 'Manual dP must stay available in every catalogue');
  assert.match(fill.slice(0, 1200), /__custom/, 'Custom pump must stay available in every catalogue');

  // restoring a case must re-point the selectors from the saved pump name
  assert.match(app, /function setPumpSelection\(/, 'setPumpSelection must exist');
  assert.match(
    app,
    /const saved = c\.selects\?\.\[`\$\{p\}-espPumpSel`\];\s*\n\s*if \(saved\) setPumpSelection\(p, saved\);/,
    'applyCase must re-point both pump selectors from the saved name'
  );
});

// Every gas reserve route's table declares the condensate columns. The values
// are pinned in gas-reserve.test.js; this pins that the UI actually SHOWS
// them on all four routes, since each route builds its table by hand and one
// was easy to miss. Rate columns only where a row has a rate (prod, RLT).
test('all four gas reserve tables carry the condensate columns', () => {
  const app = fs.readFileSync(path.join(root, 'src/ui/app.js'), 'utf8');
  const tables = {
    "title: 'prod_data (solver outputs)'": { cum: true, rate: true },
    "title: 'Reservoir limit'": { cum: true, rate: true },
    "title: 'SITHP → Pres → p/Z'": { cum: true, rate: false },
    "title: 'Memory gauges → p/Z'": { cum: true, rate: false },
  };
  for (const [title, want] of Object.entries(tables)) {
    const i = app.indexOf(title);
    assert.ok(i >= 0, `${title} must exist`);
    const headerLine = app.slice(i, app.indexOf('\n', i));
    assert.ok(headerLine.includes("'Cond cum MMstb'"), `${title} must show the condensate cumulative`);
    assert.equal(headerLine.includes("'Cond STB/d'"), want.rate, `${title} rate column ${want.rate ? 'missing' : 'should not be there (survey rows have no rate)'}`);
  }
});
