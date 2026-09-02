# WellSim v2 domain model

This document defines the concepts future modules share. It is a logical model,
not a commitment to exact table or column names.

## Identity and workspace

### User

A human identity. Authentication credentials are managed by the selected
identity mechanism. The WellSim record contains profile and lifecycle data,
not authorization inferred from an email domain or a typed company name.

### Organization

The ownership and tenant boundary for company work. An organization has a
stable internal identifier; its editable name and URL slug are display and
routing attributes only.

### Personal workspace

An individual user's private engineering workspace. It follows the same
resource-ownership contract as an organization, without pretending to be a
company. An implementation may use a common workspace abstraction internally,
but APIs must preserve the distinction.

### Membership

Connects a user to one organization with an explicit role, status, inviter,
join timestamp and optional expiry. A user may hold different roles in
different organizations. There is no membership-by-slug operation.

### Invitation

A single-use, expiring grant issued for a specific organization, email or
identity, and role. Accepting an invitation creates a membership through a
transaction that records the grant and actor.

## Physical asset model

The platform must not encode `Field -> Reservoir -> Well` as a strict tree.
Fields contain reservoirs and wells, while a wellbore can intersect multiple
reservoirs and zones.

```text
Organization
└── Asset / Field
    ├── Reservoir
    │   └── Zone
    └── Well
        └── Wellbore
            ├── Trajectory version
            ├── Completion version
            └── Installed equipment

Wellbore ── intersects ──> Reservoir / Zone
```

### Field or asset

The operating context that groups related wells, reservoirs and surface
facilities. Aliases and external identifiers are separate records rather than
overwriting the internal identifier.

### Reservoir and zone

Subsurface containers and subdivisions. Their names, contacts, properties and
interpretations may evolve; scientific datasets are versioned rather than
destructively updated.

### Well and wellbore

`Well` is the business grouping or origin. `Wellbore` is a physical drilled
path. Trajectories, logs and completion components attach to a wellbore;
commercial production may be reported at well or completion level depending
on the source. APIs must require the measurement reference level explicitly.

### Trajectory version

An immutable set of survey stations with datum, coordinate reference system,
depth units, source and quality status. One version may be designated current,
but historical calculations retain their original reference.

### Completion version

An effective-dated configuration of tubing, casing, packers, perforations,
flow-control devices and artificial-lift equipment. A physical intervention
creates a new version; it does not rewrite history.

## Engineering data

### Dataset

A governed collection of records with:

- owner workspace and asset context;
- type and schema version;
- source and acquisition timestamp;
- canonical units plus original units;
- quality state: raw, screened, validated, approved, rejected or superseded;
- effective time and recorded time;
- provenance and transformation history; and
- optional external-system reference.

Examples include production history, pressure surveys, well tests, PVT lab
reports, SCAL curves, equipment curves and intervention execution data.

### Time series

A dataset optimized for timestamped observations. Raw telemetry and approved
engineering values are distinct series or quality layers. Raw values are never
silently promoted to approved input.

### Fluid model

A versioned engineering representation derived from one or more physical fluid
samples or correlations. Laboratory facts, fitted model parameters and
generated tables are stored separately so tuning remains auditable.

### File object

Metadata for a file stored outside PostgreSQL: object key, size, media type,
checksum, encryption state, source, owner, retention class and scan status.
Reservoir decks, spreadsheets, logs and reports are referenced through this
record.

### Export job and artifact

An export job is a workspace-owned, auditable request to render a fixed source
snapshot into one registered format. It records requester, exact resource
scope, exporter/template version, lifecycle status, timestamps, progress,
expiry and sanitized failure information. Authorization is checked against
every included resource when the snapshot is created and before delivery.

An export artifact is a file object produced by a completed job. It records the
source manifest, media type, byte size and checksum. Large artifacts are kept
in object storage and delivered through short-lived signed links. Browser-only
visitor exports use the same format/schema contract without creating a server
record.

## Engineering work model

```text
Project / Study
└── Case
    ├── Case revision 1 (immutable)
    │   ├── Calculation run A
    │   └── Calculation run B
    ├── Case revision 2 (immutable)
    ├── Review
    └── Approval
```

### Project or study

A container for an engineering objective involving one or more assets, users
and modules. Examples: annual reserves review, Well A-12 performance diagnosis
or gas-lift optimization campaign.

### Case

The stable identity and human-readable lifecycle of a piece of engineering
work. It has a current draft pointer, owner, collaborators, status, tags and
asset links. It is not itself the mutable input document.

### Case revision

An immutable snapshot containing module identity, input schema version,
canonical input values, display-unit choices, referenced dataset versions and
author. Editing creates another revision. Superseding a revision never deletes
the previous evidence.

### Calculation run

One execution against one case revision. It records:

- module and engine identifiers and versions;
- code/deployment revision;
- start/end timestamps and actor;
- complete canonical input snapshot;
- referenced data and file checksums;
- result schema version and complete outputs;
- warnings, convergence and validity status;
- stochastic seed when applicable;
- runtime metrics and execution environment; and
- review/approval relationship.

Results become stale when the visible draft no longer corresponds to the
revision that produced them. The UI must make that state explicit.

### Review and approval

An append-only decision by an authorized membership against a specific case
revision or calculation run. Approval is invalidated by a new revision unless
the workflow explicitly defines a narrower change policy.

## Shared invariants

1. Every tenant-owned record has exactly one workspace ownership boundary.
2. Human-readable slugs and external well names are never authorization keys.
3. Units are parsed at the boundary and stored canonically with original-unit
   metadata retained.
4. Scientific source data and fitted/derived data remain distinguishable.
5. Approved and historical calculation evidence is immutable.
6. Physical configurations and operational states are effective-dated.
7. Destructive deletion of governed engineering records is exceptional,
   authorized and audited; ordinary removal is archival or supersession.
8. Large binary files are not stored directly in transactional rows.
