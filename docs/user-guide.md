# WellSim — User Guide

WellSim replaces a tested Excel toolset (M. El-Ashry) for well performance work.
Everything the macros did is a button; everything the sheets computed is either a
chart, a pink output cell, or a grey *input-or-calculated* cell.

---

## 1. UI conventions (all tabs)

| Cell style | Meaning |
|---|---|
| **Green input** | You type it. |
| **Grey italic (dashed border)** | *Input-or-calculated*: blank means the program fills it (shown grey after a run). Typing your own value reclaims it — the program then uses yours. |
| **Pink read-only** | Pure output (the workbook's pink cells). |

- **Selection modules** — where the workbook had parallel sheets, WellSim shows radio
  selections with **one active section**; the others hide (oil lift type, gas IPR basis,
  gas/oil modules, reserve pressure-source).
- **Side tables** next to each chart hold the plotted numbers with a **Copy** button
  (tab-separated — pastes straight into Excel).
- **Production tables** accept clipboard paste (button, or click a cell and Ctrl+V).
  Column order: `Date, FTHP, rate, CGR|GOR, WGR|WC, Pwf`. A header line is skipped
  automatically. `+10 rows` extends the table (up to 200 rows).
- **Dates** accept: `17-Nov-14`, `17-Nov-2014 13:00:00`, `05/03/2014 06:30`,
  ISO (`2014-11-17`), or a plain day number / Excel serial. Impossible dates
  (day > 31, month > 12) are rejected with the row number — nothing silently rolls over.
  Time-of-day is honoured (sporadic test timestamps work). `dt` is days from the first row.
- **Header bar** (final layout): the **Oil Well | Water Well | Gas Well** tabs,
  then **Save as · Open · Export · Print / PDF · Help**. A server-case link is shown
  only when the deployment reports a supported case store. Help opens the full
  in-app manual (`/help.html` — user guide + every equation and deviation).
- **Print / PDF** (header): prints the results only — charts, tables, summary
  cards and banners on a clean white page (inputs, navigation and buttons hide).
  Use the browser dialog's "Save as PDF" for a shareable report.
- **Save as / Open** (header buttons): the whole case — every input,
  selection and production table across all three tabs — saves to a JSON
  file and restores in one click; program-filled grey cells stay
  program-filled (they refill on the next run).
- **Export** (header): downloads the current case through the shared export
  service. **WellSim case (JSON)** is complete and can be opened again.
  **Case inputs (CSV)** contains metadata, labelled inputs, units, selections,
  calculated-field markers and imported production rows for spreadsheet use;
  it is not a restorable case. Formula-like text is neutralized for spreadsheet
  safety while real negative numbers remain numeric.
- **Server cases:** the legacy JSON company store is disabled by default while
  the secure organization/membership store is built. A company name or slug is
  not proof that somebody belongs to that company. When explicitly enabled for
  controlled migration, registration is invite-only. The portable program uses
  the same panel for its local `cases/` folder and needs no account.
- **Visitor use stays complete:** every calculation, browser autosave, Save as,
  Open, Export and Print/PDF workflow works without an account.
- **Mobile**: below 640 px the layout stacks, inputs grow to finger size, and the main
  action button stays pinned while you scroll.
- **Your inputs survive a refresh.** Everything you type is saved in the
  browser and restored on the next load, so a reload no longer discards work —
  and the first solve runs on your restored case, not the demo. **Reset**
  (header) forgets the saved session and reloads the demo well. The store is
  per-browser and never leaves your machine; Save as / Open remain the way to
  move a case between machines or people.
- **Installable, and it works offline.** WellSim is a PWA: your browser can
  install it to the desktop or home screen, and the UI, charting library and
  manual are cached so it opens without a connection. Calculations are never
  cached — a stale reservoir answer would be worse than none — so the physics
  needs the app running, which it is once installed.
- **Charts size themselves to the space they are in.** Each one is measured
  after it draws and corrected if needed: the canvas to its container (so it
  never laps the table beside it), the title to the canvas (shrunk, then
  wrapped if that would make it unreadable), and the legend clear of the
  x-axis title. They re-fit when the web font finishes loading, when the page
  finishes loading, and whenever you resize or rotate — so a reload settles
  straight into its final layout rather than jumping.
- **Result rows follow the active selection.** Choosing the ESP *Sensitivity*
  view replaces the model-match charts with the sensitivity; leaving it — or
  switching lift type or module — brings them back. Rows that belong to
  another lift are cleared rather than left showing the previous run.

### Sensitivity charts — what every module draws

The VLP/IPR sensitivity chart is the same on all three tabs (oil, water, gas)
and on both lift types. In order, it draws:

1. **The current-Pr IPR**, heavy teal — the curve the solutions are actually
   solved against, so it leads the legend.
2. **The future-pressure family**, one IPR per future reservoir pressure.
3. **The VLP curve for each parameter set** (blank cell = the base value).
4. **Each set's solved node**, as a diamond.

**Pri is deliberately not drawn.** On a depleted well it is history — nothing
is solved at it and no table row refers to it — and a second high curve only
competes with the one the answers belong to. The pressure *axis* still tops
out at Pri so runs stay comparable to each other.

A set that overrides the **water cut** also gets its own thin IPR in the set's
colour. Oil rate = gross × (1 − W.C), so such a set meets a different curve in
rate terms; without it the node would appear to float off the base IPR.
Every node is therefore the visible intersection of two drawn curves.

The three **future pressures** default to 0.75 / 0.5 / 0.25 × the *current* Pr
and follow it as you edit Pr or Pri — a field you have typed over is left
alone. They key off the current Pr rather than Pri so that on a depleted well
the first "future" pressure cannot land *above* the pressure the well is
actually at.

Beneath the chart, **Nodal solution per VLP set (at current Pr)** lists rate,
Pwf, WHP and WHT — the same numbers the diamonds mark. ESP runs add the pump
curve per set, the traverse per set, and the full pump state at each node.

---

## 2. Oil — Well model

**IPR basis (one active).** *Darcy* (default for natural flow): K/H/Re/Rw/skin
drive the main J. *User PI* (default for ESP and Gas lift, matching those
workbooks): type the PI J and the reservoir pressure directly; the matched K is
shown grey (derived, reclaimed if you type), and the Darcy geometry becomes
optional. Switching lift type on an untouched form loads that workbook's demo
case — ESP: PI 2.7 @ 2650 (Oil well model_ESP_V5.01); Gas lift: the solved
Jones J 1.079 @ 5000 (Oil well model_GasLift_V3.1.7). Typed values are never
overwritten by the swap.

**ESP match macros.** *Match stages* solves the stage count at your test rate;
the test Pwf cell is written grey with the IPR value (overwrite it with a
measured Pwf to anchor the match there instead). *Match wear* fits the wear
factor from the actual Pint/Pdis couple; the implied PI and K are reported as
QC only and never applied to your inputs.

Select **Oil Well → Well model**. Choose the lift type (one active):
**Natural flow · Gas lift · ESP**.

Water wells have their own tab — see **§2b Water — Well model** below.

### Inputs and defaults

| Group | Field | Default |
|---|---|---|
| Well & flow | FTHP | 700 psi |
| | Water cut | 50 % |
| | GOR | 5000 scf/stb |
| | Tubing ID | 2.992 in |
| | Roughness | 0.00006 |
| Trajectory | Top perf depth | 2810 mAH |
| | Kick-off depth | 1910 m |
| | Deviation angle | 7° |
| Fluids & PVT | Oil gravity | 46 API |
| | Gas SG | 0.842 |
| | Rsi | 700 scf/stb |
| | Reservoir temp | 201 °F |
| | Oil viscosity (tubing) | 6 cp |
| | Water SG | 1.05 |
| | Pb | blank = calculated |
| Heat transfer | Soil temp 90 °F · U 3 BTU/hr·ft²·°F · Tubing OD 3.5 in · Cp 0.51 BTU/lbm·°F |
| IPR — Darcy | Pri 3550 psi · Pr blank = Pri · K 50 mD · H 42.653 ft · Re 1640.5 ft · Rw 0.5104 ft · Skin 0 |
| Match factors | Head 1 · Friction 1 |
| Gas lift | Injection depth 2490.92 mTVD · Injection rate 0 · sweep to 2 MMscf/d in 10 steps |
| ESP | Pump depth in **mAH** (measured/along-hole — the depth a pump is actually run and reported at; the demo case sets 2985) · Pump ΔP 1325.16 psi (Manual-ΔP mode) · Tubing gas blank = formation gas |

**The table above is the Natural-flow demo — and each lift type is a different
source workbook.** Selecting **Gas lift** or **ESP** while the form still holds
a pristine demo loads that workbook's own live case (and selecting Natural
swaps this table back). A value you typed yourself is never overwritten.

| Lift case | Key values (from its workbook) |
|---|---|
| ESP (Oil well model_ESP_V5.01) | FTHP 160 · WC 5 % · GOR 384 · perf 3240 mAH / KO 1500 / dev 0° · 32 API · γg 0.812 · Rsi 384 · Tres 230 °F · **User PI 2.7 @ Pres 2650** · test 2565 stb/d @ 160 psi · pump ESP B 538-3600 @ 2985 mAH · 145 stages @ 50 Hz · separator 95 % · actual Pint/Pdis 1392/2720 psi |
| Gas lift (Oil well model_GasLift_V3.1.7) | FTHP 300 · WC 25 % · GOR 412 · roughness 0.0006 · perf 3380 mAH / KO 2400 / dev 24.6° · 33 API · γg 0.812 · Rsi 442 · Tres 251 °F · **User PI 1.07897 @ Pres 5000** (the workbook's solved Jones J; matched K lands on its hand-tuned 16.37 mD) · test 1365 stb/d @ 300 psi · injection 2490.92 mTVD |

**Well-head temperature is always calculated** (Ramey chain) — the heat-transfer
inputs are required; there is no input THT.

### Workflow

1. **Solve well** — IPR + VLP curves, operating point (rate, Pwf, calculated WHT),
   AOF, and the well-head PQ curve (WHP with WHT on the secondary axis; pressure
   axis starts at zero).
2. **Calibrate from test** — enter a production test (rate, FTHP, Pwf blank =
   *get Pwf* marches it from the FTHP). The program computes the Jones/test J
   anchored at Pri, then **you judge skin** (a guidance table by drilling/completion
   method is served at `/api/skin-guidance`) and the program back-solves the
   **matched permeability** so the Darcy J equals the test J. Darcy remains the
   dominant J program-wide.
3. **Sensitivities** — the VLP parameter columns follow the fluid and the
   **active lift type** (a blank cell always means "base value", and values
   you typed survive a lift switch):

   | Well | VLP sensitivity parameters |
   |---|---|
   | Oil — natural | FTHP · GOR · W.C · tubing ID |
   | Oil — gas lift | FTHP · GOR · W.C · tubing ID · injection gas rate |
   | Oil — ESP | FTHP · GOR · W.C · tubing ID · frequency (Hz) |
   | Water — natural | FTHP · tubing ID |
   | Water — gas lift | FTHP · injection gas rate · tubing ID |
   | Water — ESP | FTHP · frequency (Hz) · tubing ID |
   | Water — injector | injection THP · injected-water temperature · tubing ID |

   **ESP frequency**: with a pump selected (oil *or* water — both tabs read
   the same four catalogues), each set's coupled pump ΔP is re-solved per
   rate at that frequency, affinity-scaled curve and intake state included;
   on **Manual ΔP** the quoted ΔP is scaled by the affinity law (f/f₀)².
   Above the pump's flow range the head is zero, so the frequency curves
   merge; that is the model being honest, not an error.

   **Injector**: the injector runs its own sensitivity family — available
   BHIP vs rate for each set, against the injectivity line at future
   reservoir pressures. Injection water is incompressible with a fixed
   viscosity here, so the injected-water temperature moves the **bottomhole
   temperature**, not the pressure; those BHT families are plotted on the
   chart's second axis.

   **Pressure axis.** The sensitivity chart tops its pressure axis at
   **Pri** on oil, water and gas wells. The inflow side can never exceed
   the initial reservoir pressure, and the VLP tail that does — the
   high-rate region where the well would need more pressure than the
   reservoir has — otherwise stretched the scale and squashed the
   families. The **injector is the exception** and keeps an auto axis:
   injection deliberately pushes above Pri, so capping it there would clip
   the very curves the chart exists to show.

   **Pump @ solution point.** Wherever an ESP node is solved — the model
   match *and* every sensitivity case — the pump's complete state is
   reported in one identical parameter set: pump, stages, frequency (with
   the curve's reference frequency), wear, head total and per stage, ΔP,
   rate at the pump before and after separation, composite gradient, free
   gas at intake, separator efficiency, thrust with its down/BEP/up
   window, hydraulic power, and whether the ΔP fixed point converged. In
   the sensitivity view each set gets its own column, so the trade-off
   reads straight across. (Hydraulic power is the fluid power the pump
   adds, q·ΔP/58766; shaft power would need the pump's efficiency curve,
   which the workbook database does not carry.)

   **Every set is solved, not just drawn.** Below the sensitivity chart a
   table gives each VLP set its own **nodal solution** against the current
   IPR — rate, Pwf, WHP and calculated WHT — so you read what the change
   actually produces, not only how the curve moved. On an ESP well the
   table also carries the frequency, solved ΔP, head, intake and discharge
   pressures and the thrust verdict per set, and two more charts appear:
   the **pump curve per sensitivity** (each set's curve at its own
   frequency, its node starred, over the shared thrust envelope) and the
   **traverse per sensitivity** (each set's top-down march and IPR
   back-calc with its pump ΔP step at pump depth). Both work the same on
   the oil and water tabs.

   Alongside the VLP sets, both producers and injectors sweep future
   reservoir pressures (defaults 2662.5 / 1775 / 887.5 psi = 0.75·0.5·0.25 × Pr).
   Future IPRs use the workbook's future-J chain (J_2x with μ·Bo at the future
   pressure).
4. **Gas lift** — set injection depth/rate; *Run gas-lift performance curve* sweeps
   injection rates and reports the optimum and the incremental dQ/dInj.
5. **ESP** — the full pump stack. **Pump setting depth is entered as
   measured (along-hole) depth, mAH** — the depth a pump is actually run
   and reported at — and the march converts it to TVD on the well's own
   trajectory (vertical to the kick-off, then the deviation angle), the
   same conversion used for the perforations. Cases saved before this
   change still load: a stored TVD pump depth is honoured as-is.
   **Pump selection is two steps: catalogue, then pump.** The **Catalogue**
   dropdown holds four, 123 pumps between them — *Original catalogue (oil +
   water ESP)*, the 69 WD/WG/WE/FLEX/ESP-B pumps from `ESP_DataBase`, plus
   *Borets 2015* (13), *SLB REDA 2020* (24) and *Novomet* (17). The three
   vendor catalogues were recovered from the curve geometry of the vendor
   PDFs, so every pump in them was cross-checked against evidence the tracer
   never read — Borets against the workbook pumps it shares model names with
   (~3 % on head), SLB and Novomet against each page's own printed Recommended
   Operating Range — and any pump that failed was left out rather than shipped
   unproven. The pump dropdown lists only the chosen catalogue, so a long list
   never hides the pump you want; if it is ever empty it says why instead of
   opening onto nothing. **Manual ΔP** and **Custom pump (add new)…** are not
   catalogue entries and stay in the list whichever catalogue is selected —
   add a custom per-stage curve (up to 11 head/rate points at a reference
   frequency), or fall back to a typed ΔP. Saved cases store the *pump*, never
   the catalogue, and the catalogue is worked out from the pump name on load,
   so a case saved before catalogues existed still restores its pump.
   In the custom table the **thrust-marker rows are coloured** — row 4 blue
   (down-thrust limit), row 6 gold (BEP), row 8 red (up-thrust limit), with a
   legend beneath — because the physics reads those fixed rows of whatever
   curve you type; the same colouring appears on the water tab's table.
   The pump curve scales by stages and the affinity laws (head × (f/f₀)²,
   rate × f/f₀) across 30–60 Hz, with the **down-thrust / BEP / up-thrust
   envelope** drawn on the PumpCurve chart. The **gas separator is on by
   default** (95 %): the intake block evaluates free gas at pump conditions
   (the sheet's all-gas-as-vapor convention without a separator), flags
   "Separator required" above 10 % free gas, and cuts the tubing GLR by the
   separator's free-gas-fraction reduction (BE74).
   **The solve** closes the workbook's iterative loop deterministically:
   ΔP → march → intake state → Qgross@pump → head(curve) → ΔP, then finds
   the rate at which the **bottom-up traverse (Pwf from the IPR at constant
   Pres, marched up) meets the top-down one** at the pump intake — PI is the
   IPR match factor, Pres is user judgment. Results are **shown beside** the
   pump curve (rates at pump pre/post separation, all four pressures, head,
   ΔP, gradient, thrust window), with the **Traverse chart** (both branches +
   measured Pint/Pdis markers) below.
   **Matching workflow**: *Match stages* — the first run solves the stage
   count of the selected pump at wear = 0 (new pump) so the traverses close
   at the test rate, **with a design proof: every stage-dependent pressure
   in the calculated march must stay above the design floor (input, default
   300 psi)**. The minimum sits at the pump intake, so the proof binds
   there — if the traverse match would starve the intake below the floor,
   the design is capped at the stage count where intake = floor, and both
   numbers are reported. The anchor Pwf is **written grey into the test-Pwf
   cell** exactly as the workbook macro writes C22 — overwrite it with a
   measured value to anchor the match there instead. *Match wear (actual
   Pint/Pdis)* — wear = 1 − ΔP(actual)/ΔP(theoretical) is applied to the
   wear input; the **implied PI and matched K are reported as QC only and
   never written to your inputs** (PI stays user judgment, like Pres). On
   the demo's actual gauges the QC recovers the workbook's PI input:
   2.698 vs 2.7.
   **Two ESP views** (radio under the ESP inputs). *Model match* draws the
   final charts — IPR vs the coupled ESP-VLP nodal plot, wellhead PQ & WHT,
   the PumpCurve with the results block beside it, and the Traverse on its own
   row with the measured Pint/Pdis markers. The Traverse also draws in
   **Manual ΔP** mode, where your input ΔP appears as the highlighted pressure
   step at pump depth.

   *Sensitivity* runs future-Pres cases at **0.9 / 0.8 / 0.7 × Pr** — shallower
   than the 0.75/0.5/0.25 the other modules use, because a pump still has to
   lift at modest depletion and 0.25 × Pr kills most ESP wells outright. Each
   case takes the Darcy future-J chain and is then **fully solved** with the
   coupled pump. The chart draws the **current-Pr IPR** (heavy teal — where the
   well sits today), each case's IPR, and the **coupled ESP VLP** — one curve,
   since the pump, tubing and THP do not change with reservoir pressure — so
   every solved node is a visible crossing of that VLP with its own IPR, marked
   by a diamond. The pressure axis tops out at Pri like the other sensitivity
   charts. The table lists the ESP state at each node (Pres, J, rate, Pwf,
   Pint, Pdis, ΔP, head, Qg@pump, gradient, free gas %, WHT, thrust). That is where
   you see the pump working harder and the intake falling as the reservoir
   depletes. ESP sets also run in the main VLP/IPR sensitivity block, but that
   block solves at the CURRENT Pr only.

### Multi-layer IPR (optional, oil & gas well models)

A **Layers** selector (Single layer default | Multi-layer) sits under the well
inputs (oil) / inside the Darcy IPR block (gas). Each layer row takes its own
**K, H, skin, Pr** — Re/Rw (and Pb for oil) are shared from the single-layer
inputs — plus per-layer WC/GOR (oil) or CGR/WGR (gas), blank = base. Each
layer's Darcy J is evaluated with its own μ·B (oil) / μ·z (gas) at the
*layer's* Pr. The layers collapse to **one final J** (training deck 4): oil
via the theoretical average pressure (Pwf at which the commingled rate is
zero) and a solution-point match; gas exactly (J_t = ΣJᵢ,
PrAvg = √(ΣJᵢPrᵢ²/ΣJᵢ)). The **blended fluid ratios drive the VLP marches**,
the summary shows Pr avg / J final / blends, and a **Layers @ operating Pwf**
table reports each layer's contribution — a layer with Pr below the operating
Pwf is flagged as **crossflow**. Needs at least 2 layer rows; the gas C&n
basis has no exact collapse, so the selector only appears for Darcy Pr².

**Each layer is drawn on the IPR/VLP chart beside the total.** Layer curves
are thin and dashed so the composite and the VLP stay the two curves your eye
lands on, and each is labelled with its own Pr. A third curve, **IPR (layers
summed)**, is the TRUE commingled sum. It is there because the solid **IPR**
is the collapsed one-final-J equivalent, which is exact only at the solution
point — seeing the two together tells you how far the equivalent has drifted
at the rate you are actually producing. Without it the layers would appear
not to add up to the curve beside them, which reads as a bug rather than as
the equivalent's known behaviour.

**Crossflow is shown, not hidden.** A layer whose Pr sits below the flowing
pressure takes fluid IN, so its curve crosses into the NEGATIVE half of the
rate axis — it is drawn red and dotted and labelled `· CROSSFLOW`, and its
row in the layer table is tinted with a red rule. The table adds **Pr, J and
% of gross** per layer, and that share is signed: a thieving layer takes a
negative percentage, so the column still sums to 100% and tells you directly
how much of the producing layers’ output is being pushed back downhole. On
the shipped demo, dropping layer 2 to Pr 1800 psi against a ~2700 psi
operating Pwf gives L1 132% and L2 −32%.

**The gas well model does the same**, with `% of gas` in place of `% of gross`
and *taking gas in* on a thief layer — the gas demo with layer 2 at Pr 1500
reads L1 147.1% and L2 −47.1%. One difference is worth knowing: the gas
collapse is **exact** (J_t = ΣJᵢ), so there the summed curve and the solid
equivalent IPR coincide at *every* pressure rather than only at a solution
point, and any visible daylight between them means something is wrong. Oil's
two curves are expected to separate away from the solution point; gas's are
not.

**Fitting the total J to the test (K is the solver):** with Multi-layer
active, *Calibrate from test* also fits the commingled system — the Jones/test
J is computed against the theoretical average pressure, and **every layer
permeability is scaled by one factor λ = J(test)/J(total)** so the total J
lands exactly on the test J (each layer's J is linear in its K and PrAvg is
scale-invariant, so the fit is closed-form). The solved K's are written back
into the layer table; the layer K *ratios* — your geological input — are
preserved. Sensitivities remain single-layer.

---

## 2b. Water — Well model (its own tab)

The **Water Well tab** (beside Oil Well and Gas Well) is the oil-tab structure
without the Reserve and Forecast modules — lift types, get-Pwf calibration and
sensitivities included — running the *same* modified-Griffith march at its
limiting case: API fixed at 10° (SG = 141.5/(131.5+10) = 1.000 exactly), water
cut 100 %, GOR = Rsi = 0, Pb = 0. Rates are **gross water** (bbl/d); the IPR
is built into the tab as the **pure linear Darcy form** (no Vogel curvature —
there is no gas) with the Darcy J on water properties (μ = 0.5 cp, Bw = 1);
future-pressure IPR sensitivities keep J constant (water μ·B do not change
with pressure). No gas/oil-PVT inputs appear (no GOR, API, Rsi, Pb, WC, oil
viscosity — the liquid viscosity collapses to the sheets' hardcoded 0.5 cp
water value). Defaults: FTHP 200 psi (producer) · 2000 bbl/d · Pri 4800 psi.
**Water ESP** runs on the **same four catalogues as the oil tab** (same
two-step catalogue-then-pump selection, same 123 pumps) — pick a
pump from the dropdown and the ΔP is *solved* from its curve (stages ×
affinity × wear) instead of typed, with head and the down-thrust/BEP/
up-thrust window reported at the operating point; *Match stages* solves the
stage count against the same design-floor proof. Water is gas-free, so
there is no free-gas intake block and no separator — the curve works on the
water volume at the intake. **Manual ΔP** remains in the dropdown for a
pump you only know by its ΔP, and **Custom pump (add new)…** takes a
per-stage curve exactly as on the oil tab — same 11-row table, same
coloured thrust-marker rows. The water tab also carries the **IPR basis**
selector: *User PI* types J directly on the linear water IPR (Pb = 0) with
the matched K shown grey and the Darcy geometry optional.

Solving a water ESP well also draws two charts, the same pair the oil tab
shows: the **PumpCurve** — the 30–60 Hz family with the
down-thrust/BEP/up-thrust envelope and your operating point starred, with
an ESP results block beside it — and the **Traverse**, the top-down march
against the IPR back-calculated branch with the pump ΔP step drawn at pump
depth. Both rows appear only while ESP is the active lift.

A water well is head-dominated: it flows naturally only when Pr beats
THP + the static water column (≈ 0.446 psi/ft at SG 1.05); otherwise the
solver reports no-intersection — that is the physics, not an error.

**Well type selector: Producer | Injector.** An injector has **no FLOWING tubing head pressure**: every surface pressure it shows is the **injection THP**, in the marches, on the injectivity side and in the sensitivity columns alike (the inputs read *Injection THP* and *Test injection THP*, the sensitivity column reads *Inj THP psi*, and the wellhead chart is *injection THP required*). The injector reverses the march —
water flows DOWN, so **BHIP = injection THP + head − friction**. Selecting
Injector swaps the THP default from 200 to **2000 psi** (and back to 200 on
Producer; a value you typed yourself is kept). Temperatures
relax top-down from the injection-water temperature (new input,
default 90 °F) toward geothermal, making the **bottomhole injection
temperature (BHT)** the calculated output. The injectivity IPR is
**q = J·(Pwf − Pr)** with the same water Darcy J; the operating point is the
crossing of the available BHIP (falls with rate through friction) and the
required Pr + q/J (rises). Charts: the injectivity nodal plot, and the
**injection THP required vs rate** with BHT on the second axis. Calibration
works from an injection test (BHIP input-or-marched → J injectivity →
matched K). Lift types hide for the injector (no artificial lift on
injection), and the **sensitivities become the injector's own** — injection
THP, injected-water temperature and tubing ID (see §3 above). Its sensitivity defaults are **injection THP 100 / 1000 / 2000 psi** and **future pressures 0.75 / 0.5 / 0.25 × the current Pr**, and running them adds the **Injectivity sensitivities** chart: every THP set is solved against Pri *and* each future Pres — a full nodal grid — then plotted as **injection THP (y) vs the solved injection rate (x)**, one line per reservoir pressure, with the grid tabulated beneath (rate, BHIP, BHT, and a "no injection (deficit …)" note wherever THP + head cannot reach that Pres). The injector shows **four result rows** — the injectivity node, the available-BHIP sensitivities, the injectivity-sensitivities grid and the injection-THP-required curve; the gas-lift, ESP pump-curve and ESP-traverse rows are producer-only and are cleared for it, and switching well type wipes the previous type’s results so nothing stale is mistaken for the injector’s. If THP + head
cannot reach Pr the solver reports the
**THP deficit** — the extra surface pressure (or pump) needed to start
injection. Friction uses laminar Fanning (16/Re) below the transition,
Chen above.

## 3. Oil — Reserve estimate (Module 2)

Select **Oil Well → Reserve estimate**. Well data, marches and the matched IPR come
from the Well model module. Three selections (one active):

### 3.1 Prod data & macro (Pres solver)

The workbook `prod_data` sheet + Solver macro. Table columns:
`Date | FTHP | Oil rate | GOR | WC% | dt (out) | Pwf (input-or-calc) | pr (out) | z (out)`.

Per row: Pwf is marched from that row's FTHP/rate/GOR/WC (or taken as input), then
**reservoir pressure is back-calculated** through the composite-Vogel closed form
iterated with the pressure-corrected Darcy J (the workbook's J_2), and z is explicit
Brill & Beggs. The **Havlena–Odeh material balance** then gives per-row N = F/Eo.

Results: **big-font STOIIP banner = AVERAGE(F/Eo)** (the workbook headline), the
**slope of F vs Eo** beside it as cross-check, the **F–Eo crossplot** with the slope
line, and the **N vs Np** stabilization chart. A wide gap between average and slope
flags unstabilized data.

Defaults: `17-Nov-14 700 psi 2100 stb/d · 1-Dec-14 500 1700 · 17-Dec-14 300 1200`
(GOR 5000, WC 50/55/60). **Keep the analysis window early and short** — this is an
early-production method; with an undersaturated pressure path, Eo is compressibility-only
and years-apart data legitimately blow the estimate up.

### 3.2 Static Pres history (memory gauge)

Direct **measured** static reservoir pressures — `Date | Pres` input rows, no IPR or
VLP involved (the strongest data). Np and Gp are integrated from the (hidden)
prod-data table. Outputs per survey: dt, Np, Gp, per-row N. Same MB, banner and charts.
Defaults: `17-Nov-14 3550 · 1-Dec-14 3200 · 17-Dec-14 2900 psi`.
The survey table takes **Paste from clipboard / Import CSV / +10 rows / Clear** and
grows to the data, exactly like prod_data.

### 3.3 Reservoir limit (constant rate)

The workbook ReservoirLimit sheet: m = −slope(Pwf vs t) over **all** rows,
Ct = Cg·Sg + Co·So + Cw·Sw + Cf, **STOIP = q̄ / (Ct·m)**. Cg is grey
input-or-calculated from two Bg points (first and last solved rows). The prod table
slims to `Date | FTHP | q | dt | Pwf` so it fits beside the Pwf-decline chart.

Defaults: Sg 0.1 · So 0.8 · Sw 0.15 · Co 1e-6 · Cw 1e-6 · Cf 3e-6 (1/psi).

> The three selections give different answers by design — judge each by the quality
> of **its** inputs. Demo data: 14.7 / 91.9 / 1.5 MMstb.

---

## 3b. Oil — Forecast (Module 3: Tarner | Walsh)

Select **Oil Well → Forecast**, then pick the **Method (one active)**.
**N and the start state** (date, Np, Pres) are grey input-or-calculated,
the date defaulting to the **last prod-data date**. Both methods book an
**anchor row at that date** — the state the first step departs from — so the
forecast series begins exactly at the start date and joins the history rather
than opening one time step later. The forecast stream continues the well as last
measured: **Forecast THP**, **Forecast W.C** and **Forecast GOR** are all grey
input-or-calculated and default to the **last prod row** (300 psi / 60 % /
5000 scf/stb on the demo well). Type over any of them to run a different
case.

All three are wellbore conditions and hold for the whole run — the GOR feeds
the lift march every step, so a well producing free gas keeps that gas
helping it flow. This matters: the material balance computes its own
reservoir GOR from saturation, and where the two disagree (the demo measures
5000 scf/stb against an Rsi of 700) letting the MB value drive the lift makes
the column far heavier than the real well&rsquo;s and kills the forecast
prematurely. The **F GOR** series on the chart remains the MB reservoir GOR —
the model&rsquo;s prediction — not the lift input.
chained off the Reserve module's fit and Pres solver; both methods share
the same inputs, and per step both solve the same two residuals
deterministically (Brent/alternation instead of GoalSeek loops): pressure
closes the gas balance (Gp by the GOR trapezoid = Gp from MB) and
saturation closes the MB saturation, with the sheet's Kro(So)/Krg(Sg)
polynomials and the rate coupled to the trial pressure. **PVT (Rs/Bo/Bg/μ)
is evaluated at the trial pressure inside the solve** — the
training-material policy ("all the PVT data must be evaluated at the
assumed reservoir pressure").

- **Tarner (default)** — the classic method (workbook Tarner sheet):
  standard MB, So = (1−Swi)(N−Np)Bo/(N·Boi(1−ct·Δp)),
  GOR = Rs + (Krg/Kro)(μoBo/μgBg), rate qo = J1·(Kro/μo)/Bo·(P−Pwf) with
  the mobility PI J1 = 0.00708Kh/(ln(Re/Rw)−0.75+S).
- **Walsh (generalized MB, Rv)** — Walsh's generalized material balance
  (PETSOC 95-01-07) from the "Walsh and turner variable Pwf" workbook:
  the volatilized oil-gas ratio Rv(P) (the workbook's tuned polynomial)
  enters both the Gp and So equations through (Bg−Rv·Bo) terms; the
  producing GOR carries the Foo correction; the rate uses the **constant
  calibrated PI on total mobility** — qt = J·λt·(P−Pwf),
  qo = qt·λo/(λt·Bo). Workbook quirks preserved: μg = μo (the sheet's
  Gas-Visc column reads the oil-viscosity cell) and Bg in cf/scf.
  Validation: 7 cell-pinned tests reproduce the sheet's first solved row
  to 9+ digits; replaying the sheet's Pwf column tracks its 64-step
  trajectory within ≈1% on pressure (EUR −2.2%).

**Forecast Pwf source (one active):** *Nodal at forecast THP* (VLP-coupled,
default — the Walsh workbook's "variable Pwf") or *Fixed minimum Pwf*.
Defaults: step 30 d · **THP, W.C and GOR from the last prod row**
(300 psi / 60 % / 5000 scf/stb on the demo well) · min Pwf 500 · Swi 0.15 ·
Cw 2.63e-6 · Cf 3.25e-6 / psi · abandonment 50 stb/d · max 60 steps. The chart overlays history + forecast (rate and GOR
left, Pres right) with the table below.

## 4. Gas — Well model

Select **Gas Well → Well model**.

### Inputs and defaults

| Group | Field | Default |
|---|---|---|
| Well & flow | FTHP 1625 psi · Gas rate 14.137 MMscf/d · CGR 57.436 stb/MMscf · WGR 3.846 stb/MMscf · Tubing ID 2.992 in · Base roughness 0.0021 in |
| Trajectory | Top perf 3013 mAH · Kick-off 690 m · Deviation 23.65° |
| Fluids & PVT | Condensate 48.7 API · Gas SG 0.763 · **N₂ 1.2 % · CO₂ 3 % · H₂S 2 ppm** · Tres 232 °F · Cond. viscosity 2 cp · Surface tension 30 dyn/cm |
| Heat transfer | Soil 90 °F · U 3 · OD 3.5 in · Cp 0.51 |
| Reservoir pressure | Pri 3800 psi · Pr blank = Pri |
| Match factors | Head 1 · Friction 1 |

Impurities feed the sour pseudo-critical route (hydrocarbon gravity + Kay mixing +
Wichert–Aziz) everywhere gas properties are used.

### IPR — one active basis

- **Darcy Pr² (default, dominant):** q = J·(Pr²−Pwf²)/1000, with
  K 8.7 mD · H 45.934 ft · Re 2460.75 · Rw 0.2917 · skin 5 — the workbook's own
  Darcy block ('VLP-IPR'!B30:B34); its J_2 equals the C&n fit's C at n = 1.
- **C & n (calculated):** q = C·(Pr²−Pwf²)ⁿ, C and n grey = fitted from the
  multi-rate test.

**Multi-rate test** (defaults: 2440 psi / 5.192 · 2000 / 10.002 · 1625 / 14.137 MMscf/d,
Pwf blank = get Pwf from THP). *Calibrate from test* fits C&n, computes the test J,
and matches the Darcy K at your judged skin — same philosophy as oil.

Solve well produces IPR/VLP, operating point with calculated WHT, AOF, and the
well-head PQ + WHT chart. VLP sensitivities: THP 2440/2000/1200 rows by default.

---

## 5. Gas — Reserve estimate (Module 2)

Four selections (one active). Well data and the matched J come from the Well model.

### 5.1 Prod data & macro (Pres solver)

Table `Date | FTHP | Gas rate | CGR | WGR | dt | Pwf (in-or-calc) | pr | z`.
Per row: Pwf marched (or input), Pr closed-form from the frozen J
(Pr = √(1000·q/J + Pwf²), or the C&n form), z explicit, Gp by trapezoid.
The **p/Z vs Gp** line is fitted (prod points only) → **minimum connected GIIP**
= intercept-to-zero, shown as the big GIP banner.
Defaults: `17-Nov-14 1625 18.56 · 17-Nov-19 1000 17 · 26-Nov-24 500 11` (CGR 57/40/20,
WGR 3.8/2.1/2.7).

### 5.2 Pres from SITHP

Static shut-in surveys `Date | STHP | rate=0 | CGR | WGR`. Reservoir pressure comes
from the **static gas march** (gas-head-only station march, geothermal temperatures,
per-station explicit z, from the well-model data — validated to 1.2 % against the
workbook's 7661.9 psi case). Gp comes from the prod-data cumulative — no IPR/VLP
matching involved. Defaults: 2500 / 2000 / 1300 psi on the same dates.
The survey table takes **Paste from clipboard / Import CSV / +10 rows / Clear** and
grows to the data, exactly like prod_data.

### 5.3 Reservoir limit

Same method as the oil version, gas units: **GIIP = q̄/(Ct·m)** with defaults
Sg 0.85 · So 0 · Sw 0.15 · Co/Cw 1e-6 · Cf 3e-6, Cg grey = calculated from two
Bg points. Slim table + Pwf-decline chart with the slope line.

### 5.4 Pres from memory gauges

Measured static reservoir pressures — the shortest route to a p/Z line: **no march
and no IPR**, because the gauge reading *is* the datum. Table
`Date | Pr psi (gauge) | dt | z | Gp | p/Z` — two inputs, four calculated. z is the
same explicit Brill & Beggs at reservoir temperature the other routes use, Gp is the
prod-data cumulative at the survey date, and the fitted p/Z line gives the same
minimum connected GIIP.
Each entry must be a **stabilized** (built-up or extrapolated) pressure. It no
longer has to be corrected to datum by hand: enter the **Gauge TVD** and
WellSim corrects the reading through the static gas column between the gauge
and the perforations — the same average-T&Z correlation the SITHP route uses —
and reports the correction in the *to datum psi* column. Leave the depth blank
if the reading is already at datum. A gauge above datum reads low, so the
correction is positive and raises the fitted GIIP — a flowing gauge reading is not Pr and will read as a smaller tank.
A survey dated outside the production record is flagged: its Gp is held at the
nearest end, which biases the fit.
Defaults: 3266.3 / 2607.1 / 1671.0 psi on the same three dates — *these are exactly
what selection 2 computes from its own 2500 / 2000 / 1300 psi SITHP defaults*, so the
two routes return the same 120.19 Bscf out of the box and can be cross-checked.
The table takes **Paste from clipboard / Import CSV / +10 rows / Clear** and grows to
the data, exactly like prod_data.

Each selection carries a best-practice/limitation note; demo answers differ
on the demo well (≈150 / 120 / 91 / 120 Bscf). Selections 2 and 4 agree by
construction — the gauge defaults ARE what the SITHP march computes — so their
agreement is a round-trip check, while the spread across 1 / 3 is the tool exposing
input uncertainty.

---

**Condensate properties.** Both gas modules report the condensate's
**specific gravity** and **molecular weight** from the well model's condensate
API: SG = 141.5 / (131.5 + API) — the same value the gas march uses — and
MW = 42.43·SG / (1.008 − SG). On the `P_Z MB (new)` sheet's API of 49.3 these
are 0.78263274336 and 147.346636758 exactly. They appear on the reserve
summary line and the forecast summary line. They feed the gas-equivalent
chain below.

**The material balance runs on total gas, not dry gas.** Following the
`P_Z MB (new)` sheet: **GE = 133.01·SG / MW** (Mscf per STB — the sheet's
constant; 133.00 misses its cell by 0.008%), **condensate in Bscf** = cumulative
MMstb × GE, **Gp total** = Gp + that, and the **p/Z line is fitted on Gp total**.
The condensate came out of the tank as gas, so a fit on dry Gp under-states the
depletion and the GIIP. On the sheet's own two rows the difference is
217.9 → 223.3 Bscf (+2.5%); on other wells it scales with the CGR history.
Every reserve route reports **Cond Bscf** and **Gp total Bscf** beside Gp, the
p/Z chart's abscissa is Gp total, and the GIIP is on that basis on all four
routes. Because the forecast is handed a total-basis GIIP, its p/Z depletion
also runs on Gp total — driving it with dry Gp would deplete too slowly and
overstate EUR. Its summary reports the start state and EUR as gas + condensate
equivalent = total, with recovery on the total basis; its chart's cumulative
traces (*Gp total (history)*, *F Gp total*) and y-axis are on Gp total, so the
cumulative you see is the one the depletion follows; the table keeps dry Gp,
Cond Bscf and Gp total side by side. A well with no condensate API
degrades to the dry-gas balance exactly.

**Condensate on every reserve route.** Each route now reports condensate the
same way it reports Gp. On routes 1 and 3 (prod data, reservoir limit) every
row carries a **condensate rate** = gas rate × that row's CGR (STB/d — the
well's base CGR if the row has none) and a **cumulative** (MMstb) built by the
same trapezoid Gp uses. On routes 2 and 4 (SITHP, memory gauges) a survey has
no rate, so its row carries the cumulative **interpolated at the survey date**
off the prod table, exactly as its Gp is. These appear as table columns on all
four routes and are carried into the forecast's history, and they are the
input to the gas-equivalent balance described above.

## 6. Gas — Forecast (Module 3)

**FTHP and FTHT per step.** The forecast **table** carries the flowing
wellhead pressure and temperature; the **chart** plots FTHP only, running
the measured FTHP of each prod-data row straight into the forecast FTHP as
one wellhead-pressure line (a temperature in °F shares no scale with psi,
so FTHT would need a third axis to say what the table already says). Off
plateau the produced rate IS the nodal intersection at your forecast FTHP,
so FTHP is that input. **On plateau the well is choked**: Pwf comes from
the IPR at the constrained rate, so the real wellhead pressure is HIGHER
than the input and is back-solved (Brent) through the same downward gas
march — those rows are marked with `*`. The solved FTHP reproduces the Pwf
printed beside it to ~1e-7 psi, which a separate upward march could not
guarantee (the march is an explicit Euler integration, so an upward pass
does not invert the downward one exactly). FTHT needs no inversion: the
march temperature is the geothermal shelf with Ramey relaxation — a
function of RATE and depth, independent of pressure.

**Condensate in the forecast.** A **Forecast CGR** input (STB/MMscf) sits
with the other forecast controls. It is grey, input-or-calculated: left blank
it reads the **latest CGR in the prod table** under Reserve estimate — the
last row by date, not the first and not the well model's base CGR — and shows
that value after a run. Type your own to override. Each step then reports a
**condensate rate** = forecast gas rate × CGR (STB/d) and a **condensate
cumulative** (MMstb) that *continues from the history* — the trapezoid of
q × CGR over the prod table, the same integration Gp uses on gas — rather
than restarting at zero. Both are columns in the forecast table, and the
summary line gives the cumulative at the start and at EUR. The CGR is held
constant across the forecast; it does not decline with reservoir pressure.

**Where GIIP comes from.** Left blank, GIIP and pi/Zi chain off the Reserve
module’s **selection 1 (prod data & macro)** p/Z straight-line fit — the same
chain the workbook’s Forecast sheet uses, and it does NOT follow whichever
reserve selection is on screen. On the demo that is 182.26 Bscf from prod
data against ~120 Bscf from SITHP or the memory gauges, so the two views can
legitimately disagree by half. Both the field label and the result line now
say so. Type a GIIP (or pi/Zi) to override the chain; grey means the program
filled it, and typing reclaims the cell.

p/Z tank coupled to the nodal model, chained off the end of history (the workbook's
Production Forecast block):

| Field | Default |
|---|---|
| Start date / Start Gp / Start Pres | **grey = chained from the prod-data solver** (last date, cumulative Gp, minimum solved Pres) |
| Time step | 30 days |
| Forecast FTHP | 300 psi |
| Plateau (constraint) | 12 MMscf/d |
| Abandonment rate | 1 MMscf/d |
| Max steps | 60 |
| GIIP, pᵢ/Zᵢ | grey = from the reserve p/Z fit |

Each step: Pr from the p/Z line at cumulative Gp (first step anchors on the given
start Pres) → Darcy IPR at that Pr → nodal operating point at the forecast FTHP →
**produced rate = min(operating, plateau)** → Gp advances. Terminates on abandonment,
depletion, max steps, or a dead well — the status is reported with EUR and recovery %.

The chart overlays **history + forecast on a calendar-date axis** (rate and Gp left,
Pres right); the results table sits full-width below it.

---

## 7. Troubleshooting

- **"unparseable date row N"** — fix that row; nothing was computed.
  Use `d-MMM-yy`, `dd/mm/yyyy hh:mm:ss`, ISO, or a day number.
- **"no depletion signal"** — the fitted p/Z (or MB Eo) is not declining; you need
  more spread in the data or the well truly is not depleting a closed volume.
- **Huge oil MB N** — the pressure path is undersaturated and the window too long;
  use the early-production window (days–weeks), or trust the static-gauge selection.
- **Gas march needs CGR+WGR > 0** — use a small CGR (0.1 stb/MMscf) for essentially
  dry gas; the Gray liquid terms divide by liquid rate.
- **Reserve/forecast wrong well?** — both always read the *current* Well model
  inputs; calibrate the well model first, then run reserves.
