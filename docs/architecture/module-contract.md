# Engineering module contract

Every native module must integrate with WellSim through one contract. A module
is more than a page: it owns a versioned input model, engine, output model,
validation evidence and permissions while reusing platform services.

## Manifest

The exact serialization will be decided with the platform skeleton, but every
module manifest must express the following concepts:

```json
{
  "id": "production.well-performance",
  "version": "1.0.0",
  "title": "Well Performance",
  "department": "production-technology",
  "riskClass": "engineering",
  "inputSchema": "well-performance.input.v1",
  "outputSchema": "well-performance.output.v1",
  "engine": {
    "id": "el-ashry-well-model",
    "version": "1.0.0"
  },
  "assetScopes": ["well", "wellbore", "completion"],
  "permissions": [
    "well-performance.read",
    "well-performance.run",
    "well-performance.review"
  ],
  "capabilities": ["case-versioning", "comparison", "report", "export"],
  "exporters": ["case-json", "case-inputs-csv", "case-xlsx", "case-report-pdf"]
}
```

The manifest is declarative. Loading a module must not execute arbitrary
tenant-specific code.

## Required interfaces

### Input schema and validation

- Defines quantity type, canonical unit, allowed display units, valid range,
  conditional requirements and missing-value behavior.
- Rejects NaN, infinity, ambiguous dates and unrecognized unit strings.
- Distinguishes measured, assumed, correlated and calculated values.
- Produces field-level errors plus engineering warnings.
- Supports explicit schema migrations for saved revisions.

### Engine adapter

Conceptually:

```text
validate(input, context) -> validation result
execute(validated input, execution context) -> result
summarize(result) -> stable summary
compare(result A, result B) -> comparison model
```

The engine receives all required state explicitly. It may not read the current
browser form, session, tenant, process-global mutable state or latest database
values behind the caller's back.

The current `src/core` functions will first be wrapped by adapters. Their
formula implementation is not rewritten as part of this boundary change.

### Output schema

- Separates primary decisions, supporting values, warnings and diagnostics.
- Identifies quantity and unit for every number.
- Records convergence/validity status and model applicability.
- Supports a stable machine-readable form independent of chart presentation.
- Allows reports to name the engine version and referenced data.

### Export contribution

- References only platform-registered exporter identifiers and approved,
  versioned templates.
- Declares supported source data types, media type, extension, whether the
  artifact is round-trippable, and whether execution is browser or queued.
- Exports canonical values with units, schema/module/engine versions,
  provenance, warnings and source checksums.
- Uses shared authorization, audit, object storage, signed delivery, retention
  and filename/package safety controls.
- Never treats a PDF, chart image or spreadsheet as the sole canonical result.
- Never ships tenant-authored executable exporter code.

The detailed platform rules and delivery sequence are in
[export-service.md](export-service.md).

### UI contribution

A module may provide routes, forms, results, comparisons and documentation. It
must use the platform's accessible controls, units, case lifecycle, dirty/stale
state, permissions, error presentation and export services.

A module may not create a separate login, company selector, case database,
toast/error framework, unit converter or document store.

## Risk classes

| Class | Meaning | Example |
|---|---|---|
| Informational | Descriptive data and reporting | asset summaries |
| Engineering | Calculations supporting professional judgment | nodal analysis, DCA |
| Financial/regulatory | Results used for booked or contractual values | reserves, allocation |
| Safety critical | Incorrect output can contribute to loss of containment or life | well kill, CT fatigue |

Risk class determines review requirements, validation depth, disclaimers,
audit retention and whether WellSim may execute the engine natively. A
safety-critical integration may be limited to file cataloguing and approved
result capture.

## Scientific validation package

No calculation module is releasable without:

- a documented scientific specification and applicability limits;
- named references that permit implementation and verification;
- unit tests for equations and edge behavior;
- golden/reference cases with expected tolerances;
- conservation, monotonicity or dimensional checks where applicable;
- invalid-input and non-convergence tests;
- versioned deviations from source/reference behavior;
- an independent technical review appropriate to risk class; and
- a migration policy explaining whether old cases rerun or retain the old
  engine.

The existing 253-test suite and 43-case sweep are the initial validation
package for the current WellSim engine. They remain mandatory throughout the
platform migration.

## Module lifecycle

```text
proposed -> researched -> specified -> implemented -> validated
         -> technically reviewed -> released -> deprecated -> retired
```

A retired engine remains available to render historical results. Rerunning an
old case with a newer engine is a new calculation run and must never overwrite
the old result.
