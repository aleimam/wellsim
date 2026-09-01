# WellSim — standalone portable program

**Build 1.3 — 31 August 2026**, from commit `6a12ea9` of the main project.
Identical physics to https://wellsim.app at that commit — 244 tests and the
43/43 validation sweep both passing there. Changes since build 1.2 (30 Aug):

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
The physics is identical to the main project — `node --test` runs the same
244 tests against this copy.

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
