import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createAuthRepository } from '../src/server/auth-repository.js';
import { createAuthHttp, initializeAuthentication, tokenHash } from '../src/server/auth-http.js';

const issuer = 'https://issuer.example.test';
const origin = 'https://bldrz.example.test';
const uid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userA = uid(1), userB = uid(2), userP = uid(3);
const workspaceA = uid(11), workspaceB = uid(12), workspaceP = uid(13);
const rand = () => randomBytes(32).toString('base64url');
let db, repository, database;

before(async () => {
  db = new PGlite();
  const migrationDir = path.resolve(import.meta.dirname, '../db/migrations');
  for (const file of (await fs.readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await fs.readFile(path.join(migrationDir, file), 'utf8'));
  }
  for (const [user, subject, label] of [[userA, 'subject-A', 'A'], [userB, 'subject-B', 'B'], [userP, 'subject-P', 'P']]) {
    await db.query('INSERT INTO app.app_user(id,email,display_name) VALUES ($1,$2,$3)', [user, `${label}@example.test`, label]);
    await db.query('INSERT INTO app.auth_identity(id,user_id,provider,provider_subject) VALUES ($1,$2,$3,$4)',
      [uid(Number(user.slice(-2)) + 100), user, issuer, subject]);
  }
  await db.query(`INSERT INTO app.workspace(id,kind,name,slug,owner_user_id) VALUES
    ($1,'organization','Company A','a',NULL), ($2,'organization','Company B','b',NULL),
    ($3,'personal','Private P','p',$4)`, [workspaceA, workspaceB, workspaceP, userP]);
  for (const [user, workspace] of [[userA, workspaceA], [userB, workspaceB], [userP, workspaceP]]) {
    await db.query('INSERT INTO app.membership(workspace_id,user_id,role_key) VALUES ($1,$2,$3)', [workspace, user, 'owner']);
  }
  repository = createAuthRepository((text, values) => db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE wellsim_runtime');
    return tx.query(text, values);
  }));
  database = { enabled: true, auth: repository, withTenantTransaction: (context, operation) => db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE wellsim_runtime');
    await tx.query("SELECT set_config('app.user_id',$1,true), set_config('app.workspace_id',$2,true)",
      [context.userId, context.workspaceId ?? '']);
    const access = await tx.query("SELECT app.has_workspace_permission($1::uuid, 'workspace.read') AS allowed",
      [context.workspaceId ?? null]);
    if (access.rows[0]?.allowed !== true) throw Object.assign(new Error('denied'), { code: 'tenant_access_denied' });
    return operation(tx);
  }) };
});
beforeEach(async () => {
  await db.exec('TRUNCATE app.authentication_event, app.web_session, app.login_transaction');
  await db.exec("UPDATE app.app_user SET status='active'; UPDATE app.membership SET status='active', expires_at=NULL, role_key='owner'; UPDATE app.workspace SET status='active'");
});
after(async () => { await db?.close(); });

const cookiePair = (response, name) => [].concat(response.headers['set-cookie'] ?? [])
  .find((value) => value.startsWith(`${name}=`))?.split(';')[0];

async function dispatch(handler, url, { method = 'GET', headers = {}, body } = {}) {
  const response = { headers: {}, status: 0, text: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, values) { this.status = status; Object.assign(this.headers, values); },
    end(value = '') { this.text = value; },
  };
  response.handled = await handler({ url, method, headers, body }, response);
  if (response.text) response.json = JSON.parse(response.text);
  return response;
}
function handlerFor(subject = 'subject-A') {
  const provider = {
    async start() {
      const flow = { state: rand(), nonce: rand(), codeVerifier: rand() };
      return { flow, url: `${issuer}/authorize?state=${flow.state}` };
    },
    async finish() { return { issuer, subject }; },
  };
  return createAuthHttp({ settings: { enabled: true, origin }, provider, database });
}
async function signIn(subject = 'subject-A', previousCookie) {
  const handler = handlerFor(subject);
  const start = await dispatch(handler, '/auth/login');
  assert.equal(start.status, 303);
  const flowCookie = cookiePair(start, '__Host-bldrz_login');
  const state = new URL(start.headers.location).searchParams.get('state');
  const url = `/auth/callback?code=fixture-code&state=${state}`;
  const response = await dispatch(handler, url, { headers: { cookie: [flowCookie, previousCookie].filter(Boolean).join('; ') } });
  return { handler, start, flowCookie, url, response, cookie: cookiePair(response, '__Host-bldrz_session') };
}

test('session SQL exposes narrow definer functions, not identity tables or PUBLIC privileges', async () => {
  await repository.ready();
  for (const table of ['login_transaction', 'web_session', 'authentication_event']) {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE wellsim_runtime');
      await tx.query(`SELECT * FROM app.${table}`);
    }), { code: '42501' });
  }
  const publicAccess = await db.query(`SELECT has_function_privilege('public',
    'app.auth_create_session(text,text,text,text,text)', 'EXECUTE') AS allowed`);
  assert.equal(publicAccess.rows[0].allowed, false);
});

test('login flows are bounded, browser-bound, expire, and can be consumed only once', async () => {
  const flow = { state: rand(), nonce: rand(), codeVerifier: rand() };
  const hash = tokenHash(rand());
  assert.equal(await repository.createFlow(hash, flow), true);
  assert.equal(await repository.consumeFlow(tokenHash(rand())), undefined);
  assert.deepEqual(await repository.consumeFlow(hash), flow);
  assert.equal(await repository.consumeFlow(hash), undefined);
  await repository.createFlow(hash, flow);
  await db.exec("UPDATE app.login_transaction SET expires_at=statement_timestamp()-interval '1 second'");
  assert.equal(await repository.consumeFlow(hash), undefined);
  await db.query(`INSERT INTO app.login_transaction(token_hash,state,nonce,code_verifier)
    SELECT lpad(i::text,64,'0'),$1,$2,$3 FROM generate_series(1,1000) i`, [flow.state, flow.nonce, flow.codeVerifier]);
  assert.equal(await repository.createFlow(hash, flow), false);
});

test('session issuance requires exact provisioned issuer+subject and never auto-links accounts', async () => {
  const hash = tokenHash(rand());
  const csrf = 'c'.repeat(64);
  for (const identity of [{ issuer, subject: 'A@example.test' },
    { issuer: 'https://different.example.test', subject: 'subject-A' }, { issuer, subject: 'unknown' }]) {
    assert.equal(await repository.createSession(identity, hash, csrf, null), undefined);
  }
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM app.app_user')).rows[0].n, 3);
  assert.equal(await repository.createSession({ issuer, subject: 'subject-A' }, hash, csrf, null), userA);
  assert.equal((await repository.readSession(hash)).userId, userA);
  await db.query("UPDATE app.app_user SET status='disabled' WHERE id=$1", [userA]);
  assert.equal(await repository.readSession(hash), undefined);
  assert.equal(await repository.createSession({ issuer, subject: 'subject-A' }, tokenHash(rand()), csrf, null), undefined);
});

test('sessions rotate on sign-in, expire by idle/absolute time, and revoke on logout', async () => {
  const oldHash = tokenHash(rand()), newHash = tokenHash(rand());
  const identity = { issuer, subject: 'subject-A' };
  await repository.createSession(identity, oldHash, 'a'.repeat(64), null);
  await repository.createSession(identity, newHash, 'b'.repeat(64), oldHash);
  assert.equal(await repository.readSession(oldHash), undefined);
  assert.ok(await repository.readSession(newHash));
  await db.query("UPDATE app.web_session SET idle_expires_at=statement_timestamp()-interval '1 second' WHERE token_hash=$1", [newHash]);
  assert.equal(await repository.readSession(newHash), undefined);
  const third = tokenHash(rand());
  await repository.createSession(identity, third, 'c'.repeat(64), null);
  await db.query("UPDATE app.web_session SET expires_at=statement_timestamp()-interval '1 second' WHERE token_hash=$1", [third]);
  assert.equal(await repository.readSession(third), undefined);
  const fourth = tokenHash(rand());
  await repository.createSession(identity, fourth, 'd'.repeat(64), null);
  await repository.revokeSession(fourth);
  assert.equal(await repository.readSession(fourth), undefined);
  const events = await db.query('SELECT action FROM app.authentication_event');
  assert.ok(events.rows.some((r) => r.action === 'session.created'));
  assert.ok(events.rows.some((r) => r.action === 'session.revoked'));
  for (let i = 0; i < 12; i += 1) {
    await repository.createSession(identity, tokenHash(rand()), 'e'.repeat(64), null);
  }
  const active = await db.query('SELECT count(*)::integer AS n FROM app.web_session WHERE revoked_at IS NULL');
  assert.equal(active.rows[0].n, 10, 'per-user live sessions must stay bounded');
});

test('workspace discovery respects company/personal boundaries and immediate membership changes', async () => {
  for (const [subject, workspace] of [['subject-A', workspaceA], ['subject-B', workspaceB], ['subject-P', workspaceP]]) {
    const hash = tokenHash(rand());
    await repository.createSession({ issuer, subject }, hash, 'a'.repeat(64), null);
    assert.deepEqual((await repository.listWorkspaces(hash)).map((w) => w.id), [workspace]);
    await db.query("UPDATE app.membership SET status='suspended' WHERE workspace_id=$1", [workspace]);
    assert.deepEqual(await repository.listWorkspaces(hash), []);
    if (workspace !== workspaceP) {
      await db.query("UPDATE app.membership SET status='active', role_key='viewer' WHERE workspace_id=$1", [workspace]);
      assert.equal((await repository.listWorkspaces(hash))[0].role_key, 'viewer');
      await db.query("UPDATE app.membership SET expires_at=statement_timestamp()-interval '1 second' WHERE workspace_id=$1", [workspace]);
      assert.deepEqual(await repository.listWorkspaces(hash), []);
    }
  }
});

test('HTTP login sets secure opaque cookies and refuses missing/wrong/replayed browser state', async () => {
  const signed = await signIn();
  assert.equal(signed.response.status, 303);
  assert.equal(signed.response.headers.location, '/');
  for (const value of signed.response.headers['set-cookie']) {
    assert.match(value, /Path=\/; Secure; HttpOnly; SameSite=Lax/);
    assert.ok(!value.includes('Domain='));
  }
  assert.equal(signed.response.headers['cache-control'], 'no-store');
  const bearer = signed.cookie.split('=')[1];
  assert.equal((await db.query('SELECT token_hash FROM app.web_session')).rows[0].token_hash, tokenHash(bearer));
  const replay = await dispatch(signed.handler, signed.url, { headers: { cookie: signed.flowCookie } });
  assert.equal(replay.status, 400);
  assert.equal((await dispatch(signed.handler, signed.url)).status, 400);
  const start = await dispatch(signed.handler, '/auth/login');
  const flowCookie = cookiePair(start, '__Host-bldrz_login');
  const wrong = await dispatch(signed.handler, '/auth/callback?code=x&state=wrong', { headers: { cookie: flowCookie } });
  assert.equal(wrong.status, 400);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM app.login_transaction')).rows[0].n, 0);
  const unknown = await signIn('unknown');
  assert.equal(unknown.response.status, 403);
  assert.equal(unknown.cookie, undefined);
});

test('HTTP workspace reads derive identity only from session cookies, not request/body/header claims', async () => {
  const signed = await signIn();
  const headers = { cookie: signed.cookie };
  const listed = await dispatch(signed.handler, '/api/v2/workspaces', { headers });
  assert.deepEqual(listed.json.workspaces.map((w) => w.id), [workspaceA]);
  const own = await dispatch(signed.handler, '/api/v2/workspace', { headers: { ...headers, 'x-workspace-id': workspaceA } });
  assert.equal(own.status, 200);
  const cross = await dispatch(signed.handler, `/api/v2/workspace?userId=${userB}`, {
    headers: { ...headers, 'x-workspace-id': workspaceB, 'x-user-id': userB }, body: { userId: userB },
  });
  assert.equal(cross.status, 404);
  assert.deepEqual(cross.json, { error: 'not_found' });
  const forged = await dispatch(signed.handler, '/api/v2/workspaces', {
    headers: { authorization: `Bearer ${signed.cookie.split('=')[1]}`, 'x-user-id': userA },
  });
  assert.equal(forged.status, 401);
  const duplicate = await dispatch(signed.handler, '/auth/session', { headers: { cookie: `${signed.cookie}; ${signed.cookie}` } });
  assert.equal(duplicate.status, 401);
  await db.query("UPDATE app.membership SET status='removed' WHERE user_id=$1", [userA]);
  assert.deepEqual((await dispatch(signed.handler, '/api/v2/workspaces', { headers })).json.workspaces, []);
  assert.equal((await dispatch(signed.handler, '/api/v2/workspace', {
    headers: { ...headers, 'x-workspace-id': workspaceA },
  })).status, 404);
});

test('HTTP logout requires POST plus exact Origin and CSRF token, then invalidates the session', async () => {
  const signed = await signIn();
  const headers = { cookie: signed.cookie };
  const session = await dispatch(signed.handler, '/auth/session', { headers });
  assert.equal(session.json.user.id, userA);
  const csrf = session.json.csrfToken;
  assert.equal((await dispatch(signed.handler, '/auth/logout', { headers })).status, 405);
  for (const extra of [{}, { origin }, { origin: 'https://attacker.example.test', 'x-csrf-token': csrf },
    { origin, 'x-csrf-token': 'wrong' }, { origin, 'x-csrf-token': 'é'.repeat(64) }]) {
    assert.equal((await dispatch(signed.handler, '/auth/logout', {
      method: 'POST', headers: { ...headers, ...extra },
    })).status, 403);
  }
  assert.equal((await dispatch(signed.handler, '/auth/logout', {
    method: 'POST', headers: { ...headers, origin, 'x-csrf-token': csrf },
  })).status, 200);
  assert.equal((await dispatch(signed.handler, '/auth/session', { headers })).status, 401);
});

test('auth routes fail closed when disabled/unconfigured and sanitize backend/provider failures', async () => {
  const disabled = await initializeAuthentication({ enabled: false }, {});
  assert.equal((await dispatch(disabled, '/auth/login')).status, 404);
  assert.equal((await dispatch(disabled, '/api/v2/workspaces')).status, 404);
  assert.equal((await dispatch(disabled, '/api/oil/nodal')).handled, false);
  await assert.rejects(initializeAuthentication({ enabled: false }, { WELLSIM_AUTH_ENABLED: '1' }));
  const failure = 'secret-provider-token-and-database-password';
  const handler = createAuthHttp({ settings: { enabled: true, origin }, database,
    provider: { async start() { throw new Error(failure); } } });
  const result = await dispatch(handler, '/auth/login');
  assert.equal(result.status, 503);
  assert.ok(!result.text.includes(failure));
});
