# Company and user onboarding — local stage 2b

## Status and boundaries

Implemented on `codex/v2-foundation`, 2 September 2026. No deployment, live
migration, provider registration, email delivery or production restart was
performed for this slice. `wellsim.app` is untouched. The last verified live
`bldrz` schema remains 0001–0003; source now includes 0004 and 0005.

`WELLSIM_ONBOARDING_ENABLED=1` is a **separate, default-off** flag requiring
verified authentication and PostgreSQL. With the flag off, management routes
return 404, sign-in remains provisioned-only, and the workspace page explains
that onboarding is unavailable. No link was added to the live engineering UI.

## User experience

- `/workspace.html`: profile name, workspace selector, company creation,
  company member management, invitation creation/revocation/acceptance and leave.
- First verified sign-in creates one private workspace and owner membership
  atomically with identity/session creation. Subsequent sign-ins reuse it.
  Personal workspaces cannot be shared or issue invitations.
- Company creation is explicit and atomic: company workspace + organization +
  creator's owner membership + audit event. Names do not prove legal company
  ownership, reserve domains or attach existing users/data.
- Identity is still the signature-verified OIDC issuer/subject. Onboarding also
  requires a signed `email` claim and boolean `email_verified=true`; an IdP
  that does not supply these is unsupported by this flow until explicitly
  integrated. Email comparisons follow the existing case-insensitive model.
- A matching email never auto-links another provider/subject. Existing account
  email changes and collisions fail closed pending an administrative recovery
  workflow; no client can supply an issuer, subject or verified-email override.
- No password storage, email-domain admission, developer/platform role or
  cross-company migration is exposed. New users initially have display name
  “New user” and can edit it; arbitrary profile HTML is rendered as text.

## Permission model

| Role | Company management |
|---|---|
| Owner | Manage members, grant/revoke administrator or owner roles; cannot remove the last active owner |
| Administrator | Invite/manage engineering manager, engineer, reviewer and viewer; cannot modify an owner or administrator |
| Engineering manager / engineer / reviewer / viewer | No membership administration; may leave their own company |

Existing engineering permission definitions remain unchanged. Invitation roles
exclude owner and the reserved external-collaborator role. Ownership can be
granted only to an existing member by an owner, not by a token alone. Suspension
and removal retain membership rows for audit and foreign-key provenance.
Restoring access is an authorized member change, not invitation replay.
Existing membership expiration timestamps are preserved, so an expired imported
membership also needs controlled administrative expiry correction to reactivate.

All company operations serialize on that workspace row. Authority is re-read
after acquiring the lock. Acceptance rechecks the inviter's current membership,
role, account state, expiry and workspace state. Pending invitations issued by
a member are revoked on **any** member-role/status change through this workflow.
Last-owner checks count only other active, non-expired owners with active users.
Administratively disabling/expiring the last owner outside this workflow still
requires operator recovery; there is no automated ownership reassignment.

Membership permissions are not stored in cookies. Changed access is effective
for subsequent database permission checks; a statement already in flight is
not retroactively cancelled and previously downloaded data cannot be recalled.
Company removal does not log the person out of their private/other companies'
workspaces. The current slice has no persistent engineering HTTP endpoints.

## Invitations

32 random bytes, base64url encoded, SHA-256 digest only in PostgreSQL, 48-hour
lifetime, one successful acceptance, explicit POST plus session and CSRF.
The signed-in verified email must match the named recipient. Neither an email
domain nor possession of a stolen invitation token is sufficient alone.

Creation returns a link **once**, with its token in the URL fragment rather
than the path/query. The browser clears the fragment immediately and never
stores the token in local/session storage. Sign in first, then reopen the link
or paste it into the acceptance form. Existing members are not silently
promoted/reinstated on acceptance. Invalid/foreign/expired tokens yield the
same sanitized unavailable response, with no anonymous recipient/company lookup.

Links are copied and shared manually in this slice. **No email is sent.**
Creating a replacement for the same company/email revokes earlier pending
links. At most 100 unexpired pending invitations per company and 10 owned
companies per user are admitted. These are initial application limits, not
billing entitlements or complete public-abuse/storage-retention protection.

## Implementation and HTTP contract

Migration `0005_controlled_onboarding` adds only `web_session.verified_email`
and two fixed-search-path, no-PUBLIC-execute SECURITY DEFINER functions.
No new database role is introduced. Runtime direct membership/invitation
INSERT and column UPDATE privileges are revoked; existing tenant SELECT RLS
and engineering composite foreign keys remain. The repository startup check
rejects unsafe definer ownership/grants or direct membership writes.

The command function has a fixed action allowlist and static, parameterized
SQL only. It authenticates using a session digest, not caller user IDs or tenant
GUCs. Web code offers named operations, never the command name or raw SQL.
OIDC verification remains the trusted application boundary, not a SQL function
capability. Arbitrary SQL execution or a compromised owner/server is outside
the tenant-isolation threat model, as documented in the authentication model.

| Route | Method | Body |
|---|---|---|
| `/api/v2/profile` | POST | `displayName` |
| `/api/v2/companies` | POST | `name` |
| `/api/v2/members` | GET | none |
| `/api/v2/invitations` | GET | none |
| `/api/v2/invitations/create` | POST | `email`, `role` |
| `/api/v2/invitations/revoke` | POST | `invitationId` |
| `/api/v2/invitations/accept` | POST | `token` |
| `/api/v2/members/change` | POST | `userId`, `role`, `status` |
| `/api/v2/workspace/leave` | POST | empty object |

Company-scoped routes use `X-Workspace-Id` as a membership-checked selection;
acceptance derives the company from the invitation. Mutations require exact
configured Origin and the session CSRF token, strict JSON content type, at most
8 KiB and a ten-second body deadline. Unknown body fields are rejected.
Private responses and workspace assets are no-store. The service worker skips
all `/auth/`, `/api/` and `/workspace.*` requests; its cache stamp was advanced
to evict older caches. Workspace UI has a self-only CSP, no third-party assets,
text-only DOM insertion, and clears private UI on logout/page exit.

## Verification performed locally

- 309 tests across 36 files, including 23 dedicated onboarding tests and a new
  real OIDC-client signed-email-claim test. Existing two-company read, modify,
  cross-link and export tests run against all five migrations.
- Tests cover first/repeated signup, unverified/colliding identities, atomic
  rollback, old/expired/revoked sessions, personal privacy, both-direction
  company management denial, expired/revoked/replaced/replayed invitations,
  inviter revocation, privilege escalation, last owner, immediate next-request
  permission changes, strict HTTP/CSRF/body checks and service-worker exclusion.
- Local browser preview used the real management UI, HTTP handler and SQL
  repository with synthetic in-memory data. Profile updates, company creation,
  invitation creation/revocation, sign-out clearing and UI rendering were checked. This harness injects a
  synthetic session only in `scripts/preview-onboarding.mjs`, binds loopback,
  and does not load credentials or persistent data. It is **not** a real IdP
  acceptance test. Start manually with `node scripts/preview-onboarding.mjs`.
- PGlite queues database operations; its simultaneous-call tests do **not**
  prove multi-connection PostgreSQL race behavior. Before migration, qualify
  0005 using two real login pools in a new isolated native database: race last-
  owner removal, invitation accept vs revoke/demotion, duplicate acceptance,
  concurrent first sign-in, rollback and company-isolation checks.

## Gates before activation on bldrz.net

1. Select a dedicated IdP/client; prove signed verified-email claims, correct
   exact issuer/callback, account recovery, and approved owner/admin MFA policy.
2. Complete independent scheduled backups, retention, alerts and key redundancy.
   Requalify 0004+0005 backup/catalog/restore before accepting customer state.
   Existing recovery assertions intentionally still target the live schema.
3. Perform the native concurrency/security qualification above. Do not reuse
   old 0004 probe evidence as certification of 0005.
4. Review proxy callback/query/body log redaction, IdP/public abuse throttling,
   session/invitation/audit retention, privacy/terms and operational recovery.
5. Back up bldrz, render/apply 0004+0005 under its migration owner (portable
   `wellsim_runtime` → `bldrz_runtime`), with no owner credentials in the app.
   Recheck role startup and cache upgrade; test real browser sessions in two
   pilot companies before exposing the onboarding link.
6. Activate only on bldrz, then build the well → case → calculation → immutable
   revision → reopen → export workflow. Load-test 50/100/200 users afterward.

Email delivery, MFA step-up, platform administration, project-scoped external
collaborators, member expiry editing, bulk invitation tools, company verification,
account deletion/identity linking and saved engineering workflow are not included.
