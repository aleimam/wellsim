import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { createOnboardingRepository } from '../src/server/onboarding-repository.js';
import { createAuthRepository } from '../src/server/auth-repository.js';
import { createAuthHttp, tokenHash } from '../src/server/auth-http.js';
import { authConfigFromEnv } from '../src/server/oidc.js';

const issuer = 'https://issuer.example.test', origin = 'https://bldrz.example.test';
const rand = () => randomBytes(32).toString('base64url');
let db, repo, auth, a, b, c, companyA, companyB;
const denied = (promise) => assert.rejects(promise, { code: '42501' });
before(async () => {
  db = new PGlite();
  const dir = path.resolve(import.meta.dirname, '../db/migrations');
  for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await fs.readFile(path.join(dir, file), 'utf8'));
  }
  const call = (text, values) => db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE wellsim_runtime');
    await tx.query("SELECT set_config('app.user_id','',true),set_config('app.workspace_id','',true)");
    return tx.query(text, values);
  });
  repo = createOnboardingRepository(call); auth = createAuthRepository(call);
});
after(async () => db?.close());
async function user(name, overrides = {}) {
  const identity = { issuer, subject: name, email: `${name}@example.test`, emailVerified: true,
    mfaAuthenticatedAt: Math.floor(Date.now() / 1000), ...overrides };
  const token = rand(), hash = tokenHash(token), csrf = tokenHash(rand());
  const id = await repo.signIn(identity, hash, csrf, null);
  return { id, identity, token, hash, csrf, cookie: `__Host-bldrz_session=${token}` };
}
beforeEach(async () => {
  // Synthetic in-memory database only; no live fixtures or credentials.
  await db.exec('TRUNCATE app.app_user CASCADE; TRUNCATE app.login_transaction');
  a = await user('alice'); b = await user('bob'); c = await user('carol');
  companyA = (await repo.createCompany(a.hash, 'Company A')).id;
  companyB = (await repo.createCompany(b.hash, 'Company B')).id;
});
async function invitation(owner = a, workspace = companyA, recipient = c, role = 'engineer') {
  const token = rand(), hash = tokenHash(token);
  const result = await repo.invite(owner.hash, workspace, recipient.identity.email, role, hash);
  return { ...result, token, hash };
}
async function join(recipient = c, role = 'engineer', owner = a, workspace = companyA) {
  const inv = await invitation(owner, workspace, recipient, role);
  await repo.accept(recipient.hash, inv.hash); return inv;
}
function handler(settings = {}, provider = {}) {
  return createAuthHttp({ settings: { enabled: true, onboardingEnabled: true, origin, ...settings }, provider,
    database: { enabled: true, auth, onboarding: repo } });
}
async function request(route, { actor = a, method = 'POST', headers = {}, body = {}, raw, settings, provider } = {}) {
  const bytes = raw ?? JSON.stringify(body);
  const req = Readable.from([Buffer.from(bytes)]);
  Object.assign(req, { url: route, method, headers: {
    cookie: actor?.cookie, origin, 'content-type': 'application/json', 'x-csrf-token': actor?.csrf,
    'x-workspace-id': companyA, ...headers,
  } });
  const res = { headers: {}, status: 0, text: '',
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(text = '') { this.text = text; },
  };
  await handler(settings, provider)(req, res);
  res.json = res.text ? JSON.parse(res.text) : null; return res;
}
async function tenant(user, workspace, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE wellsim_runtime');
    await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [user.id, workspace]);
    return tx.query(sql, params);
  });
}

test('onboarding startup verifies definer ownership, PUBLIC denial and removal of direct membership grants', async () => {
  await repo.ready();
  for (const sql of [
    'INSERT INTO app.membership(workspace_id,user_id,role_key) VALUES($1,$2,\'owner\')',
    "UPDATE app.membership SET role_key='owner' WHERE workspace_id=$1 AND user_id=$2",
    "UPDATE app.workspace_invitation SET status='accepted' WHERE workspace_id=$1 AND accepted_by=$2",
  ]) await denied(tenant(a, companyA, sql, [companyA, c.id]));
  await db.exec('GRANT UPDATE(status) ON app.membership TO wellsim_runtime');
  try { await assert.rejects(repo.ready(), /Unsafe/); }
  finally { await db.exec('REVOKE UPDATE(status) ON app.membership FROM wellsim_runtime'); }
  for (const name of ['app.onboarding_command(text,text,uuid,jsonb)', 'app.onboarding_sign_in(text,text,text,boolean,text,text,text)']) {
    assert.equal((await db.query("SELECT has_function_privilege('public',$1,'EXECUTE') AS allowed", [name])).rows[0].allowed, false);
  }
});

test('verified registration creates exactly one private workspace and stable immutable identity mapping', async () => {
  const again = await user('alice');
  assert.equal(again.id, a.id);
  const privateSpaces = (await auth.listWorkspaces(again.hash)).filter((w) => w.kind === 'personal');
  assert.equal(privateSpaces.length, 1);
  const membership = await db.query('SELECT * FROM app.membership WHERE workspace_id=$1', [privateSpaces[0].id]);
  assert.equal(membership.rows.length, 1); assert.equal(membership.rows[0].user_id, a.id);
  assert.equal(membership.rows[0].role_key, 'owner');
  const concurrent = await Promise.all([user('new-person'), user('new-person')]);
  assert.equal(concurrent[0].id, concurrent[1].id);
});

test('unverified claims, email collisions and email changes cannot enroll or link another identity', async () => {
  for (const overrides of [{ emailVerified: false }, { emailVerified: 'true' }, { email: 'bad' },
    { email: a.identity.email }, { issuer: 'http://insecure.test' }]) {
    assert.equal((await user('intruder', overrides)).id, null);
  }
  assert.equal((await user('alice', { email: 'changed@example.test' })).id, null);
  assert.equal((await user('alice', { issuer: 'https://different.test' })).id, null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM app.app_user')).rows[0].n, 3);
  assert.equal((await user('ALICE', { email: 'ALICE@EXAMPLE.TEST' })).id, null);
});

test('failed session issuance rolls back the new identity and private workspace atomically', async () => {
  await assert.rejects(repo.signIn({ issuer, subject: 'rollback', email: 'rollback@example.test', emailVerified: true },
    'invalid-digest', a.csrf, null), { code: '23514' });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM app.app_user WHERE email='rollback@example.test'")).rows[0].n, 0);
});

test('legacy, expired, revoked and disabled-user sessions cannot perform onboarding', async () => {
  const hash = tokenHash(rand());
  await auth.createSession(a.identity, hash, a.csrf, null);
  await denied(repo.createCompany(hash, 'Unverified claim'));
  await auth.revokeSession(a.hash); await denied(repo.createCompany(a.hash, 'Revoked'));
  await db.query("UPDATE app.web_session SET idle_expires_at=statement_timestamp()-interval '1 second' WHERE token_hash=$1", [b.hash]);
  await denied(repo.profile(b.hash, 'Expired'));
  await db.query("UPDATE app.app_user SET status='disabled' WHERE id=$1", [c.id]);
  await denied(repo.createCompany(c.hash, 'Disabled'));
  assert.equal((await user('carol')).id, null);
});

test('company creation is explicit, bounded and never transfers private data or joins matching domains', async () => {
  assert.deepEqual((await auth.listWorkspaces(c.hash)).map((w) => w.kind), ['personal']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM app.membership WHERE workspace_id=$1', [companyA])).rows[0].n, 1);
  for (let i = 0; i < 9; i += 1) await repo.createCompany(a.hash, `Company ${i}`);
  await assert.rejects(repo.createCompany(a.hash, 'Over limit'), { code: '54000' });
  await assert.rejects(repo.createCompany(b.hash, '  '), { code: '22023' });
  await repo.profile(c.hash, 'Carol Example');
  assert.equal((await auth.readSession(c.hash)).displayName, 'Carol Example');
});

test('private workspaces cannot list teams, invite, accept members, or be left through company operations', async () => {
  const personal = (await auth.listWorkspaces(a.hash)).find((w) => w.kind === 'personal').id;
  await denied(repo.members(a.hash, personal)); await denied(repo.leave(a.hash, personal));
  await denied(repo.invite(a.hash, personal, c.identity.email, 'viewer', tokenHash(rand())));
  await denied(repo.changeMember(a.hash, personal, a.id, 'viewer', 'active'));
});

test('Company A and B cannot enumerate, invite, revoke or manage each other even with known IDs', async () => {
  const invA = await invitation(), invB = await invitation(b, companyB);
  for (const [actor, other, inv, otherOwner] of [[a, companyB, invB, b], [b, companyA, invA, a]]) {
    await denied(repo.members(actor.hash, other)); await denied(repo.invitations(actor.hash, other));
    await denied(repo.invite(actor.hash, other, c.identity.email, 'viewer', tokenHash(rand())));
    await denied(repo.revoke(actor.hash, other, inv.id));
    await denied(repo.changeMember(actor.hash, other, otherOwner.id, 'viewer', 'removed'));
    await denied(repo.leave(actor.hash, other));
  }
  await denied(repo.revoke(a.hash, companyA, invB.id));
  await denied(repo.changeMember(a.hash, companyA, b.id, 'engineer', 'active'));
});

test('invitation acceptance is email-bound, single-use and cannot replace existing membership', async () => {
  const inv = await invitation(a, companyA, c, 'reviewer');
  await denied(repo.accept(b.hash, inv.hash));
  assert.equal((await repo.accept(c.hash, inv.hash)).workspaceId, companyA);
  await denied(repo.accept(c.hash, inv.hash));
  const elevated = await invitation(a, companyA, c, 'administrator');
  await denied(repo.accept(c.hash, elevated.hash));
  assert.equal((await auth.listWorkspaces(c.hash)).find((w) => w.id === companyA).role_key, 'reviewer');
  assert.equal((await auth.listWorkspaces(c.hash)).some((w) => w.id === companyB), false);
});

test('expired, revoked and replaced invitations cannot be accepted; lookup does not disclose registration', async () => {
  const expired = await invitation();
  await db.query("UPDATE app.workspace_invitation SET expires_at=statement_timestamp()-interval '1 second' WHERE id=$1", [expired.id]);
  await denied(repo.accept(c.hash, expired.hash));
  const replaced = await invitation(), fresh = await invitation();
  await denied(repo.accept(c.hash, replaced.hash));
  await repo.revoke(a.hash, companyA, fresh.id); await denied(repo.accept(c.hash, fresh.hash));
  const unregistered = await invitation(a, companyA, { identity: { email: 'new@example.test' } });
  const newUser = await user('new'); await repo.accept(newUser.hash, unregistered.hash);
  assert.equal((await auth.listWorkspaces(newUser.hash)).length, 2);
});

test('inviters must still have current authority; demotion or suspension invalidates issued invitations', async () => {
  await join(c, 'administrator');
  const invited = await invitation(c, companyA, b, 'engineer');
  await repo.changeMember(a.hash, companyA, c.id, 'engineer', 'active');
  await denied(repo.accept(b.hash, invited.hash));
  const suspended = await invitation();
  await db.query("UPDATE app.membership SET status='suspended' WHERE workspace_id=$1 AND user_id=$2", [companyA, a.id]);
  await denied(repo.accept(c.hash, suspended.hash));
});

test('administrator cannot promote itself, modify an owner/admin, or invite privileged roles', async () => {
  await join(c, 'administrator');
  for (const role of ['owner', 'administrator', 'developer', 'platform_admin', 'external_collaborator']) {
    await assert.rejects(repo.invite(c.hash, companyA, b.identity.email, role, tokenHash(rand())));
  }
  await denied(repo.changeMember(c.hash, companyA, c.id, 'owner', 'active'));
  await denied(repo.changeMember(c.hash, companyA, a.id, 'viewer', 'removed'));
  await join(b, 'engineer', c);
  await repo.changeMember(c.hash, companyA, b.id, 'reviewer', 'active');
  assert.equal((await auth.listWorkspaces(b.hash)).find((w) => w.id === companyA).role_key, 'reviewer');
});

test('ordinary members cannot administer teams or issue invitations, but may leave their company', async () => {
  for (const role of ['engineering_manager', 'engineer', 'reviewer', 'viewer']) {
    if (role === 'engineering_manager') await join(c, role);
    else await repo.changeMember(a.hash, companyA, c.id, role, 'active');
    await denied(repo.members(c.hash, companyA));
    await denied(repo.invite(c.hash, companyA, b.identity.email, 'viewer', tokenHash(rand())));
    await denied(repo.changeMember(c.hash, companyA, a.id, 'viewer', 'removed'));
  }
  await repo.leave(c.hash, companyA);
  assert.equal((await auth.listWorkspaces(c.hash)).some((w) => w.id === companyA), false);
  assert.equal((await auth.listWorkspaces(c.hash)).filter((w) => w.kind === 'personal').length, 1);
});

test('the last active owner is protected; an existing member can become a second owner', async () => {
  await assert.rejects(repo.leave(a.hash, companyA), { code: '23514' });
  await assert.rejects(repo.changeMember(a.hash, companyA, a.id, 'viewer', 'active'), { code: '23514' });
  await join(c);
  await repo.changeMember(a.hash, companyA, c.id, 'owner', 'active');
  const outcomes = await Promise.allSettled([repo.leave(a.hash, companyA), repo.leave(c.hash, companyA)]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM app.membership WHERE workspace_id=$1 AND role_key='owner' AND status='active'", [companyA])).rows[0].n, 1);
});

test('simultaneous invitation acceptance commits once without changing the granted role', async () => {
  const inv = await invitation();
  const results = await Promise.allSettled([repo.accept(c.hash, inv.hash), repo.accept(c.hash, inv.hash)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM app.membership WHERE workspace_id=$1 AND user_id=$2', [companyA, c.id])).rows[0].n, 1);
});

test('removal and downgrades revoke next-request read/write/export authority without harming other workspaces', async () => {
  await join(c);
  const permissions = async (workspace) => (await tenant(c, workspace,
    "SELECT app.has_workspace_permission($1,'case.read') AS read, app.has_workspace_permission($1,'case.write') AS write, app.has_workspace_permission($1,'export.create') AS export", [workspace])).rows[0];
  assert.deepEqual(await permissions(companyA), { read: true, write: true, export: true });
  assert.deepEqual(await permissions(companyB), { read: false, write: false, export: false });
  await repo.changeMember(a.hash, companyA, c.id, 'viewer', 'active');
  assert.deepEqual(await permissions(companyA), { read: true, write: false, export: false });
  await repo.changeMember(a.hash, companyA, c.id, 'viewer', 'removed');
  assert.deepEqual(await permissions(companyA), { read: false, write: false, export: false });
  const again = await invitation(); await denied(repo.accept(c.hash, again.hash));
  await repo.changeMember(a.hash, companyA, c.id, 'engineer', 'active');
  assert.equal((await permissions(companyA)).write, true);
});

test('company and membership expiry/disablement fail closed without exposing invitation metadata', async () => {
  const inv = await invitation();
  await db.query("UPDATE app.workspace SET status='suspended' WHERE id=$1", [companyA]);
  await denied(repo.accept(c.hash, inv.hash)); await denied(repo.invitations(a.hash, companyA));
  await db.query("UPDATE app.workspace SET status='active' WHERE id=$1", [companyA]);
  await db.query("UPDATE app.membership SET expires_at=statement_timestamp()-interval '1 second' WHERE workspace_id=$1 AND user_id=$2", [companyA, a.id]);
  await denied(repo.accept(c.hash, inv.hash)); await denied(repo.members(a.hash, companyA));
});

test('audit events are company-local and omit invitation tokens, digests and email', async () => {
  const inv = await invitation(); await repo.accept(c.hash, inv.hash);
  await repo.changeMember(a.hash, companyA, c.id, 'viewer', 'suspended');
  const events = await tenant(a, companyA, 'SELECT * FROM app.audit_event');
  assert.ok(events.rows.some((e) => e.action === 'invitation.accepted'));
  assert.ok(events.rows.some((e) => e.action === 'membership.changed'));
  assert.ok(events.rows.every((e) => e.workspace_id === companyA));
  const serialized = JSON.stringify(events.rows);
  for (const secret of [inv.token, inv.hash, c.identity.email]) assert.ok(!serialized.includes(secret));
  const listed = JSON.stringify(await repo.invitations(a.hash, companyA));
  assert.ok(!listed.includes(inv.token)); assert.ok(!listed.includes(inv.hash));
});

test('HTTP issues single-display fragment invitations, accepts explicitly, and refuses request identity overrides', async () => {
  const created = await request('/api/v2/invitations/create', { body: { email: c.identity.email, role: 'engineer' } });
  assert.equal(created.status, 200); assert.equal(created.headers['cache-control'], 'no-store');
  const link = new URL(created.json.invitationUrl); assert.equal(link.origin, origin); assert.equal(link.search, '');
  const token = new URLSearchParams(link.hash.slice(1)).get('invite');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await request('/api/v2/invitations/accept', { actor: b, body: { token } })).status, 404);
  assert.equal((await request('/api/v2/invitations/accept', { actor: c, body: { token, userId: a.id, role: 'owner' } })).status, 400);
  assert.equal((await request('/api/v2/invitations/accept', { actor: c, body: { token }, headers: { 'x-user-id': a.id, 'x-workspace-id': companyB } })).status, 200);
  assert.equal((await request('/api/v2/invitations/accept', { actor: c, body: { token } })).status, 404);
  assert.equal((await request('/api/v2/members', { method: 'GET', headers: { 'x-workspace-id': companyB, 'x-user-id': b.id } })).status, 404);
});

test('HTTP mutations require a cookie session, exact Origin, CSRF, POST and strict bounded JSON', async () => {
  for (const headers of [{ origin: 'https://evil.example.test' }, { origin: undefined }, { 'x-csrf-token': 'wrong' }]) {
    assert.equal((await request('/api/v2/companies', { headers, body: { name: 'Blocked' } })).status, 403);
  }
  assert.equal((await request('/api/v2/companies', { actor: null, body: { name: 'No session' }, headers: { authorization: `Bearer ${a.token}` } })).status, 401);
  assert.equal((await request('/api/v2/companies', { headers: { cookie: `${a.cookie}; ${a.cookie}` } })).status, 401);
  assert.equal((await request('/api/v2/companies', { method: 'GET' })).status, 405);
  for (const raw of ['[1]', 'null', '{', '"name"']) assert.equal((await request('/api/v2/companies', { raw })).status, 400);
  assert.equal((await request('/api/v2/companies', { raw: ' '.repeat(8193) })).status, 413);
  assert.equal((await request('/api/v2/companies', { headers: { 'content-length': '9000' } })).status, 413);
  assert.equal((await request('/api/v2/companies', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/v2/companies', { body: { name: 'Injected', ownerUserId: b.id } })).status, 400);
  assert.equal((await request('/api/v2/members/change', { body: { userId: randomUUID(), role: 'owner', status: 'active' } })).status, 404);
});

test('onboarding remains opt-in and unavailable with only the authentication foundation enabled', async () => {
  assert.throws(() => authConfigFromEnv({ WELLSIM_ONBOARDING_ENABLED: '1' }), /requires/);
  for (const settings of [{ enabled: false }, { onboardingEnabled: false }]) {
    assert.equal((await request('/api/v2/companies', { settings, body: { name: 'Hidden' } })).status, 404);
  }
  for (const DATABASE_URL of ['invalid-test-sentinel-secret',
    'postgresql://bldrz_app:test-sentinel-secret@127.0.0.1:5432/bldrz',
    'postgresql://bldrz_app:test-sentinel-secret@remote.invalid/bldrz_onboarding_probe']) {
    await assert.rejects(promisify(execFile)(process.execPath,
      [path.resolve(import.meta.dirname, '../scripts/verify-postgres-onboarding.mjs')],
      { env: { ...process.env, DATABASE_URL }, timeout: 5000 }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /requires the loopback disposable probe/);
      assert.ok(!error.stderr.includes('test-sentinel-secret'));
      return true;
    });
  }
});

test('HTTP verified callback bootstraps identity/session and redirects to onboarding without accepting client claims', async () => {
  const flowToken = rand(), state = rand(), nonce = rand(), codeVerifier = rand();
  await auth.createFlow(tokenHash(flowToken), { state, nonce, codeVerifier });
  const h = handler({}, { async finish() {
    return { issuer, subject: 'new-callback', email: 'new-callback@example.test', emailVerified: true };
  } });
  const req = { method: 'GET', url: `/auth/callback?code=fixture&state=${state}&userId=${b.id}`,
    headers: { cookie: `__Host-bldrz_login=${flowToken}`, 'x-user-id': b.id },
    body: { email: b.identity.email, role: 'owner' } };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end() {} };
  await h(req, res); assert.equal(res.status, 303); assert.equal(res.headers.location, '/workspace.html');
  const session = res.headers['set-cookie'].find((v) => v.startsWith('__Host-bldrz_session='));
  const hash = tokenHash(session.split(';')[0].split('=')[1]);
  const created = await auth.readSession(hash); assert.ok(created); assert.notEqual(created.userId, b.id);
  assert.deepEqual((await auth.listWorkspaces(hash)).map((w) => w.kind), ['personal']);
  assert.equal(created.mfaExpiresAt, null);
  await assert.rejects(repo.createCompany(hash, 'New callback company'), { code: 'PM001' });
});

async function basicSession(actor) {
  const token = rand(), hash = tokenHash(token), csrf = tokenHash(rand());
  const identity = { ...actor.identity, mfaAuthenticatedAt: undefined };
  assert.equal(await auth.completeLogin(identity, hash, csrf, null, { onboardingEnabled: true }), actor.id);
  return { ...actor, identity, token, hash, csrf, cookie: `__Host-bldrz_session=${token}` };
}

test('basic sessions cannot manage companies, forge MFA fields or call the unguarded helper', async () => {
  const basic = await basicSession(a);
  assert.equal((await auth.readSession(basic.hash)).mfaExpiresAt, null);
  assert.equal((await auth.listWorkspaces(basic.hash)).length, 2);
  await repo.profile(basic.hash, 'Alice');
  for (const operation of [() => repo.createCompany(basic.hash, 'Blocked'),
    () => repo.members(basic.hash, companyA), () => repo.invitations(basic.hash, companyA),
    () => repo.invite(basic.hash, companyA, c.identity.email, 'viewer', tokenHash(rand())),
    () => repo.leave(basic.hash, companyA)]) await assert.rejects(operation(), { code: 'PM001' });
  await denied(tenant(basic, companyA, "SELECT app.onboarding_command_v5($1,'company.create',NULL,'{\"name\":\"Bypass\"}')", [basic.hash]));
  await denied(tenant(basic, companyA, 'SELECT app.auth_session_has_recent_mfa($1)', [basic.hash]));
  await denied(tenant(basic, companyA, 'UPDATE app.web_session SET mfa_authenticated_at=clock_timestamp() WHERE token_hash=$1', [basic.hash]));
  await db.exec('GRANT UPDATE(mfa_authenticated_at) ON app.web_session TO wellsim_runtime');
  try { await assert.rejects(auth.ready(), /Unsafe/); }
  finally { await db.exec('REVOKE UPDATE(mfa_authenticated_at) ON app.web_session FROM wellsim_runtime'); }
  const forged = await request('/api/v2/companies', { actor: basic, body: { name: 'Injected', mfa: true } });
  assert.equal(forged.status, 400);
  const blocked = await request('/api/v2/companies', { actor: basic, body: { name: 'Blocked' },
    headers: { 'x-mfa': 'true', 'x-user-role': 'owner', 'x-mfa-authenticated-at': String(Date.now()) } });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.error, 'mfa_required');
  await denied(repo.members(basic.hash, companyB));
  assert.equal((await repo.members(a.hash, companyA)).length, 1);
});

test('administrator invitation acceptance and newly promoted administrators require their own recent MFA', async () => {
  const basicC = await basicSession(c), basicB = await basicSession(b);
  const adminInvite = await invitation(a, companyA, c, 'administrator');
  await assert.rejects(repo.accept(basicC.hash, adminInvite.hash), { code: 'PM001' });
  assert.equal((await auth.listWorkspaces(basicC.hash)).some((w) => w.id === companyA), false);
  await repo.accept(c.hash, adminInvite.hash);
  await assert.rejects(repo.members(basicC.hash, companyA), { code: 'PM001' });
  const viewerInvite = await invitation(a, companyA, b, 'viewer');
  await repo.accept(basicB.hash, viewerInvite.hash);
  await denied(repo.members(basicB.hash, companyA));
  await repo.changeMember(a.hash, companyA, b.id, 'administrator', 'active');
  await assert.rejects(repo.members(basicB.hash, companyA), { code: 'PM001' });
  await repo.changeMember(a.hash, companyA, b.id, 'viewer', 'active');
  await repo.leave(basicB.hash, companyA);
});

test('MFA expires independently of session activity and stale/future timestamps cannot refresh it', async () => {
  const originalExpiry = (await auth.readSession(a.hash)).mfaExpiresAt;
  assert.ok(new Date(originalExpiry).getTime() > Date.now());
  assert.equal(new Date((await auth.readSession(a.hash)).mfaExpiresAt).getTime(), new Date(originalExpiry).getTime());
  for (const epoch of [Math.floor(Date.now() / 1000) - 901, Math.floor(Date.now() / 1000) + 120]) {
    await assert.rejects(auth.completeLogin({ ...a.identity, mfaAuthenticatedAt: epoch }, tokenHash(rand()), a.csrf,
      a.hash, { expectedUserId: a.id, onboardingEnabled: true }), { code: 'PM001' });
    assert.ok(await auth.readSession(a.hash), 'failed step-up must not revoke the previous session');
  }
  await db.query("UPDATE app.web_session SET mfa_authenticated_at=clock_timestamp()-interval '16 minutes' WHERE token_hash=$1", [a.hash]);
  assert.ok(await auth.readSession(a.hash));
  await assert.rejects(repo.members(a.hash, companyA), { code: 'PM001' });
  await repo.profile(a.hash, 'Still signed in');
  await auth.revokeSession(a.hash); await denied(repo.members(a.hash, companyA));
});

async function startStepUp(actor, identity) {
  const state = rand();
  const provider = { async start(options) {
    assert.equal(options.requireMfa, true);
    return { flow: { state, nonce: rand(), codeVerifier: rand() }, url: `${issuer}/authorize` };
  }, async finish(_callback, flow) {
    assert.equal(flow.requireMfa, true); assert.equal(flow.expectedUserId, actor.id); return identity;
  } };
  const start = await request('/auth/step-up', { actor, provider });
  assert.equal(start.status, 200); assert.equal(start.json.redirectTo, `${issuer}/authorize`);
  const flowCookie = start.headers['set-cookie'].split(';')[0];
  assert.match(start.headers['set-cookie'], /Secure; HttpOnly; SameSite=Lax/);
  return { provider, route: `/auth/callback?code=fixture&state=${state}`,
    headers: { cookie: `${actor.cookie}; ${flowCookie}` } };
}

test('HTTP MFA step-up requires POST, active session, exact Origin and CSRF', async () => {
  const provider = { async start() { assert.fail('provider must not be contacted'); } };
  for (const headers of [{ origin: undefined }, { origin: 'https://evil.test' }, { 'x-csrf-token': 'fake' }]) {
    assert.equal((await request('/auth/step-up', { headers, provider })).status, 403);
  }
  assert.equal((await request('/auth/step-up', { actor: null, provider })).status, 401);
  assert.equal((await request('/auth/step-up', { method: 'GET', provider })).status, 405);
  await auth.revokeSession(a.hash);
  assert.equal((await request('/auth/step-up', { provider })).status, 401);
});

test('HTTP successful same-account MFA rotates session and CSRF without gaining another company', async () => {
  const basic = await basicSession(a), flow = await startStepUp(basic, a.identity);
  const done = await request(flow.route, { ...flow, actor: basic, method: 'GET' });
  assert.equal(done.status, 303); assert.equal(done.headers.location, '/workspace.html');
  const sessionCookie = done.headers['set-cookie'].find((s) => s.startsWith('__Host-bldrz_session='));
  const hash = tokenHash(sessionCookie.split(';')[0].split('=')[1]);
  const session = await auth.readSession(hash);
  assert.equal(session.userId, a.id); assert.notEqual(session.csrfToken, basic.csrf);
  assert.ok(session.mfaExpiresAt); assert.equal(await auth.readSession(basic.hash), undefined);
  assert.equal((await repo.members(hash, companyA)).length, 1);
  await denied(repo.members(hash, companyB));
  assert.equal((await request(flow.route, { ...flow, actor: basic, method: 'GET' })).status, 400);
});

test('HTTP MFA cannot switch accounts, omit assurance or resurrect a revoked browser session', async () => {
  for (const mode of ['different-account', 'missing-mfa', 'revoked', 'missing-cookie']) {
    const basic = await basicSession(a);
    const identity = mode === 'different-account' ? b.identity : mode === 'missing-mfa' ? basic.identity : a.identity;
    const flow = await startStepUp(basic, identity);
    if (mode === 'revoked') await auth.revokeSession(basic.hash);
    if (mode === 'missing-cookie') flow.headers.cookie = flow.headers.cookie.split('; ')[1];
    const result = await request(flow.route, { ...flow, actor: basic, method: 'GET' });
    assert.equal(result.status, mode === 'missing-mfa' ? 400 : 403, mode);
    assert.ok(!String(result.headers['set-cookie']).includes('__Host-bldrz_session='));
    if (mode !== 'revoked') assert.ok(await auth.readSession(basic.hash));
    assert.equal((await request(flow.route, { ...flow, actor: basic, method: 'GET' })).status, 400);
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM app.app_user')).rows[0].n, 3);
});

test('service worker never intercepts authentication, API or private portal requests', async () => {
  const listeners = {};
  const source = await fs.readFile(new URL('../src/ui/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { self: { location: { origin }, addEventListener(type, handler) { listeners[type] = handler; } }, URL });
  for (const route of ['/auth/session', '/auth/callback?code=secret', '/api/v2/members', '/workspace.html',
    '/workspace.js', '/workspace.css', '/portal/', '/portal/personal.html', '/portal/portal.js', '/admin/', '/admin/admin.js']) {
    let intercepted = false;
    listeners.fetch({ request: { method: 'GET', url: origin + route }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, route);
  }
  const ui = await fs.readFile(new URL('../src/ui/workspace.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|localStorage|sessionStorage/.test(ui));
  assert.match(ui, /history\.replaceState/); assert.match(ui, /pagehide/);
});
