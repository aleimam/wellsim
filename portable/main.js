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

const ASSETS = ['index.html', 'app.js', 'style.css', 'help.html', 'vendor/plotly.min.js'];

function readAsset(name) {
  if (!ASSETS.includes(name)) return null;
  if (sea) return Buffer.from(sea.getAsset(name));
  return fs.readFileSync(path.join(exeDir, 'src/ui', name));
}

// ---- portable case store: no auth, one shared folder beside the exe ----
const slug = (s) =>
  String(s ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 60);

const portableCases = {
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
    let p = (req.url === '/' ? '/index.html' : req.url.split('?')[0]).slice(1);
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
