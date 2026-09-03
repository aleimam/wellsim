# WellSim v2 architecture

Status: proposed baseline for implementation and review.

Operational evidence and deployment gates are recorded in
[infrastructure-audit-2026-09-02.md](infrastructure-audit-2026-09-02.md).

WellSim v2 is an extensible petroleum-engineering workspace. It preserves the
validated WellSim calculation engines while replacing the current single-page
shell, JSON account store, and implicit case model with explicit platform
boundaries.

The product is not intended to replace every specialist simulator. Its role is
to combine four capabilities:

1. a trusted engineering data and asset context;
2. versioned, reproducible calculation cases;
3. collaborative engineering workflows and approvals; and
4. native lightweight modules plus integrations to specialist engines.

## Architectural decisions

| Decision | Baseline |
|---|---|
| Application style | Modular monolith with clear internal package boundaries |
| Web runtime | Stateless web/API processes; no tenant state in process memory |
| Transactional store | PostgreSQL |
| Large files | Object storage with PostgreSQL metadata and checksums |
| Identity | Standards-based authentication; authorization remains in WellSim |
| Tenant model | Organizations and personal workspaces through memberships |
| Scientific execution | Versioned engines, immutable input/output snapshots |
| UI composition | Shared application shell plus registered engineering modules |
| Heavy/safety-critical simulation | Integrate and catalogue before considering reimplementation |
| Existing physics | Preserve behind adapters; do not rewrite during platform migration |
| Export/data portability | Registered formats over canonical data; background jobs for large artifacts |

Microservices are not the starting point. The expected scale—tens to hundreds
of concurrent users—does not justify distributed transactions and operational
complexity. Internal boundaries must nevertheless be strong enough that a
domain can be extracted later if measured load or organizational ownership
requires it.

## Bounded contexts

```text
WellSim platform
├── Identity and access
│   ├── users and authentication identities
│   ├── organizations and personal workspaces
│   ├── memberships, roles and invitations
│   └── platform operations roles
├── Asset registry
│   ├── fields/assets
│   ├── reservoirs and zones
│   ├── wells and wellbores
│   ├── trajectories and completions
│   └── installed equipment
├── Engineering data
│   ├── fluid/PVT and rock-fluid data
│   ├── production, injection, pressure and tests
│   ├── time series, datasets and quality states
│   └── units, reference conditions and provenance
├── Engineering work
│   ├── projects/studies
│   ├── cases and immutable revisions
│   ├── calculation runs and results
│   ├── comparisons, reviews and approvals
│   └── reports and exports
├── Module runtime
│   ├── module registry and manifests
│   ├── input/output validation
│   ├── engine execution and versioning
│   └── scientific warnings and validation evidence
├── Documents and integration
│   ├── files and object storage
│   ├── import/export jobs
│   ├── external software adapters
│   └── event and API integrations
└── Governance and operations
    ├── audit trail
    ├── retention and deletion
    ├── observability
    └── background jobs
```

No bounded context may read another context's tables as an undocumented
shortcut. Calls remain in-process initially, but must go through explicit
service interfaces so ownership and validation rules remain enforceable.

## Product information architecture

```text
Workspace switcher
├── Home
│   ├── recent work
│   ├── assigned reviews
│   └── watched wells and alerts
├── Assets
│   ├── fields
│   ├── reservoirs and zones
│   └── wells and wellbores
├── Engineering
│   ├── Well Performance
│   ├── Reservoir Engineering
│   ├── Production Technology
│   ├── Surveillance
│   └── Well Intervention
├── Studies and Cases
│   ├── drafts
│   ├── shared/approved
│   ├── comparisons
│   └── archived
├── Data
│   ├── datasets and imports
│   ├── time series
│   ├── fluid and equipment libraries
│   └── documents
└── Administration
    ├── members and invitations
    ├── roles and permissions
    ├── workspace settings
    └── audit history
```

Engineering modules register themselves into this shell. They do not create
new global navigation, identity systems, case formats, unit systems, or file
stores independently.

## Initial package boundaries

The migration may create these packages incrementally; the existing source is
not moved merely to make the tree look complete.

```text
apps/
├── web/                  application shell and module UIs
└── api/                  HTTP/API composition root
packages/
├── engineering-core/     current validated physics, initially via adapters
├── platform-domain/      assets, workspaces, cases and authorization
├── module-sdk/           manifests, schemas and execution contracts
├── engineering-units/    canonical quantities and conversions
├── ui-components/        accessible shared UI primitives
└── integrations/         external import/export and simulator adapters
```

## Non-negotiable gates

A platform milestone is not complete until all applicable gates pass:

- the existing scientific suite and validation sweep remain green;
- cross-tenant access tests fail closed for every resource operation;
- a calculation records engine version, inputs, units, data references,
  outputs, warnings and actor;
- changed inputs visibly invalidate or mark prior results stale;
- backup restoration is demonstrated, not merely documented;
- Windows and Linux CI both pass;
- primary user journeys have automated browser coverage;
- critical controls are keyboard operable and programmatically labelled;
- a deployment is traceable to a source revision and supports rollback; and
- no safety-critical recommendation is silently automated.

## Related documents

- [Domain model](domain-model.md)
- [Module contract](module-contract.md)
- [Export, reporting and data portability](export-service.md)
- [Security and tenancy](security-tenancy.md)
- [Portals, join requests and help publishing](portals-and-help.md)
- [Migration plan](migration-plan.md)
