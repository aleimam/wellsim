# Database foundation

This directory contains the PostgreSQL foundation for WellSim v2. It is local
development work on `codex/v2-foundation`; no migration in this directory has
been applied to production.

## Migration order

Apply `db/migrations/*.sql` once, in lexical order, with a dedicated migration
owner. Each migration records its version in `app.schema_migration` and runs in
a transaction.

The web/API process must never connect as the migration owner, a superuser, or
a role with `BYPASSRLS`. Application queries run as the non-login
`wellsim_runtime` role so PostgreSQL row-level security is always enforced.

## Trusted request transaction

After authenticating the session and verifying that the selected workspace is
one of the user's active memberships, the server must use one database
transaction for the complete operation:

```sql
BEGIN;
SET LOCAL ROLE wellsim_runtime;
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
real SQL migrations, seeds two companies and executes adversarial reads,
writes, links and exports through `wellsim_runtime`. PGlite is only the
disposable local test harness. A native supported PostgreSQL instance, backup
and restore drill, connection-pool integration test and production migration
review remain deployment gates.
