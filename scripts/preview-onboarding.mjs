// Synthetic UI preview ONLY. No environment credentials, persistent database,
// external provider, or production server imports. Binds loopback exclusively.
// node scripts/preview-onboarding.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createAuthHttp, tokenHash } from '../src/server/auth-http.js';
import { createAuthRepository } from '../src/server/auth-repository.js';
import { createOnboardingRepository } from '../src/server/onboarding-repository.js';

const db = new PGlite();
const migrations = new URL('../db/migrations/', import.meta.url);
for (const file of (await fs.readdir(migrations)).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(await fs.readFile(new URL(file, migrations), 'utf8'));
}
const call = (text, values) => db.transaction(async (tx) => {
  await tx.exec('SET LOCAL ROLE wellsim_runtime'); return tx.query(text, values);
});
const auth = createAuthRepository(call), onboarding = createOnboardingRepository(call);
const token = randomBytes(32).toString('base64url'), hash = tokenHash(token);
await onboarding.signIn({ issuer: 'https://synthetic.example.test', subject: 'local-preview',
  email: 'preview@example.test', emailVerified: true }, hash, tokenHash('synthetic-csrf'), null);
await onboarding.profile(hash, 'Synthetic QA User');
await onboarding.createCompany(hash, 'Synthetic Petroleum Company');
const server = http.createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  // Explicit synthetic session injection lives ONLY in this local test harness.
  if (req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end(); return; }
  req.headers.cookie = `__Host-bldrz_session=${token}`;
  try {
    if (await createAuthHttp({ settings: { enabled: true, onboardingEnabled: true, origin },
      database: { auth, onboarding }, provider: {} })(req, res)) return;
    const route = req.url.split('?')[0];
    const assets = { '/': 'workspace.html', '/workspace.html': 'workspace.html', '/workspace.js': 'workspace.js',
      '/workspace.css': 'workspace.css', '/favicon.svg': 'favicon.svg' };
    const name = assets[route];
    if (!name) { res.writeHead(404); res.end(); return; }
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    res.setHeader('content-type', `${type}; charset=utf-8`);
    res.end(await fs.readFile(new URL(`../src/ui/${name}`, import.meta.url)));
  } catch { res.writeHead(500); res.end('Preview failed'); }
});
server.listen(0, '127.0.0.1', () => console.log(`Synthetic, ephemeral preview: http://127.0.0.1:${server.address().port}/workspace.html`));
async function stop() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await db.close(); }
process.on('SIGINT', () => stop().then(() => process.exit()));
process.on('SIGTERM', () => stop().then(() => process.exit()));
