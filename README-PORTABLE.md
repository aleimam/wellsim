# WellSim — standalone portable program

**Build 1.5 — 3 September 2026**, from commit `4c53d22` of the main project.
Identical physics to https://wellsim.app; the current source is guarded by 301
tests and the 43/43 validation sweep both passing there. Changes since build
1.4 (2 Sep):

- **Gas condensate is now in the material balance, not just the tables.** A gas
  condensate well produces liquid that was gas in the reservoir, so the p/Z
  balance is written on TOTAL gas. From the condensate API the program derives
  the condensate specific gravity and molecular weight, then the gas equivalent
  `GE = 133.01·SG/MW` (Mscf/STB); the condensate cumulative is converted through
  it and added to Gp. **All four reserve routes** — prod-data solver, SITHP,
  reservoir limit and memory gauges — report condensate rate, condensate
  cumulative, Cond Bscf and **Gp total**, and the p/Z line is fitted on Gp total,
  so the GIIP is on a total-gas basis. A well with no condensate API is
  unaffected: the gas equivalent is zero and the dry-gas balance is what you get.
- **The gas forecast runs on the same basis.** It takes a **forecast CGR**, grey
  by default at the latest CGR from the production data and editable, and reports
  condensate rate and cumulative for every step. Depletion is driven by Gp total
  rather than dry Gp — driving it dry drains the tank too slowly and overstates
  the EUR — and the summary carries EUR condensate (MMstb and Bscf), EUR total
  and recovery on the total basis.
- **Four ESP pump catalogues, 123 pumps, chosen in two steps.** Pick the
  catalogue, then the pump, so a long list never hides the one you want:
  *Original catalogue* (the 69 oil + water ESP pumps as before), *Borets 2015*
  (13), *SLB REDA 2020* (24) and *Novomet* (17). The three vendor catalogues were
  recovered from the geometry of the published curves, and every pump was
  cross-checked against evidence the tracer never read — Borets against the pumps
  it shares model names with, SLB and Novomet against each page’s own printed
  Recommended Operating Range. **Pumps that failed the check were left out rather
  than shipped unproven.** Manual ΔP and Custom pump remain available in every
  catalogue, and a case saved before catalogues existed still restores its pump —
  the catalogue is worked out from the pump name, never stored.
- **The built-in manual was brought up to date** with all of the above: the
  condensate equations, the pump catalogues and their provenance, and the
  per-layer IPR behaviour introduced in 1.4.

Changes in build 1.4 (2 Sep), kept for reference:

- **Multi-layer IPR now shows every layer, not just their sum.** Each layer is
  drawn on the IPR/VLP chart beside the total, dashed and labelled with its own
  Pr, in both the oil and gas well models. A third curve, *IPR (layers summed)*,
  is the true commingled sum — the solid *IPR* is the collapsed one-final-J
  equivalent, so seeing both tells you how far the equivalent has drifted at the
  rate you are producing. For gas the collapse is exact and the two must
  coincide everywhere.
- **A thief zone is now impossible to miss.** A layer whose Pr sits below the
  flowing pressure takes fluid IN; its curve is red and dotted, labelled
  `· CROSSFLOW`, and its row in the layer table is tinted red. That table gained
  **Pr, J and % of gross** (`% of gas` for gas), and the share is SIGNED — a
  thieving layer takes a negative percentage, so the column still sums to 100%
  and states directly how much of the producing layers’ output is going back
  downhole. On the gas demo with layer 2 at Pr 1500: L1 147.1%, L2 −47.1%.
- **Gas forecast reports the flowing wellhead state.** The table carries FTHP
  and FTHT for every step. Off plateau the FTHP is the value you entered; **on
  plateau the well is choked**, so the real wellhead pressure is higher and is
  back-solved through the same downward gas march — those rows are marked `*`.
  The chart runs the measured FTHP of each production row straight into the
  forecast FTHP as one line.
- **The forecast says where its GIIP came from** instead of leaving you to
  guess whether it was solved or typed.
- **Export.** A new *Export* entry writes the current case as an engineering
  workbook (Excel), WellSim case JSON, or inputs CSV. In build 1.3 this was
  absent; the packaging bug that would have broken it in a standalone exe was
  found and fixed before this build shipped.
- **IPR/VLP rate axes start at zero**, so the operating range uses the whole
  plot instead of leaving room for rates no well produces.

Changes in build 1.3 (31 Aug), kept for reference:
- **Your saved cases are reachable again.** Builds 1.0–1.2 showed the website’s
  *Sign in* panel, but the portable registers no accounts — so the panel
  answered “unknown endpoint auth/register” and the `cases/` folder beside the
  exe could never be opened from it. The program now goes straight into its
  local case store. (Local *Save as / Open* always worked and still do.)
- **Water ESP was reading the pump curve at roughly twice the true rate.** On a
  water well the gross water rate was also counted as an oil phase, so head,
  ΔP, thrust and the stage match were all wrong — head read 169 ft where it
  should have been 5608, with a false up-thrust. Fixed.
- **IPR: a User-PI basis, the way the ESP and gas-lift workbooks work.** Type
  the productivity index and the reservoir pressure; the permeability becomes
  the derived value, shown grey. Selecting a lift type on an untouched form now
  loads that workbook’s own demo case (ESP: PI 2.7 @ 2650 · gas lift: 1.079 @
  5000). Darcy remains the basis for natural flow.
- **Gas well defaults now match the gas workbook** (K 8.7 mD, H 45.934 ft,
  Re 2460.75 ft, Rw 0.2917 ft, skin 5); the shipped values were placeholders.
- **Charts never show negative pressure** — every pressure axis starts at zero.
- **Match stages** writes the calculated Pwf into the test cell in grey, and you
  can overwrite it with a measured value to anchor the match there. **Match
  wear** now applies only the wear factor; the implied PI is reported as a QC
  number and is no longer written into your inputs.
- **A custom pump curve marks its thrust rows** — down-thrust, BEP and up-thrust
  are coloured, because the program reads those fixed rows of whatever curve you
  type. The water tab gained the custom-pump entry too.
- **Case panel**: the name box and Save button no longer overflow, the panel
  closes once a case is saved (keeping the name), and the list shows the two
  newest with the rest on scroll.
- **Clearer failure when a pump cannot pass the rate**: the message now names
  the pump, the duty rate and the curve limit instead of blaming PI/Pres.

**One file: `WellSim.exe`.** Copy it anywhere (USB stick included), double-click,
and the default browser opens the full WellSim app. No installation, no Node,
no internet — the physics engine, the UI, and the Plotly charting library are
all embedded in the executable.

- **Cases** save into a `cases/` folder created **beside the exe** — the whole
  thing travels together. The header's case panel lists/saves/loads/deletes
  them (no accounts in the portable build); the local *Save as / Open* file
  dialogs also work as in the website version.
- The shared **Export** panel downloads a restorable JSON case or
  spreadsheet-ready CSV inputs. **Print / PDF** uses the browser print dialog.
- The console window that appears IS the program — close it to stop WellSim.
- Port: starts at 3355 and automatically picks the next free one if busy
  (`PORT` env overrides the start).
- This build comes from the main project (`D:\TheSimplestNode`) by
  `build.ps1`, with three portable-only changes applied at serve time:
  Plotly vendored locally, no service worker, and the account panel replaced
  by the local case store.

## Rebuild after changes

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

(First time: `npm install --save-dev esbuild postject` with Node on PATH.)
The physics is identical to the main project — after `npm install`, `node --test`
runs the same 301 tests against this copy.

## Code signing

`WellSim.exe` is Authenticode-signed with the self-signed certificate
**CN=ThePWF WellSim** (SHA-256, DigiCert-timestamped, valid to 2029; the
build script re-signs automatically after every rebuild — the private key
lives in the building user's `CurrentUser\My` store).

**Company machines** — to make the signature show as fully trusted, install
`ThePWF-CodeSigning.cer` (in this folder) on each machine: double-click →
*Install Certificate* → Local Machine → *Place all certificates in the
following store* → **Trusted Root Certification Authorities** (and optionally
also into **Trusted Publishers** to suppress publisher prompts). This is an
admin trust decision — do it only on machines your company controls.

**Public distribution** — a self-signed cert never earns Microsoft
SmartScreen reputation. For that, buy an **OV or EV code-signing
certificate** (Sectigo/DigiCert/SSL.com, ~$100–500/yr; EV = hardware token
with instant reputation) or use **Azure Trusted Signing**, then sign with:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /sha1 <THUMBPRINT> WellSim.exe
```

(Run `node portable\strip-signature.js WellSim.exe` first if re-signing a
freshly injected build.)
