# Security and tenancy

Security is part of the domain model, not a filter added to the UI.

## Identity types

- **Visitor:** no server workspace or persistent server data. Browser autosave
  and Save as / Open remain available.
- **Registered individual:** owns a personal workspace.
- **Organization member:** accesses company resources only through an active
  membership.
- **Platform operator:** performs narrowly scoped operational duties. Platform
  roles do not automatically grant access to customer engineering data.

## Organization roles

The baseline roles are:

| Role | Typical capability |
|---|---|
| Owner | organization lifecycle, administrators and all workspace policy |
| Administrator | members, roles and workspace configuration |
| Engineering manager | projects, assignments, reviews and approvals |
| Engineer | create/edit/run within granted asset scope |
| Reviewer | read and issue review decisions; edit only when separately granted |
| Viewer | read approved/shared resources |
| External collaborator | explicit, time-limited project or asset access |

Permissions are actions on resource types, not hard-coded role-name checks.
Roles are permission bundles that may later be customized without rewriting
the authorization layer.

## Authorization rule

Every protected operation evaluates:

```text
authenticated identity
  + active membership
  + workspace ownership of the resource
  + permission for the requested action
  + optional asset/project scope
  + resource lifecycle state
```

The server performs this check. A hidden button is never an authorization
control.

## Tenant isolation

- Every tenant-owned table carries a non-null workspace identifier.
- Foreign keys prevent cross-workspace relationships unless the relationship
  is an explicit platform construct.
- PostgreSQL row-level security should reinforce application checks for core
  tenant tables.
- The request transaction sets an immutable authorization context. Connection
  pooling must clear it before reuse.
- Background jobs carry the initiating workspace and actor explicitly.
- Cache keys, object-storage paths, search indexes and logs include tenant
  boundaries and are tested for collision/leakage.
- Resource lookup returns the same not-found behavior for unauthorized and
  nonexistent identifiers where disclosure would be harmful.

### Implemented foundation

The first database implementation is isolated to `codex/v2-foundation`.
Migrations `0001` through `0003` are applied to the isolated `bldrz` database;
no authenticated v2 data route is enabled. `db/migrations/0001_platform_foundation.sql` defines identities,
workspaces, memberships, assets, cases, immutable revisions and calculation
evidence, datasets, file metadata, exports and audit events.

`db/migrations/0002_tenant_isolation.sql` adds the least-privilege
`wellsim_runtime` role, revokes public access, enables row-level security and
binds every policy to a transaction-local user/workspace context. Composite
foreign keys carry `workspace_id` through nested resource links and actor
attribution, so a valid identifier from one company cannot be attached to a
record in another company.

The request transaction contract and local test procedure are documented in
`db/README.md`. The adversarial suite in `tests/tenancy.postgres.test.js`
creates two companies and a private personal workspace, then proves
application-role isolation for reads, writes, typed links and export scope. It
also proves missing/malformed context fails closed, membership suspension is
immediate, and transaction context does not survive connection reuse.
`db/migrations/0003_personal_workspace_integrity.sql` makes personal ownership
one-to-one and prevents personal workspaces from being shared through
memberships or invitations.

This is the authorization/storage foundation, not a claim that authentication,
object delivery or production operations are finished. The identity-provider
ADR, authenticated API composition, signed file delivery and automated
off-server recovery remain required before customer data. Native isolation,
pool reuse and a manual encrypted backup/restore drill have passed; see
[bldrz recovery](bldrz-recovery.md) for the remaining storage/key-custody gate.
The bldrz pool/transaction boundary is implemented in
`src/server/database.js`; `deploy/verify-bldrz-pool.sh` exercises native
connection reuse and error recovery in a disposable schema clone.

## Authentication baseline

- Use a maintained standards-based authentication implementation or identity
  provider; do not extend the legacy password JSON store.
- Prefer secure, HTTP-only, same-site session cookies for the web application.
- Rotate sessions after authentication and privilege changes.
- Support revocation, account disablement and organization membership removal.
- Require stronger controls for platform administrators and organization
  owners.
- Never store bearer tokens in browser local storage.

The local provisioned-access implementation uses verified OIDC code flow,
shared opaque PostgreSQL sessions and read-only workspace discovery. It does
not auto-link emails, register accounts or accept invitations. Public
authentication remains disabled; see [verified authentication](identity-authentication.md)
for the tests, exact scope and remaining provider/activation decisions.

The final identity product/provider decision is an ADR because deployment,
cost and customer federation requirements affect it. Authorization and tenant
ownership stay inside WellSim regardless of that choice.

## Invitations

Invitations are organization-specific, single-use, expiring and auditable.
They bind intended role and, where appropriate, intended identity/email.
Accepting an invitation is transactional. A global invite word and a company
slug are not membership evidence.

## Audit requirements

The audit stream records at minimum:

- authentication and membership lifecycle events;
- role/permission and workspace setting changes;
- access to sensitive exports where required;
- case creation, revision, archive and ownership changes;
- calculation execution and engine version;
- review and approval decisions;
- dataset validation/supersession;
- imports, exports and external integration jobs; and
- administrative support access.

Audit events are append-only, timestamped in UTC and include actor, workspace,
action, target, outcome, correlation identifier and relevant change summary.
Secrets and full sensitive payloads do not belong in audit messages.

## Legacy containment

The existing JSON company store is not a multi-tenant foundation. It is off by
default and only responds when `WELLSIM_ENABLE_LEGACY_CASE_STORE=1`. Even in
that compatibility mode, registration requires `WELLSIM_INVITE`.

This flag exists to support controlled inspection or migration of existing
data. It must not be enabled publicly as the v2 identity solution. Before any
temporary enablement:

1. verify the exact existing users and case owners;
2. establish and test an off-box backup;
3. use a strong invite and restrict network exposure;
4. record the enablement window and operator; and
5. disable the store again immediately after migration.

## Required security tests

- A user cannot create membership by choosing an organization name or slug.
- Every CRUD and export operation rejects another tenant's resource ID.
- Nested resources cannot be attached across tenants.
- Role downgrade and membership removal take effect immediately.
- Background jobs cannot read or write a different tenant.
- Object/file URLs cannot be guessed or reused across tenants.
- Archived and approved resources honor their lifecycle permissions.
- Visitor requests cannot persist server-side data.
- Logs and error messages do not reveal secrets or another tenant's data.
