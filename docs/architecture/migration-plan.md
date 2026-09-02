# WellSim v2 migration plan

The migration is incremental. The existing scientific application remains the
reference until each vertical slice passes its replacement gates.

## Phase 0 — Baseline and containment

Deliverables:

- clean source revision recorded;
- 253/253 tests and 43/43 validation sweep passing;
- legacy web account/case store disabled by default;
- visitor calculation and Save as / Open behavior preserved;
- portable local case store preserved; and
- live deployment and rollback steps identified.

Exit gate: the containment change is deployed and verified on the public site.
No server case data is accepted unless a tested off-box backup and controlled
migration procedure are active.

## Phase 1 — Architecture acceptance

Deliverables:

- accepted bounded contexts and information architecture;
- accepted workspace, asset and case domain model;
- permission matrix and invitation flow;
- module manifest/execution contract;
- identity-provider ADR;
- data storage and retention ADR;
- portable-product decision; and
- first vertical-slice definition.

Recommended first vertical slice: a registered or personal-workspace user
creates a well, creates a Well Performance case, runs the existing natural-flow
engine, saves an immutable revision, reloads it and compares a second run.

## Phase 2 — Platform skeleton and quality gates

Create the web/API composition roots and shared packages without moving all
legacy files at once. Establish:

- Windows and Linux CI;
- existing Node scientific tests and validation sweep;
- schema/migration tests;
- browser journey and accessibility tests;
- deploy-from-revision and rollback metadata;
- structured logging, health checks and error monitoring; and
- development/test environment configuration.

Exit gate: an empty platform shell deploys repeatably while the legacy app
continues to serve validated production calculations.

## Phase 3 — Persistence and identity

Implement PostgreSQL migrations for users, identities, organizations, personal
workspaces, memberships, invitations, assets, cases, revisions, calculation
runs, audit events and file metadata.

Add object storage for large files. Add backup automation and complete a
restore drill. Establish tenant-isolation tests before any customer data is
imported.

Exit gate: two test organizations and a personal workspace cannot cross-read,
cross-write, cross-export or cross-link any resources.

## Phase 4 — Modular shell and first vertical slice

Build workspace navigation, asset selection, module registry, case lifecycle,
units, provenance and stale-result behavior. Wrap the existing natural-flow
engine through the module contract and deliver the first end-to-end slice.

Exit gate: a run is reproducible from its stored revision and engine version;
changing a visible input marks the prior result stale.

## Phase 5 — Existing WellSim migration

Migrate in small groups:

1. oil, water and gas natural-flow well models;
2. gas lift and ESP workflows;
3. sensitivities and calibration;
4. oil and gas reserve methods; and
5. oil and gas forecasts.

For every group, retain the current engine implementation until adapter-level
and journey-level parity is demonstrated. A UI redesign is not authority to
change scientific behavior.

Exit gate: all existing modules pass the scientific suite, golden journey
outputs and report verification in the new shell.

## Phase 6 — Production readiness

- threat modelling and security review;
- tenant and privilege tests;
- rate limiting and request-size limits;
- backup/restore and disaster-recovery drill;
- load profiles for interactive and calculation workloads;
- initial target of 200 concurrent active sessions, refined by measurement;
- horizontal application-instance test;
- database connection-pool and slow-query verification;
- accessibility review; and
- operational dashboards and alerts.

Hundreds of users is a testable service target, not an architectural claim.

## Phase 7 — New native modules

Start with frequent, lower-compute, reviewable workflows that reuse the shared
data model:

- PVT correlation and fluid library;
- volumetrics;
- material balance and aquifer cases;
- DCA and production forecasting;
- production surveillance and actual-versus-potential;
- intervention opportunity register and deferred-production economics; and
- intervention program, approval and post-job workflow.

Each module follows the lifecycle and validation package in
`module-contract.md`.

## Phase 8 — Specialist integrations

Add catalogues, import/export, lineage and controlled execution adapters for
specialist reservoir, production and intervention software. Prioritize open or
documented exchange mechanisms and preserve source-file checksums.

Do not initially reimplement full-field 3D reservoir simulation, transient
flow assurance, dynamic well kill, coiled-tubing fatigue/forces, hydraulic
fracture propagation or autonomous field control.

## Rollout and rollback

- Use route- or tenant-scoped feature flags for each migrated module.
- Keep legacy and v2 reads independent until migration verification completes.
- Never dual-write without idempotency, reconciliation and an owner for failed
  writes.
- Import legacy JSON data into staging first and produce a reconciliation
  report before committing it.
- A failed module rollout returns users to the prior UI/engine without deleting
  v2 evidence.
- Database migrations have tested forward and recovery procedures; rollback is
  not assumed possible after destructive schema changes.
