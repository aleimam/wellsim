// WellSim portable launcher — single-exe build (Node SEA).
// Serves the UI from embedded assets, exposes the full physics API, stores
// cases in a ./cases folder BESIDE the exe (USB-stick friendly, no accounts),
// picks a free port and opens the default browser.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { handlers as apiHandlers } from '../src/server/api.js';

let sea = null;
try {
  const req = typeof require !== 'undefined' ? require : createRequire(import.meta.url);
  const s = req('node:sea');
  if (s.isSea()) sea = s;
} catch { /* running from source */ }

const exeDir = sea
  ? path.dirname(process.execPath)
  : typeof __dirname !== 'undefined'
    ? path.resolve(__dirname, '..')
    : path.resolve(import.meta.dirname, '..');
const CASES_DIR = path.join(exeDir, 'cases');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const ASSETS = ['index.html', 'app.js', 'export.js', 'style.css', 'help.html', 'favicon.svg', 'vendor/plotly.min.js'];

// The web app installs a service worker so it works offline. The portable is
// already offline — everything it serves is inside the exe — and a worker here
// would be actively harmful: the program takes the first FREE port, so run to
// run it can be a different origin, leaving a registered worker and a cache
// stranded on every port it has ever used. app.js registers unconditionally,
// so the portable turns registration into a no-op before app.js loads rather
// than editing shared UI code for a case only this build has.
const NO_SERVICE_WORKER =
  '<script>/* portable build: no service worker — see portable/main.js */' +
  'if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.resolve();' +
  '</script>';

// The portable has no accounts: its case store is a plain `cases/` folder
// beside the exe, and this file serves cases/save|list|load|delete with no
// auth at all. But it serves the WEBSITE's header panel, and app.js only
// reaches a case store through its `acct` object — which nothing sets except
// a call to auth/login or auth/register, endpoints this build deliberately
// does not have. So every build up to and including 1.2 showed a Sign in form
// that answered "unknown endpoint auth/register" and never opened the panel:
// the cases/ folder README-PORTABLE.md promises was unreachable from the UI.
// Same class of bug as the Plotly one — behaviour that only ever existed in
// the uncommitted build tree. Found and fixed 31 Aug 2026.
//
// Fixed at SERVE TIME like the Plotly swap, so the website's account code is
// untouched: hand app.js a local session before it reads one. Guarded, in
// keeping with the app's rule that no storage access may ever break the UI.
const LOCAL_SESSION =
  '<script>/* portable build: no accounts — open the local case store directly */' +
  'try{var s=JSON.stringify({token:"portable",company:"local",username:"portable"});' +
  'var g=Storage.prototype.getItem;' +
  'Storage.prototype.getItem=function(k){return k==="wellsimAcct"?s:g.call(this,k);};' +
  '}catch(e){}' +
  '</script>';

// app.js loads at the end of <body> and calls acctUi() at top level, so this
// runs after the labels are written. Sign out is REMOVED rather than hidden:
// there is no account to sign out of, and clicking it would strand the panel
// behind a sign-in form until the next reload.
const LOCAL_LABELS =
  '<script>/* portable build: label the panel for a build with no accounts */' +
  'try{' +
  'document.getElementById("acct-who").textContent="Cases saved beside the program";' +
  'document.getElementById("acct-link").textContent="Cases";' +
  'document.getElementById("acct-save").textContent="Save case";' +
  'document.getElementById("acct-signout").remove();' +
  '}catch(e){}' +
  '</script>';

function readAsset(name) {
  if (!ASSETS.includes(name)) return null;
  const buf = sea
    ? Buffer.from(sea.getAsset(name))
    : fs.readFileSync(path.join(exeDir, 'src/ui', name));

  // The portable build has to work with NO internet — that is the whole point
  // of a single exe on a USB stick. The web app deliberately loads Plotly from
  // a CDN, so the portable must swap that tag for the embedded copy.
  //
  // Until 30 Aug 2026 that swap was a HAND EDIT to src/ui/index.html made only
  // in the build tree and never committed: builds 1.0 and 1.1 were offline-safe
  // by accident, and a rebuild from a clean checkout would have silently
  // shipped an exe that showed the whole UI and not one chart. Doing it here
  // keeps the web app on the CDN and makes the portable reproducibly offline.
  if (name === 'index.html')
    return Buffer.from(
      String(buf)
        .replace(/https:\/\/cdn\.plot\.ly\/plotly-[\d.]+\.min\.js/g, '/vendor/plotly.min.js')
        .replace('</head>', `${NO_SERVICE_WORKER}${LOCAL_SESSION}</head>`)
        .replace('</body>', `${LOCAL_LABELS}</body>`),
      'utf8'
    );
  return buf;
}

// ---- portable case store: no auth, one shared folder beside the exe ----
const slug = (s) =>
  String(s ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 60);

const portableCases = {
  'accounts/status': () => ({
    enabled: true,
    registrationEnabled: false,
    mode: 'portable',
  }),
  'cases/save': (b) => {
    const name = slug(b.name);
    if (!name) return { error: 'case name required' };
    if (!b.case || b.case.app !== 'WellSim') return { error: 'not a WellSim case' };
    fs.mkdirSync(CASES_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CASES_DIR, `${name}.json`),
      JSON.stringify({ name, savedBy: 'portable', savedAt: new Date().toISOString(), case: b.case }, null, 1)
    );
    return { ok: true, name, company: 'local' };
  },
  'cases/list': () => {
    let files = [];
    try { files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')); } catch { /* none yet */ }
    const cases = files.map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8'));
        return { name: j.name ?? f.replace(/\.json$/, ''), savedBy: j.savedBy ?? null, savedAt: j.savedAt ?? null };
      } catch { return { name: f.replace(/\.json$/, ''), savedBy: null, savedAt: null }; }
    }).sort((a, b2) => String(b2.savedAt).localeCompare(String(a.savedAt)));
    return { company: 'local', username: 'portable', cases };
  },
  'cases/load': (b) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(CASES_DIR, `${slug(b.name)}.json`), 'utf8'));
      return { name: j.name, savedBy: j.savedBy, savedAt: j.savedAt, case: j.case };
    } catch { return { error: `case "${slug(b.name)}" not found` }; }
  },
  'cases/delete': (b) => {
    try { fs.unlinkSync(path.join(CASES_DIR, `${slug(b.name)}.json`)); return { ok: true }; }
    catch { return { error: `case "${slug(b.name)}" not found` }; }
  },
};

const handlers = { ...apiHandlers, ...portableCases };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  try {
    if (req.url.startsWith('/api/')) {
      const key = req.url.slice(5).split('?')[0];
      const h = handlers[key];
      if (!h) return send(res, 404, { error: `unknown endpoint ${key}` });
      const body = req.method === 'POST' ? await readBody(req) : '{}';
      let result;
      try { result = h(body ? JSON.parse(body) : {}); } catch (e) { result = { error: e.message }; }
      return send(res, 200, result);
    }
    // strip the query BEFORE deciding this is the root: the old order tested
    // req.url === '/' against a still-queried URL, so http://localhost:PORT/?x
    // fell through to an empty asset name and 404'd the entire app
    const q = req.url.split('?')[0];
    let p = q === '/' || q === '' ? 'index.html' : q.slice(1);

    const data = readAsset(p);
    if (!data) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

function listenOnFreePort(start) {
  return new Promise((resolve, reject) => {
    let port = start;
    const attempt = () => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && port < start + 20) { port += 1; attempt(); }
        else reject(e);
      });
      server.listen(port, '127.0.0.1', () => resolve(port));
    };
    attempt();
  });
}

(async () => {
  const port = await listenOnFreePort(Number(process.env.PORT ?? 3355));
  const url = `http://localhost:${port}`;
  console.log('');
  console.log('  WellSim portable — running at ' + url);
  console.log('  Cases folder: ' + CASES_DIR);
  console.log('  Close this window to stop WellSim.');
  if (!process.env.WELLSIM_NO_OPEN) {
    execFile('cmd', ['/c', 'start', '', url], () => { /* browser opened */ });
  }
})();
