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
| **1 — Well model** (nodal analysis) | Natural flow ✔ · Gas lift ✔ · **ESP full stack** ✔ · **Water Well tab** ✔ (producer + injector) | Natural ✔ |
| **2 — Reserve estimate** (minimum connected volume) | ✔ 3 methods: Havlena–Odeh MB on prod data · MB on measured static pressures (memory gauge) · reservoir limit | ✔ 3 methods: p/Z on prod data · p/Z from SITHP statics · reservoir limit |
| **3 — Forecast** | ✔ Tarner (saturation-tracking MB + nodal) | ✔ p/Z tank + nodal, history + forecast chart |

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

165 tests: PVT pins against workbook cells (15-digit), wellbore-march station parity
(gas march bit-exact; oil march within documented drift bands), IPR/nodal/calibration
round trips, reserve and forecast synthetic-tank recoveries.

## Layout

```
src/core/pvt/         constants, oil (Standing-metric family), gas (B&B Z, CKB+Dempsey mu), water
src/core/vlp/         wellpath, common (Chen friction, Ramey T), ashry factor,
                      oil-march (modified Griffith), gas-march (modified Gray)
src/core/ipr/         oil-ipr (composite Vogel + Darcy J), gas-ipr (Darcy Pr^2 + C&n),
                      multilayer, inflow, skin-guidance
src/core/nodal/       nodal (operating point), calibrate (get_Pwf), sensitivity, gaslift
src/core/reserve/     gas-reserve (Pres solver, p/Z, SITHP march, reservoir limit, forecast)
                      oil-reserve (Pres solver, Havlena-Odeh MB, static MB, reservoir limit)
src/core/solvers/     brent
src/server/           server.js (built-in http), api.js (form -> core mapping)
src/ui/               index.html, style.css, app.js
tests/                node:test suites
docs/                 user-guide.md, equations.md
```

## Documentation

- [docs/user-guide.md](docs/user-guide.md) — how to use every module, UI conventions,
  all input defaults, workflows, troubleshooting.
- [docs/equations.md](docs/equations.md) — every correlation and equation as
  implemented, with the exact tuned constants, plus the documented deviations from
  the source workbooks.

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
