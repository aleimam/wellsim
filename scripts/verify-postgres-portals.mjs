// Real PostgreSQL and two least-privilege pools; no IdP, live data or HTTP listener.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeDatabase } from '../src/server/database.js';
import { createPortalRepository } from '../src/server/portal-repository.js';
import { createAuthRepository } from '../src/server/auth-repository.js';
import { tokenHash } from '../src/server/auth-http.js';

try {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/bldrz_portal_probe');
} catch {
  console.error('Native portal qualification requires the loopback disposable probe');
  process.exit(1);
}
const env = { ...process.env, WELLSIM_DATABASE_ENABLED:'1', WELLSIM_DB_LOGIN_ROLE:'bldrz_app',
  WELLSIM_DB_RUNTIME_ROLE:'bldrz_runtime', WELLSIM_DB_POOL_MAX:'2' };
const issuer = 'https://portal-qualification.example.test';
const random = () => tokenHash(randomBytes(32).toString('base64url'));
const checks = [];
const pass = (label) => { checks.push(label); console.log(`PASS ${label}`); };
const denied = (operation, code='42501') => assert.rejects(operation, { code });
const settle = (promise) => promise.then(value => ({ok:true,value}), error => ({ok:false,code:error.code}));
const failed = (result, code='42501') => {
  assert.equal(result.ok,false,'queued operation unexpectedly succeeded'); assert.equal(result.code,code);
};
let left, right;
async function signIn(database, name, age=0) {
  const identity = {issuer,subject:name,email:`${name}@example.test`,emailVerified:true,
    ...(age===null?{}:{mfaAuthenticatedAt:Math.floor(Date.now()/1000)-age})};
  const hash=random(), csrf=random();
  const id=await database.onboarding.signIn(identity,hash,csrf,null);
  assert.ok(id);
  return {id,hash,csrf,identity};
}
async function waitForBlock(tx,pid) {
  const deadline=Date.now()+4000;
  while(Date.now()<deadline) {
    await tx.query('SELECT pg_stat_clear_snapshot()');
    const result=await tx.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND usename=session_user AND $1=ANY(pg_blocking_pids(pid))`,[pid]);
    if(result.rows[0].n>0) return;
    await delay(20);
  }
  assert.fail('Competing portal operation never reached the expected PostgreSQL lock');
}
async function race(actor,workspace,waitingOperation,firstOperation,slug=null) {
  let waiting;
  try {
    const first=await left.withTenantTransaction({userId:actor.id,workspaceId:workspace},async tx=>{
      const pid=(await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if(slug) await tx.query('SELECT pg_advisory_xact_lock(7007,hashtext($1))',[slug]);
      else await tx.query('UPDATE app.workspace SET name=name WHERE id=$1',[workspace]);
      waiting=settle(waitingOperation());
      await waitForBlock(tx,pid);
      return firstOperation(createPortalRepository(tx.query),createAuthRepository(tx.query),tx);
    });
    return {first,waiting:await waiting};
  } finally { await waiting; }
}

try {
  left=await initializeDatabase(env); right=await initializeDatabase(env);
  for(const db of [left,right]) {
    await db.auth.ready(); await db.onboarding.ready(); await db.portal.ready();
  }
  const a=await signIn(left,'owner-a'), b=await signIn(right,'owner-b');
  const wa=(await left.onboarding.createCompany(a.hash,'Portal company A')).id;
  const wb=(await right.onboarding.createCompany(b.hash,'Portal company B')).id;
  const outsider=await signIn(right,'outsider');
  for(const name of ['organization_join_request','platform_administrator','help_page','help_revision','platform_audit_event']) {
    await denied(left.withTenantTransaction({userId:a.id,workspaceId:wa},tx=>tx.query(`SELECT * FROM app.${name}`)));
  }
  assert.equal((await left.portal.context(a.hash)).platformAdministrator,false);
  pass('schema 0007 startup and direct portal-table privilege boundaries');

  assert.deepEqual(await right.portal.directory(outsider.hash,''),[]);
  await left.portal.updateCompanySettings(a.hash,wa,'request','North Sea');
  await right.portal.updateCompanySettings(b.hash,wb,'request','Mediterranean');
  assert.deepEqual((await right.portal.directory(outsider.hash,'north')).map(x=>x.id),[wa]);
  const request=await right.portal.createJoinRequest(outsider.hash,wa);
  assert.equal(request.requestedRole,'engineer');
  assert.equal((await right.auth.listWorkspaces(outsider.hash)).some(x=>x.id===wa),false);
  await denied(right.portal.companyJoinRequests(b.hash,wa));
  await denied(right.portal.reviewJoinRequest(b.hash,wb,request.id,'approved'));
  await denied(right.portal.cancelJoinRequest(b.hash,request.id));
  pass('opt-in discovery, request non-authorization and two-company isolation');

  const double=await race(a,wa,()=>right.portal.reviewJoinRequest(a.hash,wa,request.id,'approved'),
    portal=>portal.reviewJoinRequest(a.hash,wa,request.id,'approved'));
  assert.equal(double.first.grantedRole,'engineer'); failed(double.waiting);
  assert.equal((await right.auth.listWorkspaces(outsider.hash)).find(x=>x.id===wa).role_key,'engineer');
  assert.equal((await right.auth.listWorkspaces(outsider.hash)).some(x=>x.id===wb),false);
  pass('observed-lock duplicate approval grants Engineer exactly once');

  const candidate=await signIn(right,'cancel-first');
  const pending=await right.portal.createJoinRequest(candidate.hash,wa);
  const cancelled=await race(a,wa,()=>right.portal.reviewJoinRequest(a.hash,wa,pending.id,'approved'),
    portal=>portal.cancelJoinRequest(candidate.hash,pending.id));
  failed(cancelled.waiting);
  assert.equal((await right.auth.listWorkspaces(candidate.hash)).some(x=>x.id===wa),false);
  pass('request cancellation wins against a queued approval without creating membership');

  const loggedOut=await signIn(right,'revoked-join');
  const revoked=await race(a,wa,()=>right.portal.createJoinRequest(loggedOut.hash,wa),
    (_,auth)=>auth.revokeSession(loggedOut.hash));
  failed(revoked.waiting);
  const signedInAgain=await signIn(right,'revoked-join');
  assert.deepEqual(await right.portal.joinRequests(signedInAgain.hash),[]);
  pass('logout while a join request waits prevents the queued write');

  const admin=await signIn(left,'platform-admin');
  const personal=(await left.auth.listWorkspaces(admin.hash)).find(x=>x.kind==='personal').id;
  assert.equal((await left.portal.context(admin.hash)).platformAdministrator,true);
  await denied(left.portal.adminHelpList(a.hash));
  await denied(left.portal.companyJoinRequests(admin.hash,wa));
  const page={slug:'native-guide',section:'security',sortOrder:10,title:'Native guide',summary:'Synthetic only',bodyMarkdown:'## Published\n\nFirst revision.'};
  await left.portal.saveHelpPage(admin.hash,page);
  assert.equal(await right.portal.helpPage(page.slug),null);
  await left.portal.publishHelpPage(admin.hash,page.slug);
  const revisions=await race(admin,personal,()=>right.portal.saveHelpPage(admin.hash,{...page,bodyMarkdown:'Third draft'}),
    portal=>portal.saveHelpPage(admin.hash,{...page,bodyMarkdown:'Second draft'}),page.slug);
  assert.equal(revisions.first.revision,2); assert.equal(revisions.waiting.ok,true); assert.equal(revisions.waiting.value.revision,3);
  assert.equal((await right.portal.helpPage(page.slug)).revision,1);
  await left.portal.publishHelpPage(admin.hash,page.slug);
  assert.equal((await right.portal.helpPage(page.slug)).revision,3);
  pass('separate platform authority, concurrent immutable revisions and unpublished draft isolation');

  const revokedAdmin=await signIn(right,'platform-admin');
  const adminRace=await race(admin,personal,()=>right.portal.saveHelpPage(revokedAdmin.hash,page),
    (_,auth)=>auth.revokeSession(revokedAdmin.hash),page.slug);
  failed(adminRace.waiting);
  assert.equal((await left.portal.adminHelpPage(admin.hash,page.slug)).revision,3);
  pass('logout while a help save waits prevents publication or new revision');

  const expiring=await signIn(right,'platform-admin',898);
  const expiry=await race(admin,personal,()=>right.portal.saveHelpPage(expiring.hash,page),
    async()=>{ assert.equal((await right.portal.companyJoinRequests(b.hash,wb)).length,0); await delay(2500); },page.slug);
  failed(expiry.waiting,'PM001');
  pass('MFA expiry is rechecked after a help-page lock without blocking another company');

  const basic=await signIn(right,'platform-admin',null);
  await denied(right.portal.publishHelpPage(basic.hash,page.slug),'PM001');
  await left.portal.unpublishHelpPage(admin.hash,page.slug);
  assert.equal(await right.portal.helpPage(page.slug),null);
  pass('ordinary login cannot publish and unpublication removes public content');
  console.log(`NATIVE_PORTAL_VERIFICATION_OK (${checks.length} groups)`);
} catch(error) {
  const location=error.stack?.match(/verify-postgres-portals\.mjs:\d+:\d+/)?.[0]??'unknown location';
  console.error(`NATIVE_PORTAL_VERIFICATION_FAILED after ${checks.length} groups (${error.code??error.name}; ${location})`);
  process.exitCode=1;
} finally {
  await left?.close(); await right?.close();
}
