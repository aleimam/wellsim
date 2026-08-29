# WellSim

A zero-dependency Node.js web application for **oil & gas well performance engineering**:
nodal analysis, minimum connected reserves from early production, and production
forecasting. It is a faithful port of a field-proven Excel toolset (author **M. El-Ashry**),
preserving the author's tuned correlations and workflows, with the spreadsheet macros
replaced by deterministic solvers and every ported formula pinned by regression tests
against the original workbook cells.

## Modules

| Module | Oil | Gas |
|---|---|---|
| **1 — Well model** (nodal analysis) | Natural flow ✔ · Gas lift ✔ · **ESP full stack** ✔ (68-pump database, shared with water) · **Water Well tab** ✔ (producer + injector, ESP on the same catalog) | Natural ✔ |
| **2 — Reserve estimate** (minimum connected volume) | ✔ 3 methods: Havlena–Odeh MB on prod data · MB on measured static pressures (memory gauge) · reservoir limit | ✔ 4 methods: p/Z on prod data · p/Z from SITHP statics · reservoir limit · p/Z from measured memory-gauge pressures |
| **3 — Forecast** | ✔ Tarner · Walsh generalized-MB with Rv (saturation-tracking MB + nodal) | ✔ p/Z tank + nodal, history + forecast chart |

Picking this up cold? Start with **[HANDOVER.md](HANDOVER.md)** — what it is,
how to run and deploy it, the operational knowledge that is not in the code,
and the known gaps.

## Run

```bash
node src/server/server.js
```

Open http://localhost:3355. No npm install — the server uses only Node built-ins and
the UI is plain HTML/JS (Plotly from CDN for charts).

## Tests

```bash
node --test
```

207 tests: PVT pins against workbook cells (15-digit), wellbore-march station parity
(gas march bit-exact; oil march within documented drift bands), IPR/nodal/calibration
round trips, ESP stack, reserve and forecast synthetic-tank recoveries.

```bash
node scripts/validation-sweep.mjs
```

43 end-to-end sensitivity cases (5 per module) checked against the origin
workbooks — 43/43 pass.

## Layout

```
src/core/pvt/         constants, oil (Standing-metric family), gas (B&B Z, CKB+Dempsey mu), water
src/core/vlp/         wellpath, common (Chen friction, Ramey T), ashry factor,
                      oil-march (modified Griffith), gas-march (modified Gray),
                      water-injector, esp (pump stack), esp-catalog (68-pump database)
src/core/ipr/         oil-ipr (composite Vogel + Darcy J), gas-ipr (Darcy Pr^2 + C&n),
                      multilayer, inflow, skin-guidance
src/core/nodal/       nodal (operating point), calibrate (get_Pwf), sensitivity, gaslift
src/core/reserve/     gas-reserve (Pres solver, p/Z, SITHP march, gauge p/Z, reservoir limit, forecast)
                      oil-reserve (Pres solver, Havlena-Odeh MB, static MB, reservoir limit)
                      tarner (oil forecast), walsh (generalized-MB forecast)
src/core/solvers/     brent
src/server/           server.js (built-in http), api.js (form -> core mapping),
                      accounts.js (company case database: register/login, case CRUD)
src/ui/               index.html, style.css, app.js, help.html (in-app manual)
tests/                node:test suites
scripts/              validation-sweep.mjs (43-case module-vs-workbook sweep)
docs/                 user-guide.md, equations.md, deploy.md
```

## The website

The header bar carries the three well tabs (**Oil | Water | Gas**) plus
**Save as · Open · Print report · Sign in · Help**:

- **Save as / Open** — the whole case (every input, selection and production
  table across all tabs) to/from a JSON file.
- **Print report** — results-only clean page (charts, tables, summaries);
  "Save as PDF" in the browser dialog makes the shareable report.
- **Sign in** — the company case database: register a company account to save
  cases server-side, shared by the company's users. **The free version stays**:
  every calculation works without an account.
- **Help** — the full in-app manual at `/help.html` (user guide + every
  equation, constant and workbook deviation).

## Documentation

- [docs/user-guide.md](docs/user-guide.md) — how to use every module, UI conventions,
  all input defaults, workflows, troubleshooting.
- [docs/equations.md](docs/equations.md) — every correlation and equation as
  implemented, with the exact tuned constants, plus the documented deviations from
  the source workbooks.
- [docs/deploy.md](docs/deploy.md) — internet deployment (Render + custom domain
  DNS, or a VPS with nginx/certbot); `render.yaml` and `Dockerfile` are in the
  repo root.

A standalone portable build (`WellSim.exe` — no install, cases saved beside the
exe) is maintained as a separate fork and distributed as `WellSim-1.0.zip`.

## Principles (project-wide)

- **Darcy IPR is the default and dominant J** for both fluids. The test-derived J
  (Jones / Pr²) is the calibration route: the user judges skin, the program back-solves
  the matched permeability so J(Darcy) = J(test).
- **Two pressure records**: Pri (immutable calibration anchor) and Pr (working
  pressure); one active J.
- **Explicit physics only** — Brill & Beggs Z everywhere, no goal-seek iteration;
  well-head temperature always *calculated* (Ramey chain), never input.
- **Gas impurities (N₂, CO₂, H₂S) are inputs** wherever gas properties are computed.
- **Input-or-calculated cells**: grey italic values are computed by the program and
  reclaimed the moment you type; pink cells are outputs.
- The three reserve methods legitimately differ — judge each by the quality of its
  own inputs; cross-method agreement is the QC.
