# Database foundation

This directory contains the PostgreSQL foundation for WellSim v2 on
`codex/v2-foundation`. Migrations `0001` through `0003` are applied to the
isolated `bldrz` comparison database. The web process verifies its least-
privilege connection at startup, but no authenticated v2 data route is exposed
and the database contains no customer data.

Local migration `0004_verified_sessions.sql` adds provisioned OIDC identity
mapping and shared server-side sessions. It is **not applied to live bldrz**.
Authentication is off by default; provider approval, backup qualification and
controlled activation are documented in
[verified authentication](../docs/architecture/identity-authentication.md).

Local migrations `0006_administrator_mfa.sql` and
`0007_portals_help_and_join_requests.sql` add MFA-gated administration,
opt-in organization discovery, join requests, separate platform
administrators, and versioned help publishing. The portal migration grants no
direct table access to the runtime role; four fixed security-definer functions
are the only application boundary. See
[portals and help publishing](../docs/architecture/portals-and-help.md).

## Migration order

Apply `db/migrations/*.sql` once, in lexical order, with a dedicated migration
owner. Each migration records its version in `app.schema_migration` and runs in
a transaction.

`0003_personal_workspace_integrity.sql` enforces one private personal workspace
per owner. A personal workspace cannot add another member or issue an
invitation; collaboration belongs in an organization workspace.

The web/API process must never connect as the migration owner, a superuser, or
a role with `BYPASSRLS`. Application queries run as the non-login
`wellsim_runtime` role so PostgreSQL row-level security is always enforced.

The role name in the portable source migration is `wellsim_runtime`. PostgreSQL
roles are cluster-global, so the shared Hetzner cluster uses the
environment-specific name `bldrz_runtime` instead. The cluster administrator
creates and hardens that role; the bldrz rendering of migration `0002` omits
its role-management preamble and replaces only that role identifier. Schema
objects remain owned by the non-login `bldrz_migration_owner` role.

## Application connection boundary

`src/server/database.js` owns the pool and does not expose it to handlers.
PostgreSQL is explicitly enabled only with `WELLSIM_DATABASE_ENABLED=1`.
`DATABASE_URL`, `WELLSIM_DB_LOGIN_ROLE` and `WELLSIM_DB_RUNTIME_ROLE` are
required when enabled. This deployment accepts only a credentialed URL at
`127.0.0.1:5432`, with no URL query overrides. bldrz uses `bldrz_app` and
`bldrz_runtime`; it never connects as the migration owner.

The default pool has at most 10 connections, at most 50 admitted transactions
(active plus waiting), a 5-second acquisition timeout and a 15-second statement
timeout. These are safety bounds, not a claim of measured user capacity.
Startup checks reject unsafe role flags, extra role memberships, direct login
access to `app`, runtime DDL/delete privileges, and visible workspaces without
tenant context. SIGTERM/SIGINT drain HTTP and database connections.

Future authenticated handlers must call:

```js
await database.withTenantTransaction(
  { userId: verifiedSession.userId, workspaceId: selectedWorkspace.id },
  (tx) => tx.query('SELECT id, title FROM app.engineering_case WHERE id = $1', [caseId]),
);
```

The helper validates UUIDs and rechecks active workspace membership in the
database before invoking the operation. It does **not** authenticate a user:
never copy a user ID from a request body or unverified token. The callback gets
only a parameterized query handle, not the raw connection or pool. The handle
expires at callback completion, unawaited queries prevent commit, and a failed
rollback destroys the connection. SQL text remains trusted application code;
the helper is not a sandbox for arbitrary customer SQL.

## Trusted request transaction

After authenticating the session and verifying that the selected workspace is
one of the user's active memberships, the server must use one database
transaction for the complete operation:

```sql
BEGIN;
SET LOCAL ROLE bldrz_runtime; -- wellsim_runtime in the isolated PGlite harness
SELECT set_config('app.user_id', $1, true),
       set_config('app.workspace_id', $2, true);
-- Parameterized application queries on this same transaction only.
COMMIT;
```

Both values are trusted server-side UUIDs derived from the authenticated
session and workspace selection. They must not be copied from an unverified
request body or token claim. `SET LOCAL` and the third `set_config` argument
scope role and tenant context to the current transaction, so they disappear
on commit or rollback before a pooled connection can be reused.

Missing, malformed, inactive, expired or cross-workspace context fails closed.
The migration/table owner deliberately remains an administrative plane and may
bypass RLS; it must not be available to HTTP handlers, calculation workers or
export workers.

## Isolation strategy

- Every tenant record has a non-null `workspace_id`.
- Nested resources and actor attribution use composite foreign keys containing
  `workspace_id`, preventing cross-workspace links at the storage layer.
- File object keys are tenant-relative and unique inside a workspace; physical
  object-storage paths must prefix them with the immutable workspace ID.
- RLS policies require an active user, workspace and membership plus the
  permission for the operation.
- The runtime role is non-login, non-superuser and has no `BYPASSRLS` or delete
  privilege.
- Update grants name the mutable business columns explicitly; ownership,
  attribution, object identity, checksums and creation evidence are not editable
  through the application role.
- Revisions, calculation evidence, export scope and audit events are
  append-only.
- Export scope references tenant-bound cases, datasets or file metadata; it
  cannot point at another workspace's resource.
- Personal workspaces are owner-only, cannot be shared, and remain isolated
  from every organization workspace.

Arbitrary UUID-like values inside JSON documents are payload, not relational
links. Module/API schema validation must reject undeclared references before
storage; all real relationships belong in typed, workspace-bound columns.

## Local verification

Install development dependencies once, then run:

```bash
npm run test:tenancy
npm test
node scripts/validation-sweep.mjs
```

The tenancy suite boots a fresh in-memory PGlite PostgreSQL engine, applies the
real SQL migrations, seeds two companies plus a private personal workspace and
executes adversarial reads, writes, links and exports through
`wellsim_runtime`. PGlite is the disposable local test harness. The same
read/write/link/export boundary has also passed a disposable native PostgreSQL
16 clone of the bldrz database through `bldrz_runtime`. A manual encrypted
backup and fresh-cluster restore drill has also passed. Scheduled off-server
transfer, retention and recovery-key redundancy remain deployment gates; see
[bldrz recovery](../docs/architecture/bldrz-recovery.md).

The native pool test is a separate, explicit operational check:

```bash
sudo bash /opt/bldrz/app/deploy/verify-bldrz-pool.sh /opt/bldrz/app
```

It restores schema and non-customer reference definitions into
`bldrz_pool_probe`, seeds two synthetic companies, and exercises the real
application helper with a maximum-one connection pool. It verifies sequential
and interleaved tenant isolation, rollback, SQL errors, timeouts and context
reset. It refuses to overwrite an existing probe database and drops only the
probe it created. Full backup/recovery is exercised separately by
`deploy/verify-bldrz-restore.sh`; neither drill establishes load capacity.
