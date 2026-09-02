// Native check with real application login, two independent bounded pools,
// shared sessions and a strictly named disposable database. No provider calls.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { initializeDatabase } from '../src/server/database.js';
import { tokenHash } from '../src/server/auth-http.js';

const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/bldrz_auth_probe', 'Auth verification requires the disposable probe');
const env = { ...process.env, WELLSIM_DATABASE_ENABLED: '1', WELLSIM_DB_LOGIN_ROLE: 'bldrz_app',
  WELLSIM_DB_RUNTIME_ROLE: 'bldrz_runtime', WELLSIM_DB_POOL_MAX: '2' };
const a = await initializeDatabase(env);
let b;
let aClosed = false;
const random = () => randomBytes(32).toString('base64url');
const issuer = 'https://issuer.example.test';
const wa = '10000000-0000-4000-8000-000000000010';
const wb = '20000000-0000-4000-8000-000000000020';
const wp = '30000000-0000-4000-8000-000000000030';
try {
  b = await initializeDatabase(env);
  await a.auth.ready(); await b.auth.ready();
  const flow = { state: random(), nonce: random(), codeVerifier: random() };
  const flowHash = tokenHash(random());
  assert.equal(await a.auth.createFlow(flowHash, flow), true);
  const consumed = await Promise.all([a.auth.consumeFlow(flowHash), b.auth.consumeFlow(flowHash)]);
  assert.equal(consumed.filter(Boolean).length, 1);
  assert.deepEqual(consumed.find(Boolean), flow);
  console.log('PASS concurrent callback consumption across independent pools');
  const hashes = [tokenHash(random()), tokenHash(random()), tokenHash(random())];
  const contexts = [];
  for (const [i, subject, workspaceId] of [[0, 'subject-A', wa], [1, 'subject-B', wb], [2, 'subject-P', wp]]) {
    assert.ok(await a.auth.createSession({ issuer, subject }, hashes[i], 'a'.repeat(64), null));
    const session = await b.auth.readSession(hashes[i]);
    assert.ok(session);
    assert.deepEqual((await b.auth.listWorkspaces(hashes[i])).map((w) => w.id), [workspaceId]);
    contexts.push({ userId: session.userId, workspaceId });
  }
  console.log('PASS shared server sessions and company/personal workspace discovery');
  await assert.rejects(a.withTenantTransaction({ ...contexts[0], workspaceId: wb }, () => {}),
    { code: 'tenant_access_denied' });
  await assert.rejects(b.withTenantTransaction({ ...contexts[1], workspaceId: wa }, () => {}),
    { code: 'tenant_access_denied' });
  const otherCase = '20000000-0000-4000-8000-000000000240';
  await a.withTenantTransaction(contexts[0], async (tx) => {
    assert.equal((await tx.query('SELECT * FROM app.engineering_case WHERE id=$1', [otherCase])).rows.length, 0);
    assert.equal((await tx.query('UPDATE app.engineering_case SET title=$1 WHERE id=$2', ['ILLEGAL', otherCase])).rowCount, 0);
  });
  await assert.rejects(a.withTenantTransaction(contexts[0], (tx) => tx.query(
    'INSERT INTO app.project_well(workspace_id,project_id,well_id,linked_by) VALUES ($1,$2,$3,$4)',
    [wa, '10000000-0000-4000-8000-000000000120', '20000000-0000-4000-8000-000000000260', contexts[0].userId],
  )), { code: '23503' });
  await assert.rejects(a.withTenantTransaction(contexts[0], (tx) => tx.query(
    'INSERT INTO app.export_item(workspace_id,id,export_job_id,case_id) VALUES ($1,$2,$3,$4)',
    [wa, '10000000-0000-4000-8000-000000000191', '10000000-0000-4000-8000-000000000170', otherCase],
  )), { code: '23503' });
  console.log('PASS verified-session cross-company reads/writes/links/exports denied');
  assert.equal(await a.auth.createSession({ issuer, subject: 'unknown' }, tokenHash(random()), 'a'.repeat(64), null), undefined);
  assert.equal(await a.auth.createSession({ issuer: 'https://wrong.example.test', subject: 'subject-A' }, tokenHash(random()), 'a'.repeat(64), null), undefined);
  await b.auth.revokeSession(hashes[0]);
  assert.equal(await a.auth.readSession(hashes[0]), undefined);
  assert.ok(await a.auth.readSession(hashes[1]));
  await a.close();
  aClosed = true;
  assert.ok(await b.auth.readSession(hashes[1]), 'sessions must survive process/pool replacement');
  console.log('PASS exact identity mapping, shared revocation and independent session lifetime');
  console.log('NATIVE_AUTH_VERIFICATION_OK');
} finally {
  if (!aClosed) await a.close();
  await b?.close();
}
