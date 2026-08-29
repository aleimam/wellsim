# WellSim — standalone portable program

**Build 1.1 — 29 August 2026**, from commit `8428b81` of the main project.
Identical physics to https://wellsim.app at that commit: 201 tests, 43/43
validation sweep. Changes since build 1.0 (27 Aug) include the fourth gas
reserve method (p/Z from memory gauges), solved nodes on the sensitivity
charts, the forecast stream reading the last production row, and the removal
of the current-rate input.

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
- This build is a **fork copy** of the main project (`D:\TheSimplestNode`,
  which remains the source of truth for the website) with three portable
  changes: Plotly vendored locally, the account panel simplified to the local
  case store, and the single-exe launcher in `portable/main.js`.

## Rebuild after changes

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

(First time: `npm install --save-dev esbuild postject` with Node on PATH.)
The physics is identical to the main project — `node --test` runs the same
201-test suite against this copy.

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
