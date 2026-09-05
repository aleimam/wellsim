# WellSim — standalone portable program

**Build 2.2 — 5 September 2026**, from commit `8bba363` of the main project.
Identical physics to https://wellsim.app; the current source is guarded by 324
tests, the 43/43 validation sweep and a 38/38 module smoke check, all passing
there. Change since build 2.1 (5 Sep):

- **Corrects the documentation shipped inside the package.** The copy of this
  file inside `WellSim-2.1.zip` still described the executable as signed by
  `CN=ThePWF WellSim`, with its private key "in the building user's
  `CurrentUser\My` store". Both statements were wrong about the very binary
  they shipped beside: 2.1 is signed by **CN=M. El-Ashry**, and the ThePWF key
  had been deleted from that store. The notes were fixed in the repository
  after 2.1 was packaged, so the zip kept the stale text.
  **The program is byte-for-byte the same engine as 2.0 and 2.1** — no commit
  since `0a9abcf` touches `src/`, `portable/` or `package.json`, so every
  number this exe produces is identical. Only the packaged documentation
  changed, and 2.1's zip hash was deliberately left alone rather than silently
  re-cut under the same version number: a published hash that changes is worse
  than a version number that moves.
  **If you are holding 2.1, the exe is fine.** Read the code-signing section
  below instead of the copy in your zip.

Changes in build 2.1 (5 Sep), kept for reference:

- **Signed as M. El-Ashry.** The publisher shown in the file's *Digital
  Signatures* tab is now `CN=M. El-Ashry`, where builds 1.3 through 2.0 read
  `CN=ThePWF WellSim, O=ThePWF`. **The program itself is unchanged** — 2.1 was
  built from the same code as 2.0 (the only commits between them touch
  documentation), so every number this exe produces is identical. Only the
  signature differs, which is why it carries its own version and its own
  SHA256: a differently signed binary is a different file, and a release
  number that did not move would make the two indistinguishable in a manifest.
- **Read this before you rely on the signature.** The certificate is
  **self-signed** — not issued by a public certificate authority — so Windows
  SmartScreen will still warn on first run, exactly as it did for 2.0. The
  signature proves the file has not been altered since it was signed and
  identifies who signed it; it does **not** buy the reputation that removes the
  warning. Only a purchased, identity-vetted CA certificate does that.

  **What "Status: Valid" actually means here.** Every release note from 1.3 to
  2.0 recorded the signature as *"status Valid"*. That was true only on the
  build workstation, because the signing certificate had been added to that
  machine's trusted-root store. On any other computer the same files report
  *"a certificate chain … terminated in a root certificate which is not
  trusted"*. Nothing was wrong with those releases — the claim was simply
  describing one PC rather than the release. `Get-AuthenticodeSignature` will
  report **Valid** on a machine that trusts `M-ElAshry-CodeSigning.cer` and
  **UnknownError** on one that does not, for the same, unaltered file. To
  check a copy anywhere, compare the SHA256 in `WellSim-2.1.sha256.txt` and
  the certificate thumbprint; those do not depend on the local trust store.

Changes in build 2.0 (5 Sep), kept for reference:

- **Sour gas now rules the PCP out as well as the sucker rod.** Ticking
  **High H2S/CO2** excludes the progressing-cavity pump with its own reason:
  H₂S and CO₂ swell and harden the stator elastomer until it chunks, and in
  sour service that stator is the PCP's shortest-lived part. Like the other
  gates the reason names its own way out — an elastomer qualified for *that*
  gas composition. The module already half-knew this: it printed "check
  elastomers (PCP especially)" as a note nobody had to act on. It is now an
  exclusion that states itself, and the verdict column reads **excluded**
  (clears its envelope, ruled out by this well) rather than **PASS**.
- **The jet pump is deliberately NOT excluded by sour gas**, and the program
  now says why. The published screening tables rate it well on corrosion — no
  moving parts downhole, a carbide nozzle and throat, and inhibitor can ride
  down continuously in the power fluid; sour service is one of the classic
  arguments *for* a jet pump. Its real weakness is free gas at the throat, and
  the GLR band already screens that. What sour gas does raise is a **surface
  facilities** question — sour returns through an open power-fluid loop — so it
  travels as a warning **named against the jet pump** instead of a feasibility
  bar. Notes aimed at one method now carry that method's name; before, they
  floated free of whatever they qualified.
- **The economics now names its denominator: cumulative OIL.** Nothing computed
  changed — the cum was always the trapezoid of the oil rate, gross × (1 −
  W.C/100) — but the labels said only "cum". The column is now **Cum oil, stb**,
  the UDC is **$/bbl oil**, the section title names the basis, and the summary
  line spells out the trapezoid and that one well cumulative is shared by every
  method. On the demo well that distinction is **369,581 stb of oil against
  427,963 stb gross**: costing on gross would understate the ESP's UDC by
  0.18 $/bbl, and by more as the well waters out — which is exactly when the
  lift decision gets made.
- **Three more tests** (324): the PCP gated on a well where it genuinely clears
  its envelope, the jet pump surviving sour gas with its note, and the
  cumulative pinned as oil rather than gross.

Changes in build 1.9 (5 Sep), kept for reference:

- **The lift-selection GLR is now calculated, not typed.** The GLR is gas per
  barrel of TOTAL liquid while the GOR is gas per barrel of OIL, so one follows
  from the other and the water cut — **GLR = GOR × (1 − W.C/100)** — and a typed
  GLR could only ever contradict its own inputs. It now sits as a live grey row
  beside Qgross and follows as you type. This is not a change of method: the
  workbook's own figures are exactly this relationship (400 × 0.98 / 0.80 / 0.50
  = 392 / 320 / 200 across the three snapshots), so deriving it reproduces the
  sheet while removing a way to enter an inconsistent well.
- **The well's own conditions can now rule a method out, and say why.** Three
  checks that were advisory notes are now exclusions: **no gas compression
  nearby** rules out **gas lift** (it has no source of injection gas — removable
  by tying in compression); the well **still flowing naturally** rules out the
  **sucker rod** (a rod pump belongs on a well that can no longer flow unaided);
  and **high H2S/CO2** rules out the **sucker rod** (sour service attacks the rod
  string by sulphide stress cracking, and the stuffing box).
  These are not envelope bands — a method can clear every band and still be
  undeployable on this well — so they are applied on top of the screen and stay
  **distinguishable from it**. The verdict column now reads **PASS**, **out**
  (outside its operating envelope) or **excluded** (clears the envelope, ruled
  out by this well), the reasons print in a block under the matrix, and a method
  gated only after clearing its bands is named again in the warnings. Nothing
  disappears silently, because that gated case is usually the actionable one:
  compression can be installed, where sour service cannot be typed away.
- **Technical acceptance now comes first, and only survivors are costed.** A
  method that fails the screen no longer gets a UDC row at all. It used to
  appear greyed with an "out" flag beside the real candidates — and on the demo
  well the **sucker rod is the cheapest of all five at 3.81 $/bbl**, so a reader
  scanning the UDC column could land on the lowest number and miss the flag.
  The economics now reads only what can actually be run, and the methods left
  out are listed beneath it as *"not costed — technically rejected first"*,
  naming which of the two reasons applied. On the demo, clearing the
  gas-compression box moves the pick from Gas Lift (3.41) to the Jet pump
  (3.79 $/bbl) and shows exactly why.
- **The module has tests for the first time** — twelve, covering the GLR
  identity (and that a typed GLR is ignored), the Vogel rates, the screen, the
  economics and every gate.

Changes in build 1.8 (5 Sep), also kept for reference:

- **The ESP gas separator can now be matched to a well test, instead of
  assumed.** Separator efficiency was an input pinned at 95 % — and because the
  pump's delivered ΔP depends on how much free gas the separator lets through,
  a separator underperforming its rating was being booked silently as *pump
  wear*. There is now a third matching factor beside Match stages and Match
  wear: **Match separator efficiency (actual Pint/Pdis)**. It reads the same
  measured intake/discharge couple, holds the wear input where you set it
  (0 = new pump), and solves the separation that reproduces the measured
  ΔP = Pdis − Pint.
  The rule it enforces is that **one measured ΔP fixes one unknown** — you
  match wear with separation held, or separation with wear held, never both
  from the same test. The honest way to separate them is time: match the
  separator at start-up while the pump is new, then hold that figure and match
  wear over the run life. Each button now says which factor it holds.
  The result is drawn, not just reported: a **sweep of pump ΔP against
  separation from 0 to 100 %**, with the measured ΔP as a dashed line, the
  match starred where they cross, and the **gas-locked band shaded** — the
  separation below which intake gas pushes the pump past the end of its curve
  and it delivers no head at all. On the demo well that cliff sits at 27.6 %,
  which is worth seeing: it is the margin between a pump that lifts and a pump
  that stalls. The matched efficiency is **written back into the separator
  input**, so every later run — solve, forecast, sensitivities — uses it.
  Free gas at the intake is reported before and after separation, an optional
  test Pwf measured at the perforations anchors the PI and turns the back-march
  into a consistency check, and the cases that gas cannot explain are named
  rather than fitted: a ΔP above the 100 % curve is *"check stages, frequency
  or PI, not the separator"*; below the 0 % curve it is wear, or worse. On the
  demo's own gauges at wear 0 the match recovers the workbook's 95 % as
  **95.16 %**.

Changes in build 1.7 (4 Sep), kept for reference:

- **A new Artificial Lift Selection module joins the Oil tab.** Alongside Well
  model, Reserve and Forecast, a fourth choice — *Lift selection* — screens five
  methods (ESP, gas lift, sucker rod, jet pump, PCP) for a well described at three
  life snapshots (initial, +6 months, +1 year). Each snapshot's eight parameters —
  the composite-Vogel gross rate, depth, GLR, wellhead pressure, water cut, GOR,
  deviation and dog-leg — are tested against each method's envelope bands; a method
  is applicable only if it clears every parameter across the whole life, and four
  envelope charts draw the well's design line against every method's box. The
  one-year cumulative oil (the trapezoid of the oil rate at the three snapshots)
  then gives each method a UDC of capex/cum + opex, and the cheapest applicable
  method under the UDC limit is named — reproducing the "Artificial Lift Method
  Selection" workbook. It is a screening advisory: the bands are heuristic, not
  physical limits, and the final choice stays with the analyst. On the demo well
  it returns ESP + Gas Lift + Jet as applicable and Gas Lift as the economical pick
  at 3.41 $/bbl.
- **Its results fit any screen.** The pass/fail matrix, UDC table and four charts
  lay out full-height on a desktop and collapse to a single column on a phone, the
  wide matrix scrolling inside its own card rather than the page — checked at
  1280 px and 375 px.
- **The manual covers it** — Help gains an *Oil — Lift selection* section and a row
  in the built-modules table.

Changes in build 1.6 (4 Sep), kept for reference:

- **An ESP well can now be forecast at all.** Selecting a pump used to make the
  forecast refuse to run, asking you to type a STOIIP N that the Reserve module
  had already solved and was showing on screen two panels away. Both modules
  rebuild the flowing pressure by marching the wellbore, and under ESP that
  march needs a pump ΔP — which, for a catalogue pump, is *solved from the
  curve* rather than typed. The march therefore failed, the reserve chain inside
  the forecast died with it, and N was never derived. The ΔP is now re-solved at
  every history row and every forecast step, which is also the physically right
  answer: a pump's ΔP falls as the well depletes, so one typed value would be
  wrong everywhere except the row it was measured on. Natural flow and gas lift
  are unchanged to the digit, and a typed Manual ΔP still stands.
- **The reserve prod_data table opens on the ESP stream.** All three default
  dates now carry **GOR 384 scf/stb and W.C 5 %**, matching the ESP workbook the
  module is reached from, instead of the 5000 / 50–60 % of the natural-flow case
  their rates and pressures came from.
- **A sensitivity curve that runs off the chart now says so.** The pressure axis
  is pinned to [0, Pri] so families stay comparable between runs, but a
  high-water-cut VLP can need several times that — one demo set reaches 10979
  psi against a 2650 psi axis. Only the fragments crossing the top edge were
  drawn, which read as a corrupted curve rather than a well that cannot lift
  that case. The legend now reads *(5 pts above axis)*, *(all above axis)* and
  so on. Nothing is redrawn or hidden; the chart simply states what the eye
  cannot see.
- **An ESP failure names the thing that is actually wrong.** One message used to
  cover two different failures, and in the worst case every number in it was
  NaN: *"no traverse match found (closest residual NaN psi at NaN stb/d) — check
  PI/Pres, stages or frequency"*, blaming the pump when the well simply had no
  IPR yet. A well that cannot be evaluated and a pump that cannot meet the well
  are now reported separately, each naming the inputs that govern it, and no NaN
  can reach you from either path.
- **All 123 catalogue pumps were swept** with the PI retuned to each pump's own
  BEP: 89 give a clean VLP, 20 wobble where the pump is badly mismatched to the
  well, 14 cannot be solved on that well at all — and, the two that matter, zero
  non-finite points and zero convergence failures anywhere in the catalogue.

Changes in build 1.5 (3 Sep), kept for reference:

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
runs the same 324 tests against this copy.

## Code signing

`WellSim.exe` is Authenticode-signed with the self-signed certificate
**CN=M. El-Ashry** (SHA-256, DigiCert-timestamped, valid to 2031, thumbprint
`78974137A5BE991462A896EBF7FB25F17DC6FDC6`) from build **2.1** onward. The
build script re-signs automatically after every rebuild; the private key lives
in the building user's `CurrentUser\My` store and is backed up
password-protected at `F:\key\M-ElAshry-CodeSigning.pfx`.

> **Builds 1.3 – 2.0 were signed by CN=ThePWF WellSim, O=ThePWF** (thumbprint
> `EB639FB356A4603BE341FFC7D4569EC09CE3E58B`, valid to 2029).
> **That certificate and its private key were deleted from the build machine on
> 5 September 2026, and the private key was never exported.** It is gone
> permanently: no further binary can ever be signed as ThePWF WellSim, and
> 1.3 – 2.0 cannot be re-signed under their original publisher. Do not go
> looking for it.
>
> Those eight releases are unaffected. Their signatures are embedded and
> timestamped, so they keep verifying and keep naming their signer. Only the
> *public* certificate is needed to check them, and it is kept in
> `ThePWF-CodeSigning.cer` — shipped in the 2.0 and 2.1 folders, inside the 2.1
> zip, and in `F:\key`. **Do not delete that file**; it contains no secret and
> it is the half that verification needs.

**Company machines** — to make the signature show as fully trusted, install the
matching `.cer` (`M-ElAshry-CodeSigning.cer` for 2.1+, `ThePWF-CodeSigning.cer`
for 1.3 – 2.0) on each machine: double-click →
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
