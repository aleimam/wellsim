// Real PostgreSQL, real non-inheriting application login, two independent pools.
// Intentionally no IdP calls, owner credentials, live data or HTTP listener.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeDatabase } from '../src/server/database.js';
import { createOnboardingRepository } from '../src/server/onboarding-repository.js';
import { createAuthRepository } from '../src/server/auth-repository.js';
import { tokenHash } from '../src/server/auth-http.js';

try {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/bldrz_onboarding_probe');
} catch {
  // URL parser errors include their raw input; never let a credential-bearing
  // invalid URL escape into command output, even before the pools are created.
  console.error('Native onboarding qualification requires the loopback disposable probe');
  process.exit(1);
}
const env = { ...process.env, WELLSIM_DATABASE_ENABLED: '1', WELLSIM_DB_LOGIN_ROLE: 'bldrz_app',
  WELLSIM_DB_RUNTIME_ROLE: 'bldrz_runtime', WELLSIM_DB_POOL_MAX: '2' };
const random = () => randomBytes(32).toString('base64url');
const issuer = 'https://qualification.example.test';
const identity = (name) => ({ issuer, subject: name, email: `${name}@example.test`, emailVerified: true,
  mfaAuthenticatedAt: Math.floor(Date.now()/1000) });
const credentials = (name) => ({ identity: identity(name), hash: tokenHash(random()), csrf: tokenHash(random()) });
const context = (user, workspaceId) => ({ userId: user.id, workspaceId });
const success = (outcome) => { assert.equal(outcome.ok, true, `Unexpected failure (${outcome.code})`); return outcome.value; };
const failure = (outcome, code) => { assert.equal(outcome.ok, false, 'Operation unexpectedly succeeded'); assert.equal(outcome.code, code); };
// Attach rejection handlers immediately so deliberately blocked failures never
// become unhandled rejections while the other connection holds a lock.
const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code }));
const checks = [];
function pass(label) { checks.push(label); console.log(`PASS ${label}`); }
let left, right;

async function signIn(database, user) {
  user.id = await database.onboarding.signIn(user.identity, user.hash, user.csrf, null);
  assert.ok(user.id); return user;
}
async function invite(owner, company, recipient, role = 'engineer') {
  const hash = tokenHash(random());
  return { ...await left.onboarding.invite(owner.hash, company, recipient.identity.email, role, hash), hash };
}
async function join(owner, company, recipient, role = 'engineer') {
  const invitation = await invite(owner, company, recipient, role);
  assert.equal((await right.onboarding.accept(recipient.hash, invitation.hash)).workspaceId, company);
  return invitation;
}

// Prove that the competing statement is actually waiting in PostgreSQL. This
// avoids treating Promise.all on a serial WASM engine as a concurrency test.
async function waitForBlock(tx, blocker) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    await tx.query('SELECT pg_stat_clear_snapshot()');
    // Under SET ROLE runtime, detailed session statistics (including
    // wait_event_type) are hidden. The public blocking-PID relationship is
    // sufficient; never grant pg_read_all_stats just to run a test.
    const waiting = await tx.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND usename=session_user
        AND $1=ANY(pg_blocking_pids(pid))`, [blocker]);
    if (waiting.rows[0].n > 0) return;
    await delay(20);
  }
  assert.fail('Competing connection never reached the expected PostgreSQL lock');
}
async function orderedRace(actor, company, waitingOperation, firstOperation, { advisory = false } = {}) {
  let waiting;
  try {
    const first = await left.withTenantTransaction(context(actor, company), async (tx) => {
      const pid = (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if (advisory) await tx.query('SELECT pg_advisory_xact_lock(5005,1)');
      else await tx.query('UPDATE app.workspace SET name=name WHERE id=$1', [company]);
      waiting = settle(waitingOperation());
      await waitForBlock(tx, pid);
      return firstOperation(createOnboardingRepository(tx.query), createAuthRepository(tx.query), tx);
    });
    return { first, waiting: await waiting };
  } finally { await waiting; }
}
async function engineeringFixture(database, user, workspace) {
  const ids = { field: randomUUID(), well: randomUUID(), project: randomUUID(), case: randomUUID(), export: randomUUID() };
  await database.withTenantTransaction(context(user, workspace), async (tx) => {
    await tx.query('INSERT INTO app.field_asset(workspace_id,id,name,created_by) VALUES($1,$2,$3,$4)',
      [workspace, ids.field, 'Synthetic field', user.id]);
    await tx.query('INSERT INTO app.well(workspace_id,id,field_id,name,created_by) VALUES($1,$2,$3,$4,$5)',
      [workspace, ids.well, ids.field, 'Synthetic well', user.id]);
    await tx.query('INSERT INTO app.project(workspace_id,id,name,created_by) VALUES($1,$2,$3,$4)',
      [workspace, ids.project, 'Synthetic project', user.id]);
    await tx.query(`INSERT INTO app.engineering_case(workspace_id,id,project_id,well_id,module_id,title,created_by)
      VALUES($1,$2,$3,$4,'oil.nodal','Synthetic case',$5)`, [workspace, ids.case, ids.project, ids.well, user.id]);
    await tx.query(`INSERT INTO app.export_job(workspace_id,id,requested_by,exporter_id,exporter_version,source_snapshot)
      VALUES($1,$2,$3,'synthetic.csv',1,'{}')`, [workspace, ids.export, user.id]);
  });
  return ids;
}

try {
  left = await initializeDatabase(env); right = await initializeDatabase(env);
  await left.auth.ready(); await right.auth.ready();
  await left.onboarding.ready(); await right.onboarding.ready();
  const a = await signIn(left, credentials('company-a-owner'));
  const b = await signIn(right, credentials('company-b-owner'));
  const wa = (await left.onboarding.createCompany(a.hash, 'Synthetic company A')).id;
  const wb = (await right.onboarding.createCompany(b.hash, 'Synthetic company B')).id;
  const pids = await Promise.all([left, right].map((database) => database.withTenantTransaction(context(a, wa),
    async (tx) => (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid)));
  assert.notEqual(pids[0], pids[1]);
  pass('distinct PostgreSQL connections, runtime role boundary and onboarding privilege checks');

  for (let i = 0; i < 3; i += 1) {
    const first = credentials(`same-identity-${i}`), second = credentials(`same-identity-${i}`);
    const race = await orderedRace(a, wa,
      () => right.onboarding.signIn(second.identity, second.hash, second.csrf, null),
      (repo) => repo.signIn(first.identity, first.hash, first.csrf, null), { advisory: true });
    assert.equal(success(race.waiting), race.first);
    const spaces = await right.auth.listWorkspaces(second.hash);
    assert.equal(spaces.length, 1); assert.equal(spaces[0].kind, 'personal');
    const collision = credentials(`collision-${i}`);
    collision.identity.email = first.identity.email;
    assert.equal(await left.onboarding.signIn(collision.identity, collision.hash, collision.csrf, null), null);
  }
  const firstEmail = credentials('email-race-one'), secondEmail = credentials('email-race-two');
  secondEmail.identity.email = firstEmail.identity.email;
  const emailRace = await orderedRace(a, wa,
    () => right.onboarding.signIn(secondEmail.identity, secondEmail.hash, secondEmail.csrf, null),
    (repo) => repo.signIn(firstEmail.identity, firstEmail.hash, firstEmail.csrf, null), { advisory: true });
  assert.ok(emailRace.first); assert.equal(success(emailRace.waiting), null);
  pass('observed-lock concurrent first sign-in and email-collision isolation');

  const rolledBack = credentials('rolled-back-registration');
  await assert.rejects(left.withTenantTransaction(context(a, wa), async (tx) => {
    const repo = createOnboardingRepository(tx.query);
    assert.ok(await repo.signIn(rolledBack.identity, rolledBack.hash, rolledBack.csrf, a.hash));
    throw new Error('intentional qualification rollback');
  }), /intentional qualification rollback/);
  assert.equal(await right.auth.readSession(rolledBack.hash), undefined);
  assert.ok(await right.auth.readSession(a.hash), 'prior-session revocation must roll back too');
  const replacement = credentials('rollback-replacement'); replacement.identity.email = rolledBack.identity.email;
  await signIn(right, replacement);
  pass('identity/private-workspace/session bootstrap and prior-session revocation roll back atomically');

  for (let i = 0; i < 3; i += 1) {
    const recipient = await signIn(left, credentials(`duplicate-recipient-${i}`));
    const inv = await invite(a, wa, recipient);
    const race = await orderedRace(a, wa, () => right.onboarding.accept(recipient.hash, inv.hash),
      (repo) => repo.accept(recipient.hash, inv.hash));
    assert.equal(race.first.workspaceId, wa); failure(race.waiting, '42501');
    const members = await left.onboarding.members(a.hash, wa);
    assert.equal(members.filter((m) => m.userId === recipient.id).length, 1);
  }
  pass('observed-lock duplicate invitation acceptance commits exactly once');

  const revokeRecipient = await signIn(left, credentials('revoke-recipient'));
  const revoked = await invite(a, wa, revokeRecipient);
  const revokeFirst = await orderedRace(a, wa, () => right.onboarding.accept(revokeRecipient.hash, revoked.hash),
    (repo) => repo.revoke(a.hash, wa, revoked.id));
  failure(revokeFirst.waiting, '42501');
  assert.equal((await right.auth.listWorkspaces(revokeRecipient.hash)).some((w) => w.id === wa), false);
  const accepted = await invite(a, wa, revokeRecipient);
  const acceptFirst = await orderedRace(a, wa, () => right.onboarding.revoke(a.hash, wa, accepted.id),
    (repo) => repo.accept(revokeRecipient.hash, accepted.hash));
  failure(acceptFirst.waiting, '42501');
  assert.equal((await right.auth.listWorkspaces(revokeRecipient.hash)).some((w) => w.id === wa), true);
  pass('invitation accept versus revoke is consistent in both forced commit orders');

  const admin = await signIn(left, credentials('company-a-admin'));
  await join(a, wa, admin, 'administrator');
  const employee = await signIn(left, credentials('demotion-recipient'));
  const beforeDemotion = await invite(admin, wa, employee);
  const demoteFirst = await orderedRace(a, wa, () => right.onboarding.accept(employee.hash, beforeDemotion.hash),
    (repo) => repo.changeMember(a.hash, wa, admin.id, 'viewer', 'active'));
  failure(demoteFirst.waiting, '42501');
  await left.onboarding.changeMember(a.hash, wa, admin.id, 'administrator', 'active');
  const beforeAcceptance = await invite(admin, wa, employee);
  const acceptBeforeDemotion = await orderedRace(a, wa,
    () => right.onboarding.changeMember(a.hash, wa, admin.id, 'viewer', 'active'),
    (repo) => repo.accept(employee.hash, beforeAcceptance.hash));
  success(acceptBeforeDemotion.waiting);
  assert.equal((await right.auth.listWorkspaces(employee.hash)).some((w) => w.id === wa), true);
  pass('inviter demotion versus acceptance rechecks authority after the lock in both orders');

  await left.onboarding.changeMember(a.hash, wa, admin.id, 'administrator', 'active');
  const managementRace = await orderedRace(a, wa,
    () => right.onboarding.invite(admin.hash, wa, 'never-created@example.test', 'engineer', tokenHash(random())),
    (repo) => repo.changeMember(a.hash, wa, admin.id, 'viewer', 'active'));
  failure(managementRace.waiting, '42501');
  await left.onboarding.changeMember(a.hash, wa, admin.id, 'administrator', 'active');
  const sessionRace = await orderedRace(a, wa,
    () => right.onboarding.invite(admin.hash, wa, 'never-created@example.test', 'engineer', tokenHash(random())),
    async (_, auth) => {
      // A blocked company-A operation must not hold up unrelated company B.
      assert.equal((await right.onboarding.members(b.hash, wb)).length, 1);
      await auth.revokeSession(admin.hash);
    });
  failure(sessionRace.waiting, '42501');
  assert.equal(await left.auth.readSession(admin.hash), undefined);
  pass('queued management loses demoted/revoked authority; company B remains usable while A is locked');

  const coOwner = await signIn(left, credentials('second-owner'));
  await join(a, wa, coOwner);
  for (let i = 0; i < 3; i += 1) {
    await left.onboarding.changeMember(a.hash, wa, coOwner.id, 'owner', 'active');
    const race = await orderedRace(a, wa, () => right.onboarding.leave(a.hash, wa),
      (repo) => repo.leave(coOwner.hash, wa));
    failure(race.waiting, '23514');
    assert.equal((await left.onboarding.members(a.hash, wa)).filter((m) => m.role === 'owner' && m.status === 'active').length, 1);
  }
  pass('observed-lock concurrent owner departures cannot remove the last active owner');

  const ea = await engineeringFixture(left, a, wa), eb = await engineeringFixture(right, b, wb);
  for (const [database, user, own, other, ownData, otherData] of [
    [left, a, wa, wb, ea, eb], [right, b, wb, wa, eb, ea],
  ]) {
    await assert.rejects(database.onboarding.members(user.hash, other), { code: '42501' });
    await assert.rejects(database.onboarding.invite(user.hash, other, 'intruder@example.test', 'owner', tokenHash(random())), { code: '42501' });
    await assert.rejects(database.withTenantTransaction(context(user, other), () => {}), { code: 'tenant_access_denied' });
    await database.withTenantTransaction(context(user, own), async (tx) => {
      assert.equal((await tx.query('SELECT * FROM app.engineering_case WHERE id=$1', [otherData.case])).rowCount, 0);
      assert.equal((await tx.query('UPDATE app.engineering_case SET title=$1 WHERE id=$2', ['ILLEGAL', otherData.case])).rowCount, 0);
      assert.equal((await tx.query('SELECT * FROM app.export_job WHERE id=$1', [otherData.export])).rowCount, 0);
      assert.equal((await tx.query('SELECT * FROM app.engineering_case WHERE id=$1', [ownData.case])).rowCount, 1);
    });
    await assert.rejects(database.withTenantTransaction(context(user, own), (tx) => tx.query(
      'INSERT INTO app.project_well(workspace_id,project_id,well_id,linked_by) VALUES($1,$2,$3,$4)',
      [own, ownData.project, otherData.well, user.id])), { code: '23503' });
    await assert.rejects(database.withTenantTransaction(context(user, own), (tx) => tx.query(
      'INSERT INTO app.export_item(workspace_id,id,export_job_id,case_id) VALUES($1,$2,$3,$4)',
      [own, randomUUID(), ownData.export, otherData.case])), { code: '23503' });
    await assert.rejects(database.withTenantTransaction(context(user, own), (tx) => tx.query(
      "UPDATE app.membership SET role_key='owner' WHERE workspace_id=$1", [own])), { code: '42501' });
  }
  pass('both-direction company reads, mutations, membership escalation, cross-links and exports denied');

  const privateA = (await left.auth.listWorkspaces(a.hash)).find((w) => w.kind === 'personal').id;
  await assert.rejects(right.withTenantTransaction(context(b, privateA), () => {}), { code: 'tenant_access_denied' });
  await assert.rejects(left.onboarding.invite(a.hash, privateA, b.identity.email, 'viewer', tokenHash(random())), { code: '42501' });
  await left.onboarding.changeMember(a.hash, wa, employee.id, 'viewer', 'active');
  const capabilities = () => right.withTenantTransaction(context(employee, wa),
    async (tx) => (await tx.query("SELECT app.has_workspace_permission($1,'case.write') AS write, app.has_workspace_permission($1,'export.create') AS export", [wa])).rows[0]);
  assert.deepEqual(await capabilities(), { write: false, export: false });
  await left.onboarding.changeMember(a.hash, wa, employee.id, 'viewer', 'removed');
  await assert.rejects(capabilities(), { code: 'tenant_access_denied' });
  assert.equal((await right.auth.listWorkspaces(employee.hash)).some((w) => w.kind === 'personal'), true);
  const basic = { ...credentials('company-a-owner'), id: a.id };
  delete basic.identity.mfaAuthenticatedAt;
  await signIn(left, basic);
  assert.equal((await left.auth.readSession(basic.hash)).mfaExpiresAt, null);
  await left.onboarding.profile(basic.hash, 'Synthetic owner');
  for (const operation of [() => left.onboarding.createCompany(basic.hash, 'Blocked'),
    () => left.onboarding.members(basic.hash, wa), () => left.onboarding.leave(basic.hash, wa)]) {
    await assert.rejects(operation(), { code: 'PM001' });
  }
  await assert.rejects(left.withTenantTransaction(context(a, wa), (tx) => tx.query(
    "SELECT app.onboarding_command_v5($1,'members.list',$2,'{}')", [basic.hash, wa])), { code: '42501' });
  await assert.rejects(left.onboarding.members(basic.hash, wb), { code: '42501' });
  pass('basic sessions cannot bypass recent MFA, private helpers or company boundaries');

  const mfaRecipient = await signIn(left, credentials('mfa-admin-recipient'));
  const adminBasic = { ...credentials('mfa-admin-recipient'), id: mfaRecipient.id };
  delete adminBasic.identity.mfaAuthenticatedAt;
  await signIn(right, adminBasic);
  const adminInvitation = await invite(a, wa, mfaRecipient, 'administrator');
  await assert.rejects(right.onboarding.accept(adminBasic.hash, adminInvitation.hash), { code: 'PM001' });
  await right.onboarding.accept(mfaRecipient.hash, adminInvitation.hash);
  await assert.rejects(right.onboarding.members(adminBasic.hash, wa), { code: 'PM001' });
  assert.ok((await right.onboarding.members(mfaRecipient.hash, wa)).length);
  pass('administrator invitation and management require that session to verify MFA');

  const elevated = credentials('company-a-owner');
  assert.equal(await left.auth.completeLogin(b.identity, elevated.hash, elevated.csrf, basic.hash,
    { expectedUserId: a.id, onboardingEnabled: true }), undefined);
  assert.ok(await left.auth.readSession(basic.hash));
  const stepUpRace = await orderedRace(a, wa,
    () => right.auth.completeLogin(elevated.identity, elevated.hash, elevated.csrf, basic.hash,
      { expectedUserId: a.id, onboardingEnabled: true }),
    (_, auth) => auth.revokeSession(basic.hash), { advisory: true });
  assert.equal(success(stepUpRace.waiting), undefined);
  assert.equal(await right.auth.readSession(elevated.hash), undefined);
  const freshBasic = { ...credentials('company-a-owner'), id: a.id };
  delete freshBasic.identity.mfaAuthenticatedAt;
  await signIn(left, freshBasic);
  assert.equal(await right.auth.completeLogin(elevated.identity, elevated.hash, elevated.csrf, freshBasic.hash,
    { expectedUserId: a.id, onboardingEnabled: true }), a.id);
  assert.equal(await right.auth.readSession(freshBasic.hash), undefined);
  assert.ok((await right.auth.readSession(elevated.hash)).mfaExpiresAt);
  pass('MFA account binding, session rotation and revocation during a queued callback');

  const expiring = credentials('company-a-owner');
  expiring.identity.mfaAuthenticatedAt = Math.floor(Date.now()/1000)-898;
  await signIn(left, expiring);
  const expiryRace = await orderedRace(a, wa, () => right.onboarding.members(expiring.hash, wa),
    async () => {
      assert.equal((await right.onboarding.members(b.hash, wb)).length, 1);
      await delay(2500);
    });
  failure(expiryRace.waiting, 'PM001');
  assert.ok(await right.auth.readSession(expiring.hash), 'MFA expiry is independent of session expiry');
  pass('MFA expiring behind an observed company lock fails closed without blocking company B');

  await left.close(); left = undefined;
  assert.ok(await right.auth.readSession(b.hash));
  pass('private workspace isolation, immediate downgrade/removal checks and session survival across pool replacement');
  console.log(`NATIVE_ONBOARDING_VERIFICATION_OK (${checks.length} groups)`);
} catch (error) {
  // Do not print assertion operands, connection strings, SQL detail or tokens.
  const location = error.stack?.match(/verify-postgres-onboarding\.mjs:\d+:\d+/)?.[0] ?? 'unknown location';
  console.error(`NATIVE_ONBOARDING_VERIFICATION_FAILED after ${checks.length} groups (${error.code ?? error.name}; ${location})`);
  process.exitCode = 1;
} finally {
  await left?.close(); await right?.close();
}
