# Auth0 login and company-administrator MFA

## Status — not activated

Auth0 is the selected dedicated provider for **bldrz.net only**. The local
comparison branch implements MFA step-up and migration `0006_administrator_mfa`.
No Auth0 tenant/application/Action has been configured, no paid plan has been
purchased, and no live MFA migration or authentication activation has occurred.
The last verified live release is `d5187b4`, schema 0001–0005, with authentication,
onboarding and legacy persistence disabled. `wellsim.app` is outside this work.

## Enforced policy

- A normal verified sign-in creates/opens a private workspace. It grants **no
  MFA assurance**, even when unsolicited MFA claims appear on that login.
- Company creation requires recent MFA because it creates an owner. Current
  owners/administrators need recent MFA for team lists, invitations, membership
  changes and leaving a company. Accepting an administrator invitation also
  requires the recipient's own MFA. Ordinary member invitations and private
  profile changes do not require elevated assurance.
- This is a company-management step-up policy, not mandatory MFA for every
  engineer, calculation or company-data read. Future sensitive data/export
  endpoints need an explicit assurance policy in addition to tenant checks.
- `POST /auth/step-up` requires an active opaque cookie session, exact Origin
  and session-specific CSRF. The one-time flow records the expected local user.
- Authorization requests use code + S256 PKCE, state, nonce, `prompt=login`,
  `max_age=0`, and the Auth0-supported MFA ACR. The signed ID token must contain
  `amr` including `mfa` and a numeric `auth_time` within 15 minutes. Requesting
  an ACR or passing an MFA flag from the browser is never evidence.
- The OIDC client verifies RS256 signature, issuer, audience, nonce and expiry.
  The application also rejects malformed, absent, old or future MFA claims
  (up to 60 seconds clock skew, clamped to now). It does not retain IdP tokens.
- MFA callbacks must resolve to the original immutable issuer/subject mapping
  and an active prior browser session for that same local user. Logout/rotation
  is serialized with step-up; a revoked session cannot be resurrected. Success
  rotates both session and CSRF tokens. Failed verification does not elevate,
  switch accounts or automatically retry a management action.
- PostgreSQL stores the assurance time and rechecks it after company/user
  locks, using wall-clock time. The 15-minute window is not extended by session
  reads, token issuance time or normal login. The original onboarding function
  is now a private helper; runtime/PUBLIC cannot execute it or edit MFA columns.
- MFA never changes company membership or defeats row-level security. Neither
  a second company nor a matching email/domain grants any additional access.

## Provider configuration checklist

Complete account sign-in/registration with the intended human account owner.
Do not reuse another application's OAuth credentials. The account owner must
choose/approve the tenant region and any billable plan before purchase. Confirm
that the selected Auth0 plan supports the required MFA policy for this use case;
a successful trial is not proof of continued availability after trial expiry.

1. Create a dedicated tenant and **Regular Web Application**, not an SPA.
   Use RS256, authorization-code flow and confidential client authentication.
2. Allow the exact callback `https://bldrz.net/auth/callback` only. No wildcards,
   `wellsim.app`, development callbacks or third-party return destinations.
   Browser CORS origins are unnecessary for this server-side token exchange.
3. Use verified-email accounts, approved password strength/breached-password
   protections and provider attack protection. Do not auto-link accounts by
   email. Company permissions remain in PostgreSQL, not user-editable metadata.
4. Enable the approved authenticator factor(s), enrollment and recovery policy.
   TOTP plus securely saved recovery codes is the initial candidate; verify
   provider support and cost. Do not silently substitute email/SMS as the
   administrator second factor. Tenant administrators also secure their Auth0
   dashboard accounts with MFA.
5. Install `deploy/auth0/bldrz-post-login.cjs` as a Post Login Action. Set the
   Action secret `BLDRZ_CLIENT_ID` to this client's ID, deploy it and attach it
   to the Login flow. It rejects unverified email and requires MFA when this
   dedicated client requests step-up, with remembered-browser bypass disabled.
   This file is a template, **not evidence that an Action is installed**.
6. Store issuer, client ID and client secret only in the private server-side
   bldrz environment. Never put credentials in Git, frontend bundles, command
   output, screenshots or this document. Keep both activation flags off until
   the pilot passes. No migration-owner credential belongs in the web process.

## Deployment and recovery qualification

The current application expects 0006 whenever authentication is enabled.
Migration 0006 must precede enabling that code; do not try to serve active
authentication from code/schema versions that disagree. The migration does not
alter cluster roles, PostgreSQL binding or the other site's service.

`deploy/render-bldrz-mfa.sh` emits one transaction with an exact 0001–0005
baseline guard, explicit owner role and timeouts. It can target only bldrz or
named disposable probes. Rendering alone changes nothing. A live rollout needs
a fresh encrypted off-server backup, qualified revision, rollback records and
explicit activation checks. Never revert to pre-MFA code while leaving login
enabled; disable authentication first if rollback is required.

`deploy/verify-bldrz-onboarding.sh` clones only live schema/reference data into
`bldrz_onboarding_probe`, adds 0006 there, runs native multi-connection security
tests with synthetic identities, then removes its own probe. It refuses an
existing probe or a changed live baseline. `verify-bldrz-auth.sh` now delegates
to this combined runner; prior stage-2a receipts remain historical evidence.

`deploy/verify-bldrz-restore.sh SOURCE DECRYPTED_DUMP qualify-mfa` restores the
source into a private socket-only cluster, applies 0006 only to a separate
synthetic clone, encrypts/restores it, and checks catalog, data, isolation,
sessions, invitations and MFA. The recovered source and live database are
unchanged. The real recovery identity stays off-server.

## Activation gates still required

- Real Auth0 enrollment, fresh challenge, cancellation/wrong code, lost-factor
  recovery, email verification and same-account browser callback tests.
- Confirm an ordinary password/SSO response, remembered browser or stale token
  cannot open company management. Confirm step-up never enrolls another account.
- Two-company browser pilot: no cross-company reads, writes, links or exports;
  recheck last-owner protection, role downgrade and session revocation.
- Callback query/cookie/token log redaction, public abuse throttling, identity
  monitoring and a deliberate account-disable/local-session-revocation process.
  Provider logout/password reset does not currently revoke existing local
  sessions automatically; local logout, expiry or local disablement does.
- Independent scheduled backups, retention, failure alerts and a second durable
  recovery-key copy before real customer persistence. Capacity remains unproven.

## Primary references

- [Auth0 step-up for web applications](https://auth0.com/docs/secure/multi-factor-authentication/step-up-authentication/configure-step-up-authentication-for-web-apps)
- [Post Login Action API](https://auth0.com/docs/actions/reference/post-login/post-login-api-object)
- [Regular Web Application registration](https://auth0.com/docs/get-started/auth0-overview/create-applications/regular-web-apps)
- [Application settings](https://auth0.com/docs/get-started/applications/application-settings)
- [Current pricing — verify the applicable plan before purchasing](https://auth0.com/pricing)
