# Export, reporting and data portability

Exports are a platform service, not UI code owned independently by each
engineering module. A module declares the data types and approved formats it
can produce; the platform applies authorization, naming, provenance, audit,
storage and delivery controls consistently.

## Format policy by data type

| Data type | Canonical/portable form | Human or presentation forms |
|---|---|---|
| Case revision | Versioned WellSim JSON | Excel workbook, PDF report |
| Tabular dataset or time series | CSV or Parquet plus schema/units | Excel workbook |
| Calculation result | Versioned result JSON | PDF, Excel, CSV tables |
| Chart or diagram | Structured chart data | SVG, PNG, PDF |
| Photo or scanned evidence | Original object plus metadata | Optimized image, PDF collection, ZIP package |
| Project/workspace archive | Manifested ZIP package | Not applicable |

The canonical form preserves meaning and supports migration. PDF, image and
spreadsheet files are derived artifacts and never become the only retained
copy of engineering evidence.

## Export capability contract

Each implemented format registers immutable capability metadata:

```json
{
  "id": "case-inputs-csv",
  "version": 1,
  "dataTypes": ["case"],
  "mediaType": "text/csv;charset=utf-8",
  "extension": "csv",
  "roundTrip": false,
  "execution": "browser"
}
```

Future module manifests reference registered exporter identifiers. They do not
load tenant-provided executable code or build arbitrary SQL queries.

Every artifact records or accompanies:

- export-contract, source-schema, module and engine versions;
- workspace, project, case, revision and calculation-run identifiers where
  applicable;
- canonical units, displayed units and reference conditions;
- source dataset/file identifiers and checksums;
- requester, request/completion timestamps and deployment revision;
- warnings, approvals and stale/superseded state; and
- artifact media type, size and checksum.

## Execution model

Small visitor exports run entirely in the browser. This keeps unsaved work off
the server and permits JSON/CSV/image downloads without an account.

Authenticated exports that require database joins, many files, Excel/PDF
rendering or organization scope run as background jobs:

```text
request -> authorize exact source scope -> immutable export snapshot
        -> queued job -> render/package -> checksum/scan
        -> object storage -> short-lived signed download
```

Suggested logical records are `ExportJob`, `ExportItem` and `ExportArtifact`.
Jobs contain workspace ownership, requester, scope, format, template/version,
status, progress, expiry and failure details. Artifacts use the shared file
object model rather than PostgreSQL binary columns.

## Excel workbook contract

`wellsim.case-workbook.v1` is the normalized model for the future
`case-xlsx` capability. It is deliberately separate from the binary renderer:
the browser and portable app can produce the same deterministic model, while
an approved queued worker owns XLSX generation, template versioning and file
inspection.

The model contains only ordered worksheet definitions, columns, typed values
and provenance. Its worksheet roles are:

1. `Summary` — source and workbook schema versions, timestamps, active well
   type, record counts and the non-round-trip warning.
2. `Inputs` — section, stable field identifier, engineering label, value, unit
   and source state.
3. `Selections` — select/radio state with stable field identifiers.
4. One worksheet per production or time-series grid, with safe unique names
   and units embedded in column labels when known.
5. `Manifest` — export/schema versions, deployment revision, source checksum
   and security policy declarations.

All case-provided strings are neutralized before entering a cell, worksheet
names are limited to Excel's 31-character rules, and duplicate names are made
deterministically unique. The default workbook policy is values only:
`formula_policy=none`, `external_links=none` and `macros=none`.

The registry exposes this queued capability as `workbookCapability` and the
dependency-free normalized model as `createWorkbookModel(...)`. It is not
returned by the browser download `formatsFor('case')`; the UI must not offer
Excel until an authenticated job endpoint, approved renderer, artifact scan
and signed download path are deployed.

## Authorization and lifecycle

- Visitors may export only the case currently present in their browser.
- Personal-workspace users may export resources they own or can read.
- Organization members require read/export permission on every included
  project, asset, dataset, case and file.
- Organization-wide portability exports require an administrator permission
  distinct from ordinary case export.
- Authorization is evaluated when the immutable snapshot is created and again
  before a download link is issued.
- Download links are short-lived; job metadata and audit evidence can outlive
  the downloadable artifact according to retention policy.
- Deletion, legal hold, retention and data-subject requests apply to export
  artifacts as well as their source records.

## File and spreadsheet safety

- CSV text that could execute as a spreadsheet formula is neutralized while
  genuine numeric values remain numeric.
- Excel formulas, external links, macros and hidden sheets are prohibited by
  default. Approved templates are versioned and inspected.
- ZIP entry paths are generated by the platform and rejected if absolute or
  traversing. Every package carries a manifest and SHA-256 checksums.
- Uploaded photos/documents retain the original object. Derived copies are
  separate records; EXIF/location retention or stripping is explicit.
- Uploads are type-checked, size-limited and malware-scanned before inclusion.
- User strings are escaped in HTML/PDF templates, filenames and worksheet
  names. Export failures never include credentials or cross-tenant metadata.

## Delivery sequence

1. Current browser case: round-trippable JSON and spreadsheet-ready CSV.
2. Versioned Excel workbook model for case inputs and time series, followed by
   the queued XLSX renderer and signed delivery path. Result tables join the
   model when calculation-run persistence is available.
3. Deterministic PDF reports and SVG/PNG chart export.
4. Object-storage attachments, photo/document collections and ZIP manifests.
5. Queued project and organization portability archives with signed delivery.

The initial implementation is intentionally browser-only and does not create a
new server-side data store. It establishes the registry and security rules that
the PostgreSQL/object-storage platform will reuse.
