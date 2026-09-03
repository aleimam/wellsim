import * as oidc from 'openid-client';

export const MFA_ACR = 'http://schemas.openid.net/pape/policies/2007/06/multi-factor';
export const MFA_MAX_AGE_SECONDS = 900;

function secureUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${name}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid ${name}`);
  }
  return url;
}

export function authConfigFromEnv(env = process.env) {
  if (env.WELLSIM_PORTAL_ENABLED === '1' && env.WELLSIM_ONBOARDING_ENABLED !== '1') {
    throw new Error('Portals require controlled onboarding');
  }
  if (env.WELLSIM_ONBOARDING_ENABLED === '1' && env.WELLSIM_AUTH_ENABLED !== '1') {
    throw new Error('Onboarding requires verified authentication');
  }
  if (env.WELLSIM_AUTH_ENABLED !== '1') return Object.freeze({ enabled: false });
  if (env.WELLSIM_DATABASE_ENABLED !== '1' || env.WELLSIM_ENABLE_LEGACY_CASE_STORE === '1') {
    throw new Error('Verified authentication requires PostgreSQL and the legacy store disabled');
  }
  const origin = secureUrl(env.WELLSIM_PUBLIC_ORIGIN, 'public origin');
  const issuer = secureUrl(env.WELLSIM_OIDC_ISSUER, 'OIDC issuer');
  if (origin.pathname !== '/' || issuer.pathname.includes('/.well-known/')) {
    throw new Error('Use an origin and an exact issuer, not a discovery-document URL');
  }
  const clientId = env.WELLSIM_OIDC_CLIENT_ID;
  const clientSecret = env.WELLSIM_OIDC_CLIENT_SECRET;
  if (typeof clientId !== 'string' || !clientId.trim() || clientId.length > 256 ||
      typeof clientSecret !== 'string' || !clientSecret.trim() || clientSecret.length > 4096) {
    throw new Error('OIDC client credentials are required');
  }
  return Object.freeze({ enabled: true, onboardingEnabled: env.WELLSIM_ONBOARDING_ENABLED === '1',
    portalEnabled: env.WELLSIM_PORTAL_ENABLED === '1',
    origin: origin.origin, issuer: env.WELLSIM_OIDC_ISSUER,
    clientId, clientSecret, redirectUri: `${origin.origin}/auth/callback` });
}

export async function createOidcProvider(settings, { fetchImplementation } = {}) {
  const config = await oidc.discovery(new URL(settings.issuer), settings.clientId,
    { client_secret: settings.clientSecret, id_token_signed_response_alg: 'RS256' }, undefined,
    { timeout: 10, execute: [oidc.enableNonRepudiationChecks],
      ...(fetchImplementation ? { [oidc.customFetch]: fetchImplementation } : {}) });
  if (config.serverMetadata().issuer !== settings.issuer) throw new Error('Issuer must match exactly');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    secureUrl(config.serverMetadata()[key], key);
  }
  return Object.freeze({
    async start({ requireMfa = false } = {}) {
      const flow = { state: oidc.randomState(), nonce: oidc.randomNonce(),
        codeVerifier: oidc.randomPKCECodeVerifier() };
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: settings.redirectUri, response_type: 'code', response_mode: 'query',
        scope: settings.onboardingEnabled ? 'openid email' : 'openid', state: flow.state, nonce: flow.nonce,
        code_challenge_method: 'S256', code_challenge: await oidc.calculatePKCECodeChallenge(flow.codeVerifier),
        ...(requireMfa ? { acr_values: MFA_ACR, max_age: '0', prompt: 'login' } : {}),
      });
      return { flow, url: url.href };
    },
    async finish(callback, flow) {
      if (callback.origin + callback.pathname !== settings.redirectUri) throw new Error('Invalid callback');
      const tokens = await oidc.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: flow.codeVerifier, expectedState: flow.state,
        expectedNonce: flow.nonce, idTokenExpected: true,
        ...(flow.requireMfa === true ? { maxAge: MFA_MAX_AGE_SECONDS } : {}),
      });
      const claims = tokens.claims();
      if (!claims || claims.iss !== settings.issuer || typeof claims.sub !== 'string'
          || !claims.sub || claims.sub.length > 255) throw new Error('Invalid identity');
      const now = Math.floor(Date.now() / 1000);
      // Auth0's signed AMR claim is evidence; requesting an ACR is not.
      // Use auth_time, never token issuance time, so SSO/token renewal cannot
      // silently refresh an old MFA window. Only step-up records gain assurance.
      let assurance = {};
      if (flow.requireMfa === true) {
        if (!Array.isArray(claims.amr) || !claims.amr.every((v) => typeof v === 'string') ||
          !claims.amr.includes('mfa') || !Number.isSafeInteger(claims.auth_time) ||
          claims.auth_time > now + 60 || claims.auth_time <= now - MFA_MAX_AGE_SECONDS) {
          throw new Error('Fresh MFA required');
        }
        assurance = { mfaAuthenticatedAt: Math.min(now, claims.auth_time) };
      }
      // Access/refresh/ID tokens are deliberately neither returned nor stored.
      // A verified immutable issuer+subject pair is the only identity key.
      if (settings.onboardingEnabled) {
        if (claims.email_verified !== true || typeof claims.email !== 'string'
          || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) {
          throw new Error('A verified email claim is required');
        }
        return Object.freeze({ issuer: claims.iss, subject: claims.sub,
          email: claims.email.trim().toLowerCase(), emailVerified: true, ...assurance });
      }
      return Object.freeze({ issuer: claims.iss, subject: claims.sub, ...assurance });
    },
  });
}
