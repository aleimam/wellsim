# Portals, join requests and help publishing

Status: implemented on `codex/v2-foundation`; activation remains
default-off behind `WELLSIM_PORTAL_ENABLED=1` and requires verified
authentication, controlled onboarding, migration `0007`, and the existing MFA
release gates.

## User-facing structure

| Area | URL | Audience | Authority |
|---|---|---|---|
| Help center | `/help/` | Public | Published content only |
| Personal portal | `/portal/personal.html` | Any signed-in user | Own private workspace and own join requests |
| Employee portal | `/portal/team.html` | Company members | Their active company roles only |
| Company portal | `/portal/company.html` | Company owners/administrators | The selected company only |
| Platform administration | `/admin/` | Provisioned platform administrators | Versioned public help publishing |
| Membership console | `/workspace.html` | Signed-in users; elevated controls by role | Existing invitations, members and company creation |

The help center has permanent pages for getting started, workspaces,
companies, joining a company, security/MFA, cases/data, exports, engineering
guides and troubleshooting. `/help.html` remains as a compatibility redirect.
When the CMS is unavailable, each page retains complete static guidance.

## Company discovery and joining

Organizations remain `invite_only` unless an owner or administrator explicitly
sets `join_policy=request` and supplies a directory summary. The authenticated
directory exposes only opted-in active organizations, and omits companies for
which the user already has a membership or pending request. Email domains are
never used to infer affiliation.

A join request:

1. is created by a verified signed-in user;
2. grants no membership or workspace permission;
3. is visible to that requester and only the target company's active
   owner/administrator;
4. requires recent MFA before company administrators can list its PII or
   approve/decline it; and
5. grants only the `engineer` role on approval. Role elevation remains a
   separate owner-controlled action.

The storage function locks and rechecks the selected organization and active
administrator membership. A Company B administrator cannot list or review a
Company A request even with its UUID. Join-request tables have RLS enabled and
the runtime has no direct read/write grant; all access uses the fixed
`app.portal_command` boundary.

## Help publishing

Platform-administrator status is stored separately from company membership and
has no self-service grant API. The migration owner provisions the first
administrator only after verified sign-in:

```sql
BEGIN;
SET LOCAL ROLE bldrz_migration_owner;
INSERT INTO app.platform_administrator(user_id)
SELECT id FROM app.app_user WHERE lower(email)=lower('approved-admin@example.com');
COMMIT;
```

Verify exactly one row was selected before applying this in an approved
environment. Company owners are not platform administrators by implication,
and platform administrators do not gain company engineering access.

The editor accepts restricted Markdown, never stored HTML. Every save creates
an immutable `help_revision`; publishing only moves the public revision
pointer. Save, publish and unpublish require recent MFA and append a platform
audit event. Public functions return published revisions only. Browser
rendering constructs DOM nodes with `textContent`/`createTextNode`; it never
assigns CMS content to `innerHTML`.

## Activation contract

The flag is fail-closed:

```text
WELLSIM_PORTAL_ENABLED=1
  requires WELLSIM_ONBOARDING_ENABLED=1
  requires WELLSIM_AUTH_ENABLED=1
  requires WELLSIM_DATABASE_ENABLED=1
  requires migration 0007 and portal repository startup checks
```

The checked-in bldrz service keeps all three public identity/onboarding/portal
flags at `0`. Shipping static help and dormant portal code does not activate
customer persistence. Activation requires the Auth0 MFA action to be attached,
the client secret to be installed, current database backup/restore
qualification, migrations `0006` and `0007`, a provisioned platform admin,
and a staged same-origin smoke test.

## Verification evidence

`tests/portal.test.js` applies the real migrations to a disposable PGlite
database and proves opt-in discovery, request non-authorization, requester-only
cancellation, Company A/Company B listing and review isolation, fixed Engineer
approval, MFA gates, separate platform administration, immutable publication,
and public/draft separation. Static-server tests cover every portal and help
entry point plus strict CSP/no-store headers for private areas.

## Native qualification and recovery

`deploy/verify-bldrz-portals.sh SOURCE` upgrades an empty schema/reference
clone from the exact live 0001–0005 baseline using
`deploy/render-bldrz-portal-upgrade.sh`. Both migrations commit atomically.
The runner refuses an existing `bldrz_portal_probe`, uses two restricted
application pools, and drops only the probe it created. It never copies live
identities or company records, and checks the live migration history afterwards.

Nine native groups cover startup privileges, directory opt-in, cross-company
isolation, duplicate approvals, cancellation versus approval, logout during a
queued join request, separate platform authority, concurrent help revisions,
logout during help editing, MFA expiry while waiting, and public/draft separation.
The initial run reproduced a queued join write succeeding after logout.
Migration 0007 was corrected before its first live application: resource locks
now precede renewed session checks, and help writes recheck administrator status
and fresh MFA after page locks. Session locks serialize the write with logout.

`deploy/verify-bldrz-restore.sh SOURCE DUMP qualify-portals` qualifies the
0005–0007 upgrade in a private socket-only cluster. Synthetic pending requests,
platform roles, help revisions and publishing audit events undergo an encrypted
round trip. All app-table fingerprints must match, then company isolation,
identity/MFA and portal/publication behavior are exercised on the restored copy.
Use `restored-schema` (the default) for backups already at schema 0007.

These are database acceptance checks. Real Auth0 email verification, authenticator
enrollment and the same-origin two-company browser pilot are still required.
