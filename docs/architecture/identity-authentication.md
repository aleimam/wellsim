# Verified authentication — provisioned-access foundation

## Decision and scope

Use OpenID Connect authorization-code flow with a maintained client library
(`openid-client` 6.8.7). Provider selection remains open; no identity-provider
account was created and no provider credential was reused from another
application. Only an exact configured issuer is trusted, with an RS256 client
registration and an exact HTTPS redirect URI.

This is **stage 2a**, not completed onboarding. It implements verified sign-in,
server-side sessions and read-only workspace discovery for identities and
memberships provisioned administratively. It does not implement public signup,
automatic personal-workspace creation, company creation, invitation acceptance,
member/role-management UI, MFA step-up, or engineering-data persistence.
Those flows need their own transactional authorization tests before exposure.
An organization owner/administrator must have an approved stronger-authentication
policy before a public pilot. Email addresses and company domains never grant
membership automatically.

The three stages after this slice remain: controlled onboarding/invitations,
the first persisted engineering workflow, and realistic capacity testing.
Automatic independent backups remain a separate prerequisite for customer data.

## Current activation state

- Local source includes migration `0004_verified_sessions`.
- The live `bldrz` database remains at `0001`–`0003`; `0004` is not applied there.
- `WELLSIM_AUTH_ENABLED` defaults off. No live provider registration, callback
  or sign-in button has been activated.
- `wellsim.app` is outside this change. The old JSON account store stays off.

## Trust boundaries

1. A server-generated browser-flow cookie identifies a ten-minute one-time
   database record containing random state, nonce and PKCE verifier.
2. The callback atomically consumes that record before attempting exchange.
   Missing, duplicate, mismatched, expired or reused state cannot sign in.
3. The OIDC client validates state, PKCE, ID-token presence, issuer, audience,
   expiry and nonce. Explicit JWS verification checks the ID-token signature
   against the issuer's JWKS. No insecure-HTTP mode is provided.
4. Only the verified `(issuer, subject)` pair reaches the identity repository.
   It must exactly match an existing active `auth_identity`/`app_user` pair;
   matching an email address does not link or create an account.
5. A fresh random session token replaces the prior session after successful
   sign-in. Only its SHA-256 digest is stored in PostgreSQL; provider access,
   refresh and ID tokens are discarded.
6. Workspace listing checks current user/workspace/membership status, expiry
   and permissions. Individual workspace access uses the existing transaction
   helper, with the session-derived user ID and a membership-checked selection.

The identity functions are a trusted server boundary, not independent OIDC
verifiers. Database administrator access or arbitrary SQL execution in the
application process is outside this isolation threat model: the existing
tenant context already relies on trusted server SQL. Never expose a function
call, issuer/subject override, user-ID override or raw query endpoint to clients.

## Browser/server contract

| Endpoint | Method | Purpose |
|---|---|---|
| `/auth/login` | GET | Start a fresh browser-bound OIDC flow |
| `/auth/callback` | GET | Consume the flow and verify the provider response |
| `/auth/session` | GET | Return the current local user and CSRF token |
| `/auth/logout` | POST | Revoke session; exact Origin and CSRF token required |
| `/api/v2/workspaces` | GET | List only the session user's active workspaces |
| `/api/v2/workspace` | GET | Read one workspace selected with `X-Workspace-Id` |

All responses are `no-store`; errors are sanitized. Callback destinations are
fixed at `/`, not supplied through `returnTo`. Callback URLs, cookies, tokens,
claims and raw database/provider errors must not be logged. Before activation,
review proxy/access-log redaction for `/auth/callback`, including query strings.
No cross-origin credentialed access or bearer-token override is supported.

Cookies use `__Host-` names, `Secure`, `HttpOnly`, `Path=/`, no Domain, and
`SameSite=Lax` for the external-provider GET callback. Logout additionally
requires exact configured Origin and a session-specific CSRF token; SameSite
is not its sole defense. Tokens are never put in localStorage. Session lifetime
is at most eight hours, with a thirty-minute sliding idle deadline. Provider
single logout/back-channel logout and refresh are not implemented.

## Database implementation

`0004` adds global identity-plane `login_transaction`, `web_session` and
append-only `authentication_event` tables. They have RLS enabled with no
runtime policies/direct table grants. Narrow owner-controlled `SECURITY
DEFINER` functions use a fixed `pg_catalog` search path and fully qualified
application objects; PUBLIC execution is revoked. Roles are unchanged.

`auth-repository.js` exposes fixed operations only, never caller SQL or a raw
pool. Authentication and tenant operations share the same bounded connection
pool/admission limit. Every identity operation uses transaction-local runtime
role, clears tenant context, and commits or rolls back before release; failed
rollback discards the connection. Startup checks the function owners, fixed
search paths, execution grants and absence of direct identity-table grants.

Login starts are capped at 1,000 shared outstanding flows; HTTP handling has a
20-in-flight process cap. At most ten live sessions per user are retained.
Expired flows are pruned on new starts; expired/revoked sessions are pruned on
successful sign-in. These bounds do not replace public abuse throttling,
database maintenance policies, telemetry, or measured capacity testing.
Sessions and one-time callback state are shared across application processes,
not held in process memory. Role changes are read from memberships, not cached
as claims in a cookie; member-management session-rotation policy is still part
of the future management workflow.

## Verification

The local OIDC tests exercise the real client with a synthetic HTTPS issuer
transport and RSA-signed ID tokens. They reject bad signatures, wrong
issuer/audience/nonce, expired or missing tokens, bad state, spoofed callbacks,
insecure discovery metadata and failed PKCE exchanges. They make no external
provider calls.

PGlite tests apply all four migrations and exercise the real SQL functions,
cookie/HTTP boundary and company/private-workspace isolation. They cover
provisioning-only mapping, callback replay, flow/session bounds, expiration,
revocation, role/membership changes, forged identity headers/bodies, cookie
duplication, logout CSRF and fail-closed disabled/error behavior. Existing
engineering and adversarial cross-tenant suites remain mandatory.

Native verification is isolated by `deploy/verify-bldrz-auth.sh`. It refuses
an existing `bldrz_auth_probe`, copies only live schema/reference definitions,
applies `0004` only to that disposable clone, seeds synthetic users, then uses
the real application login and two independent connection pools to check
single-use callback consumption, shared sessions/revocation, personal/company
workspace discovery and denied cross-company reads, writes, links and exports.
The probe is dropped afterward. This is not a provider/browser acceptance test
or a user-capacity benchmark.

## Activation checklist — not automatic

1. Choose an identity provider and register a dedicated bldrz OIDC client with
   exact redirect `https://bldrz.net/auth/callback`; use a concrete issuer (for
   Entra, a specific approved tenant, not an unrestricted common endpoint).
2. Resolve independent backup destination/retention, failure alerts and key
   redundancy before accepting real customer state. Requalify backup/restore
   for migration `0004`: existing recovery catalog assertions deliberately
   still require the live `0001`–`0003` schema and must be updated/tested first.
3. Review provider policy (including owner/admin MFA), callback log redaction,
   abuse controls and operational session-maintenance/alerting requirements.
4. Render/apply the reviewed migration under `bldrz_migration_owner`, replacing
   portable `wellsim_runtime` with `bldrz_runtime`, only to bldrz. Never use the
   owner credential from the web process. Back up before migration.
5. Provision a small approved pilot identity and memberships from verified
   provider identifiers; do not infer issuer/subject from email or user input.
6. Supply server-side environment configuration privately:

   ```text
   WELLSIM_AUTH_ENABLED=1
   WELLSIM_DATABASE_ENABLED=1
   WELLSIM_ENABLE_LEGACY_CASE_STORE=0
   WELLSIM_PUBLIC_ORIGIN=https://bldrz.net
   WELLSIM_OIDC_ISSUER=<exact approved issuer>
   WELLSIM_OIDC_CLIENT_ID=<dedicated client id>
   WELLSIM_OIDC_CLIENT_SECRET=<secret, never committed or logged>
   ```

7. Test the real provider/browser flow, same-origin cookie/CSRF behavior,
   logout, revocation, account disablement and tenant boundaries before
   enabling an authenticated UI. Keep engineering persistence gated until
   its workflow and recovery tests are complete.

## Primary references

- [openid-client](https://github.com/panva/openid-client) and its
  [code-grant checks](https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md).
- [Explicit signature verification](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md).
- OWASP [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
  [OAuth2](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html) and
  [CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
