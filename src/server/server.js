// wellsim UI server — Node built-in HTTP and opt-in PostgreSQL. Serves the
// static UI from src/ui and the JSON API from src/server/api.js.
// Run: node src/server/server.js   (PORT env overrides 3355)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handlers as apiHandlers } from './api.js';
import { accountHandlers } from './accounts.js';
import { initializeDatabase } from './database.js';
import { initializeAuthentication } from './auth-http.js';

let database;
try {
  database = await initializeDatabase();
} catch (error) {
  console.error(`Database startup failed: ${error.message}`);
  process.exit(1);
}
let authentication;
try {
  authentication = await initializeAuthentication(database);
} catch {
  console.error('Verified authentication startup failed');
  await database.close();
  process.exit(1);
}

// free version stays: every calculation endpoint is open; accounts only add
// the per-company server case database
const handlers = { ...apiHandlers, ...accountHandlers };

// rolling backup of the case database (data/ -> data-backups/<date>/, kept
// 14 days): guards against accidental deletion/corruption. Copy the backups
// folder offsite for real disaster protection.
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
function backupData() {
  try {
    const dataDir = process.env.WELLSIM_DATA_DIR ?? path.resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) return;
    const bakRoot = path.join(path.dirname(dataDir), 'data-backups');
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(bakRoot, stamp);
    if (existsSync(dest)) return; // one backup per day
    mkdirSync(dest, { recursive: true });
    cpSync(dataDir, dest, { recursive: true });
    const keep = readdirSync(bakRoot).sort().slice(0, -14);
    for (const old of keep) rmSync(path.join(bakRoot, old), { recursive: true, force: true });
    console.log(`data backup: ${dest}`);
  } catch (e) {
    console.error('data backup failed:', e.message);
  }
}
backupData();
setInterval(backupData, 6 * 60 * 60 * 1000).unref(); // re-check every 6 h

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// production hardening: sane security headers on every response, and cache
// policy for the static UI (HTML always revalidates; assets briefly cached).
// TLS/HSTS terminate at the platform or reverse proxy in front (see
// docs/deploy.md for the thepwf.net setup).
const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
  try {
    if (await authentication(req, res)) return;
    if (req.url.startsWith('/api/')) {
      const key = req.url.slice(5).split('?')[0];
      const h = handlers[key];
      if (!h) return send(res, 404, { error: `unknown endpoint ${key}` });
      const body = req.method === 'POST' ? await readBody(req) : '{}';
      let result;
      try {
        result = await h(body ? JSON.parse(body) : {});
      } catch (e) {
        result = { error: e.message };
      }
      return send(res, 200, result);
    }
    // Strip the query BEFORE testing for the root. Testing req.url === '/'
    // against a still-queried URL means '/?utm_source=x' falls through to
    // p = '/', which resolves to the DIRECTORY src/ui -> readFile EISDIR ->
    // HTTP 500. Any shared link carrying a tracking parameter broke the site.
    // The portable was fixed on 30 Aug 2026 (5349c2b); the website was not,
    // and its own access log caught it the hour logging was switched on.
    const q = req.url.split('?')[0];
    let p = q === '/' || q === '' ? '/index.html' : q;
    const file = path.resolve(path.join(UI_DIR, p));
    // startsWith(UI_DIR) on its own is a STRING test, so it also passes for a
    // SIBLING whose name merely begins with "ui" (src/ui-old, src/uix) — and
    // this project does keep spare copies of the UI around. Appending the
    // separator makes it a real containment check: only children of src/ui.
    if (file !== UI_DIR && !file.startsWith(UI_DIR + path.sep)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    const data = await readFile(file);
    const ext = path.extname(file);
    if (p.startsWith('/workspace.')) {
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    }
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': p.startsWith('/workspace.') ? 'no-store' : ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404);
      res.end('not found');
    } else {
      send(res, 500, { error: e.message });
    }
  }
});

const PORT = Number(process.env.PORT ?? 3355);
server.listen(PORT, () => {
  console.log(`wellsim UI on http://localhost:${PORT}`);
  console.log(`PostgreSQL boundary: ${database.enabled ? 'ready' : 'disabled'}`);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 20000).unref();
  try {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
    clearTimeout(deadline);
  } catch {
    process.exitCode = 1;
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
