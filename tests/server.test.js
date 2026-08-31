// Static-file serving — the one part of the HTTP layer with a security
// decision in it. Everything else in tests/ exercises the calculation core
// directly; this suite starts the real server and speaks raw HTTP to it,
// because the defect it guards is only reachable through an un-normalised
// request path that no in-process call can reproduce.
//
// The guard was `file.startsWith(UI_DIR)`, a bare STRING comparison. A
// request for `/../uix/leak.txt` resolves to `src/uix/leak.txt`, which is a
// string prefix match on `src/ui` and was therefore served. Only three
// directories live under src/ today, so nothing leaked — but this project
// keeps spare copies of the UI around (backup/ui-pre-mobile-2026-08-27), and
// the day one of those lands in src/ as `ui-old` the whole folder goes on the
// internet. Fixed 31 Aug 2026 by comparing against UI_DIR + path.sep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

/** A port nobody is listening on right now. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * GET with the path sent EXACTLY as written — no client-side normalisation,
 * which is the whole point: a browser would collapse the `..` before sending.
 */
const rawGet = (port, rawPath) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

/** Start src/server/server.js and resolve once it reports its port. */
function startServer(port) {
  const child = spawn(process.execPath, ['src/server/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      // a data dir that does not exist: backupData() returns immediately, so
      // running the tests never writes into the real case database
      WELLSIM_DATA_DIR: path.join(os.tmpdir(), 'wellsim-test-no-such-data-dir'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error('server did not start in 10 s')), 10_000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('wellsim UI on')) {
        clearTimeout(fail);
        resolve(child);
      }
    });
    child.on('error', (e) => {
      clearTimeout(fail);
      reject(e);
    });
  });
}

test('static serving stays inside src/ui, and every real asset still loads', async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    // THE REGRESSION. A sibling whose name merely starts with "ui" must be
    // refused outright. 403 is the tell: the old string-prefix guard let this
    // path through to readFile and answered 404 (file not found) instead.
    for (const escape of ['/../uix/leak.txt', '/../ui-old/app.js', '/../uix/../uix/leak.txt']) {
      const res = await rawGet(port, escape);
      assert.equal(res.status, 403, `${escape} must be forbidden, got ${res.status}`);
    }

    // plain traversal out of src/ entirely — already refused, kept as cover
    for (const escape of ['/../server/api.js', '/../../package.json', '/../core/pvt/oil.js']) {
      const res = await rawGet(port, escape);
      assert.equal(res.status, 403, `${escape} must be forbidden, got ${res.status}`);
    }

    // and the guard must not have cost us the app: every asset index.html
    // actually asks for has to come back
    for (const asset of ['/', '/app.js', '/style.css', '/help.html', '/favicon.svg', '/sw.js', '/manifest.webmanifest']) {
      const res = await rawGet(port, asset);
      assert.equal(res.status, 200, `${asset} must be served, got ${res.status}`);
      assert.ok(res.body.length > 0, `${asset} came back empty`);
    }

    // the stamped form the browser really requests
    assert.equal((await rawGet(port, '/app.js?v=2026-08-30k')).status, 200);
  } finally {
    child.kill();
  }
});

test('the portable build opens straight into its local case store', async () => {
  // The portable has no accounts, but it serves the WEBSITE's header panel,
  // and app.js only reaches a case store through its `acct` object — set
  // nowhere except by auth/login or auth/register, which this build does not
  // have. Builds up to 1.2 therefore showed a Sign in form that answered
  // "unknown endpoint auth/register", leaving the cases/ folder beside the exe
  // unreachable from the UI. Same class as the Plotly bug: behaviour that only
  // existed in the uncommitted build tree. Fixed 31 Aug 2026 in portable/main.js.
  const port = await freePort();
  const child = spawn(process.execPath, ['portable/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), WELLSIM_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const fail = setTimeout(() => reject(new Error('portable did not start in 10 s')), 10_000);
      child.stdout.on('data', (d) => {
        if (String(d).includes('running at')) {
          clearTimeout(fail);
          resolve();
        }
      });
      child.on('error', (e) => {
        clearTimeout(fail);
        reject(e);
      });
    });

    const html = (await rawGet(port, '/')).body;
    // app.js reads this key at module load; without the shim `acct` stays null
    // and the case panel never opens
    assert.match(html, /wellsimAcct/, 'served HTML must hand app.js a local session');
    assert.match(html, /acct-signout"\)\.remove/, 'Sign out must be removed, not left to strand the panel');
    // and the two fixes that came before it must still be in place
    assert.match(html, /\/vendor\/plotly\.min\.js/, 'portable must serve the embedded Plotly');
    assert.ok(!/cdn\.plot\.ly/.test(html), 'portable must not reference the CDN');
    assert.match(html, /serviceWorker\.register/, 'portable must neuter service-worker registration');

    // the store the panel talks to answers WITHOUT a token...
    const list = JSON.parse((await rawGet(port, '/api/cases/list')).body);
    assert.equal(list.company, 'local');
    assert.ok(Array.isArray(list.cases), 'cases/list must return a list');
    // ...precisely because there is no auth in this build to get a token from
    const login = JSON.parse((await rawGet(port, '/api/auth/login')).body);
    assert.match(login.error ?? '', /unknown endpoint/, 'the portable deliberately has no auth');
  } finally {
    child.kill();
  }
});
