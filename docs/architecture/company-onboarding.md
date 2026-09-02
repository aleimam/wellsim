# Company and user onboarding — qualified stage 2b, not live

## Status and boundaries

Implemented on `codex/v2-foundation`, 2 September 2026. No deployment, live
migration, provider registration, email delivery or production restart was
performed for this slice. `wellsim.app` is untouched. The last verified live
`bldrz` schema remains 0001–0003; source now includes 0004 and 0005.
Native PostgreSQL qualification subsequently passed on 2 September 2026 in
an isolated disposable database. This is qualification, not pilot activation.

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

## Verification

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
  prove multi-connection PostgreSQL race behavior. The separate native
  qualification below closes that specific gate for the qualified source.

### Native PostgreSQL qualification — 2 September 2026

**Passed:** `NATIVE_ONBOARDING_VERIFICATION_OK (10 groups)` against PostgreSQL
16.15. Qualified source: `d9a51f9f0bbf3e751f3b3ad757c1ca342f88d69c`
(application onboarding implementation remains `e2da7a2`). The source archive
SHA-256 is `3f5d55795807b0a573f98504ab76f769b1858403148b5e122dfcc49541d521ab`.
The root-owned candidate and sanitized log are retained separately at
`/opt/bldrz/staging/onboarding-d9a51f9-DkYXDHCt/native-onboarding.log`.

`deploy/verify-bldrz-onboarding.sh` refuses an existing probe or an unexpected
live migration baseline, holds an exclusive qualification lock, and clones
only schema/permission-reference definitions. It applies 0004+0005 under the
existing migration owner **only to `bldrz_onboarding_probe`**. Application
operations use `bldrz_app` → transaction-local `bldrz_runtime`, through two
independent pools of at most two connections each. No elevated role membership
or cluster-role edits were needed, and no HTTP server was started.

`scripts/verify-postgres-onboarding.mjs` waits until PostgreSQL actually reports
the competing backend blocked by the first transaction. It then explicitly
orders commits, rather than depending on timing alone. Checks passed for:

1. Distinct connections, role separation and onboarding startup privilege checks.
2. Concurrent first sign-in: one identity/private workspace; conflicting email
   cannot link a different identity. Same-identity races repeated three times.
3. Bootstrap rollback, including private workspace/session creation and
   restoration of the prior session when its replacement transaction rolls back.
4. Duplicate invitation acceptance: exactly one membership, repeated three times.
5. Acceptance versus invitation revocation, with each operation committing first.
6. Acceptance versus inviter demotion, with both commit orders. An acceptance
   committed before demotion remains valid; demotion committed first blocks it.
7. Queued management after administrator demotion or session revocation is
   denied. Unrelated company B remains usable while company A is locked.
8. Concurrent owner departures: last active owner retained, repeated three times.
9. Both-direction company reads, changes, direct membership escalation,
   cross-company asset links and export scope are denied by the real runtime.
10. Personal privacy, next-request downgrade/removal enforcement, and sessions
    surviving closure of the other application pool.

The first harness run could not observe `wait_event_type` under the restricted
runtime role. This was a **test observation issue**, not an application failure.
The observer now uses the public blocking-PID relationship without requesting
`pg_read_all_stats`. PostgreSQL documents the relevant
[statistics visibility](https://www.postgresql.org/docs/16/monitoring-stats.html)
and [blocking-PID function](https://www.postgresql.org/docs/16/functions-info.html).
Malformed/wrong-target connection URLs are tested to fail before opening pools,
with no credential echo. The finalized candidate was requalified from a fresh,
checksum-verified archive after these harness corrections.

After qualification:

- `ONBOARDING_PROBE_REMOVED`: all synthetic database contents removed; the
  harness can recreate them. No existing database or customer record was deleted.
- `LIVE_MIGRATION_BASELINE_UNCHANGED`: live bldrz still 0001–0003 and counts
  for users/workspaces/cases/exports still `0/0/0/0`.
- `QUALIFICATION_AND_LIVE_NONINTERFERENCE_OK`: wellsim PID 1887, bldrz PID
  13337 and PostgreSQL PID 9686 remained active and unchanged throughout.
- PostgreSQL still listens only at `127.0.0.1:5432`; live bldrz web revision
  remains `9c35c04`, and public `/auth/login` still returns 404.

This does not certify a real identity-provider browser flow, backups of the
new schema, high availability, penetration-test completeness or 50/100/200-user
capacity. Requalify when onboarding/authorization/migration code changes.

## Gates before activation on bldrz.net

1. Select a dedicated IdP/client; prove signed verified-email claims, correct
   exact issuer/callback, account recovery, and approved owner/admin MFA policy.
2. Complete independent scheduled backups, retention, alerts and key redundancy.
   Requalify 0004+0005 backup/catalog/restore before accepting customer state.
   Existing recovery assertions intentionally still target the live schema.
3. Native concurrency/security qualification is complete for `d9a51f9`; rerun
   it for changed candidate code. Do not substitute older 0004-only evidence.
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
