import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { createPortalRepository } from '../src/server/portal-repository.js';
import { createOnboardingRepository } from '../src/server/onboarding-repository.js';
import { createAuthRepository } from '../src/server/auth-repository.js';
import { createAuthHttp, tokenHash } from '../src/server/auth-http.js';

const issuer = 'https://issuer.example.test', origin = 'https://bldrz.example.test';
const rand = () => randomBytes(32).toString('base64url');
let db, portal, onboarding, auth, alice, bob, carol, companyA, companyB;
const denied = (promise) => assert.rejects(promise, { code: '42501' });

before(async () => {
  db = new PGlite(); const dir = path.resolve(import.meta.dirname, '../db/migrations');
  for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await fs.readFile(path.join(dir, file), 'utf8'));
  }
  const call = (text, values) => db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE wellsim_runtime');
    await tx.query("SELECT set_config('app.user_id','',true),set_config('app.workspace_id','',true)");
    return tx.query(text, values);
  });
  portal = createPortalRepository(call); onboarding = createOnboardingRepository(call); auth = createAuthRepository(call);
});
after(async () => db?.close());

async function user(name, mfa = true) {
  const identity = { issuer, subject: name, email: `${name}@example.test`, emailVerified: true,
    ...(mfa ? { mfaAuthenticatedAt: Math.floor(Date.now() / 1000) } : {}) };
  const token = rand(), hash = tokenHash(token), csrf = tokenHash(rand());
  const id = await onboarding.signIn(identity, hash, csrf, null);
  return { id, identity, token, hash, csrf, cookie: `__Host-bldrz_session=${token}` };
}
beforeEach(async () => {
  await db.exec('TRUNCATE app.app_user CASCADE; TRUNCATE app.login_transaction');
  alice = await user('alice'); bob = await user('bob'); carol = await user('carol');
  companyA = (await onboarding.createCompany(alice.hash, 'Company A')).id;
  companyB = (await onboarding.createCompany(bob.hash, 'Company B')).id;
});

test('portal startup exposes only guarded functions and no direct portal tables', async () => {
  await portal.ready();
  for (const table of ['organization_join_request','platform_administrator','help_page','help_revision','platform_audit_event']) {
    const privileges = await db.query(`SELECT has_table_privilege('wellsim_runtime','app.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed`);
    assert.equal(privileges.rows[0].allowed, false, table);
  }
  assert.equal((await portal.context(alice.hash)).platformAdministrator, false);
});

test('company discovery is opt-in and a request grants no authority', async () => {
  assert.deepEqual(await portal.directory(carol.hash, ''), []);
  await portal.updateCompanySettings(alice.hash, companyA, 'request', 'North Sea production team');
  assert.deepEqual((await portal.directory(carol.hash, 'north')).map((company) => company.id), [companyA]);
  const request = await portal.createJoinRequest(carol.hash, companyA);
  assert.equal(request.status, 'pending'); assert.equal(request.requestedRole, 'engineer');
  assert.equal((await auth.listWorkspaces(carol.hash)).some((workspace) => workspace.id === companyA), false);
  await assert.rejects(portal.createJoinRequest(carol.hash, companyA), { code: '42501' });
  assert.deepEqual(await portal.directory(carol.hash, 'Company A'), []);
  const raw = await db.query('SELECT requested_role,status FROM app.organization_join_request WHERE id=$1', [request.id]);
  assert.deepEqual(raw.rows, [{ requested_role: 'engineer', status: 'pending' }]);
});

test('two companies cannot list, review, link or inherit each other join requests', async () => {
  await portal.updateCompanySettings(alice.hash, companyA, 'request', 'Company A directory');
  await portal.updateCompanySettings(bob.hash, companyB, 'request', 'Company B directory');
  const request = await portal.createJoinRequest(carol.hash, companyA);
  assert.equal((await portal.companyJoinRequests(alice.hash, companyA))[0].id, request.id);
  assert.deepEqual(await portal.companyJoinRequests(bob.hash, companyB), []);
  await denied(portal.companyJoinRequests(bob.hash, companyA));
  await denied(portal.reviewJoinRequest(bob.hash, companyB, request.id, 'approved'));
  await denied(portal.reviewJoinRequest(alice.hash, companyB, request.id, 'approved'));
  await portal.reviewJoinRequest(alice.hash, companyA, request.id, 'approved');
  const spaces = await auth.listWorkspaces(carol.hash);
  assert.equal(spaces.find((workspace) => workspace.id === companyA).role_key, 'engineer');
  assert.equal(spaces.some((workspace) => workspace.id === companyB), false);
  const cross = await db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE wellsim_runtime');
    await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)", [carol.id, companyA]);
    return tx.query("SELECT app.has_workspace_permission($1,'workspace.read') allowed", [companyB]);
  });
  assert.equal(cross.rows[0].allowed, false);
});

test('request cancellation is user-bound and review requires current company-admin MFA', async () => {
  await portal.updateCompanySettings(alice.hash, companyA, 'request', 'Open');
  const request = await portal.createJoinRequest(carol.hash, companyA);
  await denied(portal.cancelJoinRequest(bob.hash, request.id));
  await db.query("UPDATE app.web_session SET mfa_authenticated_at=clock_timestamp()-interval '16 minutes' WHERE token_hash=$1", [alice.hash]);
  await assert.rejects(portal.companyJoinRequests(alice.hash, companyA), { code: 'PM001' });
  await assert.rejects(portal.reviewJoinRequest(alice.hash, companyA, request.id, 'approved'), { code: 'PM001' });
  await portal.cancelJoinRequest(carol.hash, request.id);
  assert.equal((await portal.joinRequests(carol.hash))[0].status, 'cancelled');
});

test('platform help administration is separate, MFA-gated, revisioned and public only after publish', async () => {
  await denied(portal.adminHelpList(alice.hash));
  await db.query('INSERT INTO app.platform_administrator(user_id) VALUES($1)', [alice.id]);
  assert.equal((await portal.context(alice.hash)).platformAdministrator, true);
  const page = { slug:'safe-operations',section:'security',sortOrder:20,title:'Safe operations',summary:'A short guide',
    bodyMarkdown:'## First\n\nNever paste `<script>alert(1)</script>` as executable markup.' };
  assert.equal((await portal.saveHelpPage(alice.hash, page)).revision, 1);
  assert.deepEqual(await portal.helpCatalog(), []); assert.equal(await portal.helpPage(page.slug), null);
  await portal.publishHelpPage(alice.hash, page.slug);
  const published = await portal.helpPage(page.slug);
  assert.equal(published.revision, 1); assert.match(published.bodyMarkdown, /<script>/);
  assert.equal((await portal.helpCatalog())[0].slug, page.slug);
  assert.equal((await portal.saveHelpPage(alice.hash, { ...page, bodyMarkdown:'## Revised\n\nNew safe copy.' })).revision, 2);
  assert.equal((await portal.helpPage(page.slug)).revision, 1, 'saving a draft must not change public content');
  await portal.publishHelpPage(alice.hash, page.slug);
  assert.equal((await portal.helpPage(page.slug)).revision, 2);
  assert.equal((await db.query('SELECT count(*)::int n FROM app.help_revision WHERE page_slug=$1', [page.slug])).rows[0].n, 2);
  await db.query("UPDATE app.web_session SET mfa_authenticated_at=clock_timestamp()-interval '16 minutes' WHERE token_hash=$1", [alice.hash]);
  await assert.rejects(portal.unpublishHelpPage(alice.hash, page.slug), { code:'PM001' });
  await denied(portal.adminHelpList(bob.hash));
});

function handler() {
  return createAuthHttp({ settings:{ enabled:true,onboardingEnabled:true,portalEnabled:true,origin }, provider:{},
    database:{ enabled:true,auth,onboarding,portal } });
}
async function request(route,{ actor=alice,method='GET',body,headers={} }={}) {
  const req = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{ url:route,method,headers:{ cookie:actor?.cookie,origin,
    ...(body===undefined?{}:{'content-type':'application/json','x-csrf-token':actor?.csrf}),...headers } });
  const res={status:0,headers:{},text:'',setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(t=''){this.text=t;}};
  await handler()(req,res);res.json=res.text?JSON.parse(res.text):null;return res;
}

test('HTTP help is public while portal writes require session, CSRF and exact fields', async () => {
  assert.equal((await request('/api/help/catalog',{actor:null})).status,200);
  assert.equal((await request('/api/v2/portal/context',{actor:null})).status,401);
  assert.equal((await request('/api/v2/portal/join-requests/create',{method:'POST',body:{workspaceId:companyA,role:'owner'}})).status,400);
  assert.equal((await request('/api/v2/portal/join-requests/create',{method:'POST',body:{workspaceId:companyA},headers:{origin:'https://evil.test'}})).status,403);
  await db.query('INSERT INTO app.platform_administrator(user_id) VALUES($1)', [alice.id]);
  const session = await request('/auth/session');
  assert.equal(session.status,200); assert.equal(session.json.portalEnabled,true); assert.equal(session.json.platformAdministrator,true);
});

test('portal scripts render CMS content without innerHTML or browser identity storage', async () => {
  for (const file of ['src/ui/help/help.js','src/ui/portal/portal.js','src/ui/admin/admin.js']) {
    const source = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/\.innerHTML\b|localStorage|sessionStorage|insertAdjacentHTML|document\.write/.test(source), file);
  }
  const help = await fs.readFile(new URL('../src/ui/help/help.js', import.meta.url), 'utf8');
  assert.match(help, /createTextNode/); assert.match(help, /replaceChildren/);
});
