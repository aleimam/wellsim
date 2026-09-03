import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { authConfigFromEnv, createOidcProvider, MFA_ACR } from '../src/server/oidc.js';

const env = { WELLSIM_AUTH_ENABLED: '1', WELLSIM_DATABASE_ENABLED: '1',
  WELLSIM_PUBLIC_ORIGIN: 'https://bldrz.example.test',
  WELLSIM_OIDC_ISSUER: 'https://issuer.example.test',
  WELLSIM_OIDC_CLIENT_ID: 'test-client', WELLSIM_OIDC_CLIENT_SECRET: 'test-secret' };
const settings = authConfigFromEnv(env);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

async function fixture(override = {}, { badSignature = false, missingToken = false,
    issuerOverride, badEndpoint = false, badVerifier = false, onboardingEnabled = false, requireMfa = false } = {}) {
  let flow;
  let requestParameters;
  let jwksRequests = 0;
  const provider = await createOidcProvider({ ...settings, onboardingEnabled }, { fetchImplementation: async (input, options) => {
    const url = new URL(String(input));
    const reply = (value, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { 'content-type': 'application/json' },
    });
    if (url.pathname === '/.well-known/openid-configuration') return reply({
      issuer: issuerOverride ?? settings.issuer,
      authorization_endpoint: `${settings.issuer}/authorize`,
      token_endpoint: `${badEndpoint ? 'http://issuer.example.test' : settings.issuer}/token`,
      jwks_uri: `${settings.issuer}/jwks`, response_types_supported: ['code'],
      subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    });
    if (url.pathname === '/jwks') { jwksRequests += 1; return reply({ keys: [jwk] }); }
    assert.equal(url.pathname, '/token');
    requestParameters = new URLSearchParams(options.body);
    assert.equal(requestParameters.get('redirect_uri'), settings.redirectUri);
    assert.equal(requestParameters.get('client_id'), settings.clientId);
    assert.equal(requestParameters.get('client_secret'), settings.clientSecret);
    assert.equal(requestParameters.get('code_verifier'), flow.codeVerifier);
    if (badVerifier) return reply({ error: 'invalid_grant' }, 400);
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: settings.issuer, sub: 'subject-A', aud: settings.clientId,
      iat: now, exp: now + 300, nonce: flow.nonce, ...override };
    const body = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode(claims)}`;
    const signature = sign('RSA-SHA256', Buffer.from(body), badSignature ? wrongKeys.privateKey : keys.privateKey);
    return reply({ access_token: 'must-not-escape-server', token_type: 'Bearer',
      ...(!missingToken && { id_token: `${body}.${signature.toString('base64url')}` }) });
  } });
  const started = await provider.start({ requireMfa });
  flow = { ...started.flow, requireMfa };
  const callback = new URL(settings.redirectUri);
  callback.searchParams.set('code', 'one-use-code');
  callback.searchParams.set('state', flow.state);
  return { provider, flow, callback, authorization: new URL(started.url),
    get requests() { return { requestParameters, jwksRequests }; } };
}

test('OIDC configuration is disabled by default and rejects unsafe origins, issuers and legacy auth', () => {
  assert.deepEqual(authConfigFromEnv({}), { enabled: false });
  assert.throws(() => authConfigFromEnv({ WELLSIM_PORTAL_ENABLED: '1' }), /Portals require/);
  assert.equal(settings.issuer, env.WELLSIM_OIDC_ISSUER, 'issuer trailing slash must not be rewritten');
  for (const changes of [
    { WELLSIM_DATABASE_ENABLED: '0' }, { WELLSIM_ENABLE_LEGACY_CASE_STORE: '1' },
    { WELLSIM_PUBLIC_ORIGIN: 'http://bldrz.example.test' },
    { WELLSIM_PUBLIC_ORIGIN: 'https://bldrz.example.test/subpath' },
    { WELLSIM_OIDC_ISSUER: 'https://issuer.example.test/.well-known/openid-configuration' },
    { WELLSIM_OIDC_ISSUER: 'https://user:secret@issuer.example.test' },
    { WELLSIM_OIDC_CLIENT_SECRET: '' },
  ]) assert.throws(() => authConfigFromEnv({ ...env, ...changes }));
});

test('real OIDC client requires PKCE, state, nonce and a verified signature; no provider tokens escape', async () => {
  const f = await fixture();
  assert.equal(f.authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(f.authorization.searchParams.get('response_type'), 'code');
  assert.equal(f.authorization.searchParams.get('scope'), 'openid');
  assert.equal(f.authorization.searchParams.get('nonce'), f.flow.nonce);
  assert.ok(f.authorization.searchParams.get('code_challenge'));
  assert.deepEqual(await f.provider.finish(f.callback, f.flow), { issuer: settings.issuer, subject: 'subject-A' });
  assert.equal(f.requests.jwksRequests, 1, 'signature verification must use issuer JWKS');
});

test('real OIDC client rejects forged, expired, wrong-issuer/audience/nonce and missing ID tokens', async () => {
  for (const [claims, options] of [
    [{}, { badSignature: true }], [{}, { missingToken: true }], [{}, { badVerifier: true }],
    [{ iss: 'https://attacker.example.test' }, {}], [{ aud: 'other-client' }, {}],
    [{ nonce: 'wrong-nonce' }, {}], [{ exp: 1 }, {}], [{ sub: '' }, {}],
  ]) {
    const f = await fixture(claims, options);
    await assert.rejects(f.provider.finish(f.callback, f.flow));
  }
});

test('OIDC rejects wrong/duplicate state, callback-origin spoofing and insecure discovery metadata', async () => {
  const f = await fixture();
  const wrong = new URL(f.callback); wrong.searchParams.set('state', 'attacker');
  await assert.rejects(f.provider.finish(wrong, f.flow));
  const duplicate = new URL(f.callback); duplicate.searchParams.append('state', f.flow.state);
  await assert.rejects(f.provider.finish(duplicate, f.flow));
  const elsewhere = new URL(f.callback); elsewhere.hostname = 'attacker.example.test';
  await assert.rejects(f.provider.finish(elsewhere, f.flow));
  await assert.rejects(fixture({}, { issuerOverride: 'https://different.example.test' }));
  await assert.rejects(fixture({}, { badEndpoint: true }));
});

test('onboarding requests email scope and requires a signature-verified boolean email verification claim', async () => {
  const f = await fixture({ email: 'ALICE@example.test', email_verified: true }, { onboardingEnabled: true });
  assert.equal(f.authorization.searchParams.get('scope'), 'openid email');
  assert.deepEqual(await f.provider.finish(f.callback, f.flow), { issuer: settings.issuer, subject: 'subject-A',
    email: 'alice@example.test', emailVerified: true });
  for (const claims of [{}, { email: 'a@example.test' }, { email: 'a@example.test', email_verified: 'true' },
    { email: 'a@example.test', email_verified: false }, { email: 'bad', email_verified: true }]) {
    const bad = await fixture(claims, { onboardingEnabled: true });
    await assert.rejects(bad.provider.finish(bad.callback, bad.flow));
  }
});

test('MFA step-up requests fresh authentication and trusts only verified signed AMR plus auth_time', async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { amr: ['pwd', 'mfa'], auth_time: now, email: 'alice@example.test', email_verified: true };
  const f = await fixture(claims, { requireMfa: true, onboardingEnabled: true });
  assert.equal(f.authorization.searchParams.get('acr_values'), MFA_ACR);
  assert.equal(f.authorization.searchParams.get('prompt'), 'login');
  assert.equal(f.authorization.searchParams.get('max_age'), '0');
  assert.deepEqual(await f.provider.finish(f.callback, f.flow), { issuer: settings.issuer, subject: 'subject-A',
    email: claims.email, emailVerified: true, mfaAuthenticatedAt: now });
  assert.equal(f.requests.jwksRequests, 1);
  const ordinary = await fixture(claims);
  assert.equal(ordinary.authorization.searchParams.has('acr_values'), false);
  assert.equal((await ordinary.provider.finish(ordinary.callback, ordinary.flow)).mfaAuthenticatedAt, undefined);
});

test('MFA fails closed on missing, malformed, stale or forged assurance even with a requested ACR', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const override of [{ amr: undefined }, { amr: 'mfa' }, { amr: ['pwd'] }, { amr: ['mfa', true] },
    { auth_time: undefined }, { auth_time: String(now) }, { auth_time: now - 901 }, { auth_time: now + 120 }]) {
    const f = await fixture({ amr: ['mfa'], auth_time: now, acr: MFA_ACR, ...override }, { requireMfa: true });
    await assert.rejects(f.provider.finish(f.callback, f.flow));
  }
  const forged = await fixture({ amr: ['mfa'], auth_time: now }, { requireMfa: true, badSignature: true });
  await assert.rejects(forged.provider.finish(forged.callback, forged.flow));
});

test('Auth0 Action isolates the dedicated client, requires verified email and challenges requested MFA', async () => {
  const action = { exports: {} };
  vm.runInNewContext(await fs.readFile(new URL('../deploy/auth0/bldrz-post-login.cjs', import.meta.url), 'utf8'), action);
  async function run(changes = {}) {
    const result = { denied: false, mfa: false };
    await action.exports.onExecutePostLogin({ secrets: { BLDRZ_CLIENT_ID: 'bldrz-client' },
      client: { client_id: 'bldrz-client' }, user: { email_verified: true },
      transaction: { acr_values: [MFA_ACR] }, ...changes }, {
      access: { deny() { result.denied = true; } },
      multifactor: { enable(factor, options) { assert.equal(factor, 'any');
        assert.equal(options.allowRememberBrowser, false); result.mfa = true; } },
    });
    return result;
  }
  assert.deepEqual(await run(), { denied: false, mfa: true });
  assert.deepEqual(await run({ client: { client_id: 'other-app' } }), { denied: false, mfa: false });
  assert.deepEqual(await run({ transaction: { acr_values: [] } }), { denied: false, mfa: false });
  assert.deepEqual(await run({ secrets: {} }), { denied: true, mfa: false });
  assert.deepEqual(await run({ user: { email_verified: 'true' } }), { denied: true, mfa: false });
});
