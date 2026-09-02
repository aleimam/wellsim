# Auth0 login and company-administrator MFA

## Status — not activated

Auth0 is the selected dedicated provider for **bldrz.net only**. The local
comparison branch implements MFA step-up and migration `0006_administrator_mfa`.
The user is signed into the US development tenant `dev-mfke2ibpyq53l133`.
Following explicit approval, the `bldrz Comparison` Regular Web Application was
created and its confidential-client settings saved. The client-bound Post Login
Action was created, tested and deployed, but **is not attached to the login
flow yet**: the flow editor did not respond to automated drag-and-drop. The user
has been asked to attach it and click Apply. Authenticator OTP and recovery-code
factors are enabled in the development tenant. No paid plan has been purchased,
and no live MFA migration or authentication activation has occurred. The client
secret has not yet been supplied to the private local file or installed on the
server. Provider configuration is therefore incomplete, not an operational login.
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

## Qualification receipt — 2 September 2026

Candidate `6a013dd8a6d9e67d9b312c06920020ec46d1819c` passed:

- 318/318 automated tests across 36 files and 43/43 engineering sweep checks.
- `npm audit --omit=dev` reported zero vulnerabilities at qualification time.
- `NATIVE_ONBOARDING_VERIFICATION_OK (14 groups)` on native PostgreSQL with
  two independent application pools, including actual observed lock waits for
  session revocation during step-up and MFA expiry during company management.
- `BLDRZ_RESTORE_DRILL_OK`, catalog checks, both-direction company isolation,
  identity/onboarding and MFA after an encrypted synthetic round trip.
- Visual inspection of the MFA panel in the synthetic, loopback-only preview.
  This is not real-provider enrollment or browser-MFA acceptance evidence.

Source archive SHA-256:
`4d634707bd938f5f975f6a2e697a79d00b649d5057de0f1b453f0a2ac712acef`.
The staged source is `/opt/bldrz/staging/mfa-6a013dd`; it is not the active app.
Recovery source: retained off-server bundle
`bldrz-20260902T164102.168037194Z`. All four transfer checksums and local dump
decryption passed. Restored source-data fingerprint matched the release:
`85f0b979d29a0e6367226bb68640a649036ca3bdd8a4b8ce73648b5a26ec0a88`.

The disposable native database, private restore cluster, temporary plaintext
dump copies on both machines and local preview process were removed/stopped.
Encrypted source backups remain. Live migration history stayed 0001–0005;
`bldrz.service` PID 19195 and `wellsim.service` PID 1887 remained unchanged.
The implementation is committed locally, not pushed or deployed. Real browser
tests and the activation gates above remain unfinished. The subsequent provider
configuration receipt below supersedes the earlier pending-creation status.

## Provider configuration receipt — 2 September 2026

Configured through the Auth0 dashboard in Chrome after the user's approval:

- Tenant: `dev-mfke2ibpyq53l133` (US development).
- Issuer, independently verified using public OIDC discovery:
  `https://dev-mfke2ibpyq53l133.us.auth0.com/`.
- Application: `bldrz Comparison`, Regular Web Application, first-party.
  Public client ID: `hzntZyd10WXgb9gqiRQhq4obm8s9miVZ`.
- Application Login URI: `https://bldrz.net/auth/login`; the only allowed
  callback is `https://bldrz.net/auth/callback`. No logout URLs, browser origins,
  CORS origins or cross-origin authentication were added.
- Authorization Code is enabled; Implicit, Refresh Token and Client Credentials
  grants were disabled. Password and MFA-API grants remain disabled. Universal
  Login step-up uses the code flow, not the Resource Owner Password/MFA API flow.
- Client authentication: Client Secret (Post); signing RS256; OIDC conformity
  enabled; ID token lifetime 300 seconds. No secret was revealed in tool output,
  screenshots, Git or documentation.
- One-time Password (authenticator/TOTP) and Recovery Code factors are enabled.
  Other factors remain disabled. No individual user has enrolled through this
  work or generated recovery codes. Tenant-wide Require MFA remains Never:
  the client-bound Action is intended to request MFA only for bldrz step-up.
  **Until the Action is attached and a real challenge verified, this is not
  evidence of enforced provider MFA.**
- Action: `bldrz verified email and administrator MFA`, ID
  `e0ca400a-3bc6-4d32-94e2-a72df6510380`, Post Login, Node 22. Its source was
  compared exactly with `deploy/auth0/bldrz-post-login.cjs` before deployment.
  Action secret `BLDRZ_CLIENT_ID` contains the public client ID above. The
  dashboard reported Action is up to date after deployment.
- Built-in Action tests with synthetic events returned the expected commands:
  verified bldrz step-up required MFA with `allowRememberBrowser: false`;
  unverified bldrz login was denied; verified ordinary bldrz login and an
  unrelated client produced no commands. All four had an empty Error result.
  These are provider Action-unit tests, **not** enrollment or signed-token
  callback acceptance evidence.

Connection inspection initially found both `Username-Password-Authentication`
and `google-oauth2` enabled for bldrz by default. After the user approved the
specific removal, Google login was disabled **for the bldrz application only**
through Chrome. A page reload confirmed the Google toggle remained off and
the password connection remained on. The shared Google connection was not
deleted and other applications' connection settings were not changed.
The password connection has improved brute-force protection enabled,
public signup enabled, and domain-level promotion disabled. Its password-policy
editor did not display a populated minimum length, so effective password strength
has not been qualified. Password history/dictionary/profile-data controls were
unavailable behind a plan upgrade notice. No password-policy edits were saved.

Tenant attack protection shows Suspicious IP Throttling and Brute-force
Protection enabled; Bot Detection and Breached Password Detection disabled.
Those tenant-wide settings were inspected only, not changed. Confirm the
intended connection policy and any applicable plan entitlement before activation.
The dashboard showed 22 trial days remaining and marked OTP/recovery as PRO MFA;
this does not establish free-plan availability after the trial.

User handoffs still pending:

1. In the Post Login flow, drag the deployed bldrz Action between Start and
   Complete and click Apply; then verify the persisted binding.
2. Save only the application's Client Secret in the restricted, Git-excluded
   local file `C:\Claude\WellSim\secrets\auth0\bldrz-client-secret.txt`.
   The folder ACL is limited to the Windows account, SYSTEM and administrators.
   At the last check the file did not exist. Do not paste it into chat.
3. Complete real pilot-account email verification and authenticator enrollment
   personally; store recovery codes securely. Do not enable public bldrz login
   before the deployment, callback, isolation and recovery gates pass.

On the follow-up after Google removal, the Post Login flow still contained only
Start and Complete, and the local client-secret file was still absent. Those
two handoffs remain blockers; the removal did not activate authentication or
change any bldrz/wellsim deployment. Connection/attack policies still require
qualification before pilot activation.

A read-only server check after provider setup confirmed bldrz still points to
`d5187b43cd298c0df21a83b7eec42e378eba2a23`; both services remained active with
unchanged PIDs (bldrz 19195, wellsim 1887). No production service or database
was changed during provider configuration.

## Primary references

- [Auth0 step-up for web applications](https://auth0.com/docs/secure/multi-factor-authentication/step-up-authentication/configure-step-up-authentication-for-web-apps)
- [Post Login Action API](https://auth0.com/docs/actions/reference/post-login/post-login-api-object)
- [Regular Web Application registration](https://auth0.com/docs/get-started/auth0-overview/create-applications/regular-web-apps)
- [Application settings](https://auth0.com/docs/get-started/applications/application-settings)
- [Current pricing — verify the applicable plan before purchasing](https://auth0.com/pricing)
