# WellSim — Equations & Correlations Reference

Every formula as **implemented**, with the exact tuned constants. Sources are the
M. El-Ashry workbooks (Oil well model Natural/GasLift/ESP V3.1.7–V5.01, Gas well
model V6.0.0, Reserve Estimate gas V9.0.0 / oil V5.1); deviations from the sheets
are listed at the end. Units are oilfield unless noted (psi, °F, stb/d, MMscf/d,
scf/stb, ft — with the workbooks' metric-intermediate PVT steps preserved).

## 0. Constants & conversions

| Constant | Value |
|---|---|
| scf → m³ | 0.02831684639 |
| bbl → m³ | 0.158987304 |
| Water density | 998.9926968 kg/m³ ≡ 62.36509524 lb/ft³ |
| psi → Pa | 1 / 0.000145037738 |
| π (trajectory cosine) | **22/7** (Excel legacy, preserved) |
| π (areas) | 3.14 |
| Pb calibration constant | 2.1045604254721 |
| Condensate MW form (Cragoe) | 42.43 over (1.008 − SG) |
| Condensate gas-equivalent constant | 133.01 (Mscf/STB basis) |

---

## 1. Oil PVT (Standing-metric family)

With T_C = (T_F−32)·5/9, ρ_o = 141.5/(131.5+API)·998.9926968 kg/m³,
rs_m = Rs·0.02831684639/0.158987304 (m³/m³).

**Bubble point** (workbook-calibrated Standing):

```
Pb [psi] = 125·[ (582·rsi_m/γg)^0.83 · 10^(0.00164·T_C − 1768/ρ_o) − 1.4 ] / 14.5 · 2.1045604254721
```

**Solution GOR** at P < Pb (inverse Standing; Rs = Rsi above Pb):

```
rs_m = (γg/582) · [ (8·10⁻⁶·P_Pa + 1.4) · 10^(1768/ρ_o − 0.00164·T_C) ]^(1/0.83)
```

**Oil FVF** (saturated Standing-metric; undersaturated compression above Pb):

```
Bo_sat = 0.9759 + 12·10⁻⁵ · (177·rs_m·√(γg/ρ_o) + 2.25·T_C + 40)^1.2
Bo(P>Pb) = e^(3·10⁻⁶·(Pb−P)) · Bo_sat(Rsi)
```

**Dead-oil viscosity** (Glaso):

```
μ_od = 3.141·10¹⁰ · T_F^(−3.444) · (log₁₀ API)^a ,  a = 10.313·log₁₀(T_F) − 36.447
```

**Live-oil viscosity** (Beggs–Robinson below Pb, Vasquez–Beggs above):

```
A = 10.715·(Rs+100)^(−0.515)      B = 5.44·(Rs+150)^(−0.338)
μ_o(P≤Pb) = A·μ_od^B
μ_o(P>Pb) = μ_ob·(P/Pb)^m ,  m = 2.6·P^1.187·10^(−3.9·10⁻⁵·P − 5)
```

**Oil density** in tubing: ρ = (ρ_o,sc + rs_m·ρ_g,sc·conv)/Bo (lb/ft³ via 62.36509524/998.9926968).

---

## 2. Gas PVT

**Sweet pseudo-criticals** (oil-family gas; used for oil-well solution gas):

```
Tpc = 169 + 314·γg [°R]        Ppc = 708.75 − 57.7·γg [psia]
```

**Sour route** (gas wells — impurities are inputs everywhere):

```
γ_hc = (γg − 0.9672·y_N2 − 1.5195·y_CO2 − 1.1762·y_H2S)/(1 − Σy)
Tc_hc = 187 + 330·γ_hc − 71.5·γ_hc²      Pc_hc = 706 + 51.7·γ_hc − 11.1·γ_hc²
Tc = (1−Σy)·Tc_hc + 227.3·y_N2 + 547.6·y_CO2 + 672.4·y_H2S     (Kay)
Pc = (1−Σy)·Pc_hc + 493·y_N2 + 1071·y_CO2 + 1306·y_H2S
+ Wichert–Aziz ε-correction for CO2/H2S.
```

**Z factor — Brill & Beggs explicit** (the ONLY Z model; no iteration):

```
A = 1.39·(Tpr−0.92)^0.5 − 0.36·Tpr − 0.101
B = (0.62−0.23·Tpr)·Ppr + (0.066/(Tpr−0.86) − 0.037)·Ppr² + 0.32/10^(9(Tpr−1)) · Ppr⁶
C = 0.132 − 0.32·log₁₀(Tpr)
D = 10^(0.3106 − 0.49·Tpr + 0.1824·Tpr²)
Z = A + (1−A)/e^B + C·Ppr^D
```

**Gas viscosity** — Carr–Kobayashi–Burrows base × Dempsey polynomial:

```
μ_g = μ_base(γg, T)/Tpr · exp( poly16(Ppr, Tpr) )
```

poly16 = Dempsey a₀…a₁₅ exactly as the BHP sheet (a₀ = −2.462, a₁ = 2.97, …,
a₁₁ = 0.00441 — workbook column V). The **oil family anchors Tpr at station 1**;
the gas march uses local Tpr — both quirks preserved.

**Gas density / expansion:**

```
ρ_g = 28.97·γg·P / (Z·10.73·(T+460))  [lb/ft³]
b (march) = 0.0283·Z·(T+460)/(P+14.5)
Bg (reservoir-limit) = 0.00504·5.61·(T+460)·Z/P  [cf/scf]
Bg (oil MB) = 0.0283·Z·(T+460)/(P+14.5)/5.615  [bbl/scf]
```

---

## 3. Well trajectory & temperatures

```
TVD = kickoff + (AH − kickoff)·cos(θ·(22/7)/180)      (below kick-off; π = 22/7)
```

**Ramey flowing-temperature chain** (WHT always calculated; both fluids):

```
K10 = (OD_ft·3.14·U) / ((w/24)·Cp)        w = total mass rate, lb/day
K11 = e^(−K10·L₁)                          L₁ = FIRST station spacing along hole (workbook quirk)
Geothermal shelf: T_shelf(x) = T_soil + (T_res−T_soil)·TVD(x)/TVD_total
Bottom-up: T(i) = T_shelf(i) + (T(i+1) − T_shelf(i))·K11
```

---

## 4. Wellbore marches (25–30 explicit stations, no iteration)

**Friction** (both marches) — Chen explicit Fanning:

```
1/√f = −4·log₁₀[ ε/3.7065 − (5.0452/Re)·log₁₀( ε^1.1098/2.8257 + (7.149/Re)^0.8981 ) ]
dP_fric/dx = (1/144)·f·w² / (7.413·10¹⁰·d_ft⁵·ρ_mix) · matchFriction   [psi/ft]
```

Head acts on **ΔTVD**, friction on **ΔAH** (explicit Euler per station).

### 4.1 Oil — modified Griffith (single march for natural / gas-lift / ESP)

Griffith liquid holdup with the author's 0.38 coefficient:

```
E_L = 1 − 0.38·(1 + v_m/0.8 − √disc)         (disc from the Griffith bubble-flow form)
```

Head gradient multiplied by the **Ashry head factor** (GOR/WC empirical correction):

```
f_WC  = 7.27117418395078·10⁻⁶·WC² − 0.00119359442121592·WC + 1.00062545755112
GOR ≤ 400:   f_GOR = −6.5998710501415·10⁻⁷·GOR² + 3.56896044844869·10⁻⁴·GOR + 1.02495053371617
400–5000:    f_GOR = 1.979148403399·10⁻⁸·GOR² − 1.61983768691971·10⁻⁴·GOR + 1.09560264752243
GOR > 5000:  capped at GOR = 5000
F_head = (f_GOR · f_WC)^0.82
```

Segments: natural 29 stations; gas lift two zones (15 above + 14 below the injection
point, injection gas added above); ESP 26 + pump node + 2 (pump ΔP applied at the
pump; separated tubing gas above; back-march for intake pressure with properties
evaluated at max(P, 100 psi)).

### 4.2 Gas — modified Gray

Gray holdup with condensate + water liquid loading (CGR + WGR must be > 0), an
effective-roughness friction term with **base roughness 0.0021 in** (tuned), local
Tpr for Z/μ. Bit-parity with the workbook: BHP!D51 = 3598.66511095252 at 1e-8, and
three real get_Pwf points (3414.02 / 2913.97 / 2647.82 psi) pinned in tests.

### 4.3 ESP pump curves & catalogues

A pump is 11 head/rate points **per stage** at a reference frequency. The
operating curve applies the affinity laws, the stage count and a wear factor:

```
q(f) = q₀·(f/f₀)                          rate scales linearly
H(f) = H₀·stages·(f/f₀)²·(1 − wear)       head scales with the square
H(q) : linear interpolation between points (the sheet's fraction interp),
       end-segment extrapolation floored at zero
```

Points **3 / 5 / 7** are structural, not decorative — down-thrust limit, BEP,
up-thrust limit. The thrust window scales with f/f₀ like everything else, and
the physics reads those fixed indices of whatever curve is supplied, which is
why the custom-pump table colours exactly those rows.

**Catalogues — 123 pumps in four**, chosen in two steps (catalogue, then pump):

| Catalogue | Pumps | Provenance |
|---|---|---|
| Original (oil + water ESP) | 69 | `ESP_DataBase` workbook — WD/WG/WE/FLEX/ESP-B families |
| Borets 2015 | 13 | traced from vendor curves, ~3 % on head |
| SLB REDA 2020 | 24 | traced from vendor curves, BEP cross-checked |
| Novomet | 17 | traced from vendor curves, BEP cross-checked |

The three vendor catalogues were recovered from the PDF **vector geometry**
rather than transcribed, so each pump had to be checked against evidence the
tracer never read. Borets shares model names with the workbook and was checked
against those pumps directly. SLB and Novomet share none, so each was checked
against its own page's printed Recommended Operating Range: the peak of the
recovered *efficiency* curve must fall inside it, and the rate axis is
calibrated without reading that range, so the check stays independent. Pumps
that failed are not in the catalogues.

That is why Novomet ships 17 of 42 model+design pairs. Eleven of the failures
are unrecoverable in principle: their axis digits were converted to vector
outlines before the PDF was written, leaving 4–6 numeric labels on a page where
a typed page carries 24–34, and calibrating pixels to bpd and feet needs at
least two known numbers per axis. Three guards decide the rest, and each exists
because loosening it silently corrupted a pump: the BEP must fall **strictly
inside** the printed range to be built (the ±10 % cross-check tolerance answers
*did we read the right chart*, which is a different question from where point 5
sits between the thrust limits at 3 and 7); rates that collide under integer
rounding are separated only when **exactly** equal; and the head and efficiency
axes are told apart **by position, not magnitude**, since some pumps read
efficiency 60 against head 50.

**Manual ΔP** and **Custom pump** are not catalogue entries and stay available
in every catalogue. The catalogue a pump belongs to is *derived from its name*,
never stored in the case, so a case saved before catalogues existed still
restores its pump.

---

## 5. IPR

### 5.1 Oil — composite Vogel (single layer, program default)

```
Pr > Pb, Pwf ≥ Pb :  q_gross = J·(Pr − Pwf)
Pr > Pb, Pwf < Pb :  q_gross = J·(Pr − Pb) + (J·Pb/1.8)·(1 − 0.2·Pwf/Pb − 0.8·(Pwf/Pb)²)
Pr ≤ Pb          :  q_gross = (J·Pr/1.8)·(1 − 0.2·Pwf/Pr − 0.8·(Pwf/Pr)²)
q_oil = q_gross·(1 − WC/100)
```

**Test J** (Pri-anchored, 3-branch inverse of the above) and its closed-form
inverse **Pr-from-test** (undersaturated linear; mixed; saturated via the quadratic
root −[(0.2·Pwf + 1.8·q/J)·(−1)] discriminant form — the macro's G-column formula).

**Darcy J (dominant):**

```
J = 0.00708·K·h / [ μ_o·Bo·(ln(Re/Rw) − 0.75 + S) ]     [stb/d/psi]
```

**Calibration** (slide-8 workflow): user judges skin → closed-form matched K such
that J_Darcy = J_test. μ_o·Bo are evaluated at the current Pr.

**User-PI basis** (the ESP workbook route — 'VLP-IPR'!B4 "Iput PI" is a direct
input; its J_2 simply equals J): the user types J and Pres, and K becomes the
DERIVED value — the same closed-form match as calibration, run against the
typed J, so J_Darcy = PI exactly and every Darcy consumer below keeps working.
Geometry (H/Re/Rw/skin) is optional; blank leaves a pure Jones record. The
GasLift workbook has no PI cell — its Jones J (B16 = 1.07896794858 at Pres
5000) is the value the gas-lift demo case types in, and the matched K lands on
the workbook's own hand-tuned B30 = 16.37. Per-lift demo cases load each
workbook's saved inputs when the lift type changes on a pristine form.

**Future J (J_2x, sensitivities & the oil Pres solver):** re-evaluate μ_o (with the
Beggs–Robinson A/B taken at the **current-Pr Rs** — workbook quirk preserved) and Bo
at the future pressure, then the Darcy J above. Pinned: J_21–23 =
5.27146844059 / 5.8313895807703 / 6.78094220552862.

### 5.2 Gas

```
Darcy Pr²:  q [MMscf/d] = J·(Pr² − Pwf²)/1000        J_test = 1000·q/(Pri² − Pwf²)
Darcy from K:  J = 703·10⁻⁶·K·h / [ μ_g·Z·(T+460)·(ln(0.472·Re/Rw) + S) ]
C & n:      q = C·(Pr² − Pwf²)^n                     (C, n by log-log least squares — the sheet's SLOPE/TREND)
Pr from test:  Pr = √(1000·q/J + Pwf²)   or   Pr = √((q/C)^(1/n) + Pwf²)
```

### 5.3 Multi-layer (optional)

Per-layer composite-Vogel/Darcy rates at a common Pwf; total = Σ; crossflow
warnings when a layer takes fluid; equivalent single record: oil = solution-point J,
gas exact: J_t = ΣJ_i, Pr_avg = √(ΣJ_i·Pr_i²/ΣJ_i). Oil Pr_avg solves ΣQ_i = 0 (Brent).

Per-layer curves and their sum come from **one** rate evaluation per grid point,
so they add up by construction rather than by agreement of two code paths. A layer
whose Pr sits below the flowing pressure takes fluid IN and its rate goes negative —
reported and plotted, never clipped. Oil’s summed curve and the collapsed equivalent
coincide only at the solution point; gas’s coincide everywhere, because that collapse
is exact — visible daylight between them on gas means something is wrong.

---

## 6. Nodal analysis

- **Operating point**: Brent root of R(q) = VLP(q) − IPR(q) after a bracketing
  sample sweep; the **highest-rate crossing** is taken (stable branch). Status
  `no-intersection` when the well cannot flow.
- **Well-head PQ curve**: WHP(q) = Pwf_IPR(q) − Pwf_VLP(q) + FTHP, with the
  calculated WHT per rate on the secondary axis; pressure axis displayed from zero.
- **get_Pwf**: any test/production row with blank Pwf is marched from its FTHP at
  its own rate/ratios.

---

## 7. Reserves — gas (Module 2)

**Condensate and the gas-equivalent balance — all four selections.** A gas
condensate well produces liquid that was gas in the reservoir, so the material
balance is written on **total** gas. From the condensate API (`PZ_Ashry.xlsx`,
sheet `P_Z MB (new)` B2:B3):

```
SG_c = 141.5 / (131.5 + API_c)               (the march's own oilSpecificGravity)
MW_c = 42.43·SG_c / (1.008 − SG_c)           (Cragoe/Standing form)
GE   = 133.01·SG_c / MW_c        [Mscf/STB]  (sheet constant; 133.00 lands 0.008 % off its cell)
```

On the sheet's API 49.3 these are 0.78263274336 and 147.346636758 exactly.

```
q_c     = q_gas·CGR                [STB/d]   q_gas in MMscf/d, CGR in STB/MMscf
N_p,c   = trapezoid of q_c·dt / 10⁶ [MMstb]  a row without its own CGR takes the well's base CGR
G_p,c   = N_p,c·GE                 [Bscf]    MMstb × Mscf/STB is Bscf exactly
G_p,tot = G_p + G_p,c              [Bscf]
```

**The p/Z line is fitted on G_p,tot on every route**, so the GIIP is total gas
in place and the chart's abscissa is G_p,tot. Survey routes (SITHP, memory
gauges) read the condensate cumulative off the prod-table timeline by the same
linear interpolation `cumGp.at()` uses, held flat outside the record, so a
survey's Gp and condensate cumulative always come from the same clock. A well
with no condensate API gives GE = 0 and the whole chain degrades to the dry-gas
balance rather than throwing.


**Selection 1 — Pres solver + p/Z:** per row Pwf (input-or-march), then

```
Pr = √(1000·q/J + Pwf²)      Z = Z_BB(Pr, Tres)      Gp by trapezoid of q·dt
p/Z vs Gp_tot straight line (least squares, prod points only):
GIIP [Bscf] = −(p/Z)ᵢ / slope        (minimum connected gas)
```

**Selection 2 — SITHP statics:** static gas march from SITHP down —
gas-head-only station march on the well-model grid, geothermal temperatures,
per-station explicit Z (validated 1.2 % vs the workbook's Cullender–Smith 7661.9 psi
case). Gp and the condensate cumulative from the prod-table timeline; then the same
p/Z-vs-Gp_tot fit on the survey points.

**Selection 3 — reservoir limit (verbatim):**

```
m = −slope(Pwf vs t)  over ALL rows [psi/day]
Bg = 0.00504·5.61·(T+460)·Z/P  at the first and last rows
Cg = (Bg₁ − Bg₂)/Bg₁/(P₂ − P₁)          (input-or-calculated)
Ct = Cg·Sg + Co·So + Cw·Sw + Cf          (defaults 0.85/0/0.15, 1e-6, 1e-6, 3e-6)
GIIP [Bscf] = q̄ / (Ct·m) / 1000
```

**Pr from p/Z target**: Brent solve of P/Z(P) = target.

---

## 8. Reserves — oil (Module 2)

**Selection 1 — Pres solver + Havlena–Odeh:** per row Pwf (input-or-march), then Pr
by the composite-Vogel closed form **fixed-point iterated with J_2** (the future
Darcy J at each iterate; the macro loops 5×, WellSim iterates to 1e-9). Then:

```
Np, Gp by trapezoid; produced-gas rate uses Rsi above Pb, the row GOR below (sheet W col)
Rp = Gp/Np [scf/stb]
F  = Np·( Bo + (Rp − Rs)·Bg )               [MMbbl]   Bg in bbl/scf (Section 2)
Eo = Bo + (Rsi − Rs)·Bg − Boi                          Boi = Bo(Pri)
N_row = F/Eo
Headline  N = AVERAGE(F/Eo)  over rows with Np > 0     (sheet AD1)
Cross-check N = SLOPE(F vs Eo) including the exact (0,0) initial anchor (sheet V1)
```

Solution-gas drive only (no water influx / gas-cap terms) → **minimum connected STOIIP**.
Diagnostics: F–Eo crossplot; N vs Np stabilization.

**Selection 2 — static Pres history (memory gauge):** identical MB evaluated at
**measured** pressures (user input rows Date | Pres); Np/Gp interpolated from the
prod-table cumulative; no IPR/VLP anywhere in the chain.

**Selection 3 — reservoir limit:** same chain as gas with oil units and defaults
Sg 0.1 / So 0.8 / Sw 0.15:

```
STOIP [MMstb] = q̄ / (Ct·m) / 10⁶
```

---

## 9. Forecast — gas (Module 3)

Chained off the end of history (all grey input-or-calculated): start date = last
prod date, start Gp = cumulative, start Pres = minimum solved Pres, start
**condensate cumulative** = the history's, and the **forecast CGR**, which
defaults to the CGR of the *latest* prod row and can be overridden.

Per step (Δt default 30 d):

```
G_p,tot = G_p + N_p,c·GE
(p/Z)_target = (p/Z)ᵢ·(1 − G_p,tot/GIIP)         ← driven by TOTAL gas
Pr: first step = start Pres; after = Brent-invert P/Z(P) = target
IPR at Pr (Darcy) → nodal operating point at forecast FTHP
q = min(q_op, plateau)          Pwf reported at the produced rate
q_c = q·CGR                                       [STB/d]
G_p += q·Δt/1000                N_p,c += q_c·Δt/10⁶
```

Stops on abandonment rate, depletion, dead well, or max steps. Reports EUR (dry
Gp), EUR condensate as MMstb **and** Bscf, **EUR total**, and **recovery % on
the total basis** — depleting the tank with dry Gp alone would drain it too
slowly and overstate the EUR, which is why the driver above is G_p,tot and not
G_p. Chart: history + forecast, calendar-date axis, rate and G_p,tot left, Pres
right.

---

## 10. Forecast — oil (Module 3: Tarner | Walsh)

Two saturation-tracking methods over the same skeleton. Each step the workbook
macro GoalSeeks a **pair** of residuals (the macro loops the pair 5×); WellSim
alternates the same two updates deterministically to convergence:

```
AE:  Gp by the trapezoid of the producing GOR over Np  =  Gp from the MB   → solve P
AF:  the assumed oil saturation                        =  So from the MB   → solve So
```

So is updated by direct substitution, P by Brent on the AE residual; at most 25
outer passes, converged at |ΔP| < 1e−6 psi and |ΔSo| < 1e−10. Pwf is frozen for
the step; the rate stays coupled to the trial pressure, as the sheet's K/M
columns do under GoalSeek.

**Shared by both methods.** Rel-perm — the sheet's hardcoded 6th-order
polynomials (Tarner!F16 / G16), used verbatim by Walsh too:

```
Kro(So) = −8.38190317154e−9·So⁶ + 1.771375536919e−8·So⁵ − 2.24276445806e−8·So⁴
        + 1.415932551026e−8·So³ + 1.24444443593566·So² − 0.323555551551901·So
        + 0.021031110321869
Krg(Sg) = −7.45058059692e−9·Sg⁶ + 2.23517417908e−9·Sg⁵ − 2.7939677238e−10·Sg⁴
        − 1.860782504082e−8·Sg³ + 2.040816336171·Sg² − 0.204081636387841·Sg
        + 0.00510204149620779

Sg = max(0, 1 − Swi − So);   Kro floored at 1e−9, Krg at 0
So clamped to [0.05, 1 − Swi]
```

Rock + connate-water term (Tarner!R col) — a compressibility × Δp **product**,
dimensionless, not a compressibility:

```
ct = (Cw·Swi + Cf)/(1 − Swi) · (Pri − P)
defaults: Swi 0.15, Cw 2.63e−6 /psi, Cf 3.25e−6 /psi
```

Cumulative gas by trapezoid, and the step bookkeeping:

```
Np += qo·Δt/1e6                                  [MMstb, Δt default 30 d]
Gp += (GOR_prev + GOR_new)/2 · (Np_new − Np_prev) [MMscf]
```

Flowing pressure — two sources:

```
'vlp'  : nodal operating point of the inflow line against the REAL oil march at
         the forecast FTHP (sampled, bracketed, Brent; highest-rate crossing),
         floored at minPwf (default 500 psi). The author's commented-out intent.
'fixed': constant minPwf — the sheet's active behaviour.
```

The march is run at the forecast stream GOR when one is given (an input, like
W.C and THP); otherwise at the MB GOR carried from the previous step.

An **anchor row** is booked at the start date itself (Δt = 0). It changes no
physics — it is the state the first step departs from — but without it the
series began one step after the declared start and did not join the history it
continues.

```
stops:  qo < abandonment rate (default 50 stb/d)   → 'abandoned' (or 'died' at qo ≤ 0)
        Np ≥ 0.999·N                                → 'depleted'
        P ≤ max(1.02·minPwf, 120)                   → 'depleted'
        no IPR/VLP intersection                     → 'died'
        otherwise                                   → 'max-steps' (default 60)
EUR = Np at stop;  recovery % = Np/N · 100
```

### 10.1 Tarner — solution-gas material balance

Rates come from the **mobility** Darcy PI (Tarner!I13) — note there is no μ·B in
it, because mobility enters through λ:

```
J1 = 0.00708·K·h / ( ln(Re/Rw) − 0.75 + S )
λt = Kro/μo + Krg/μg          λo = Kro/μo
qt = J1·λt·(P − Pwf)
qo = J1·(λo/Bo)·(P − Pwf)
```

Material balance and producing GOR:

```
So_MB = (1 − Swi)·(N − Np)·Bo / ( N·Boi·(1 − ct) )                     (Tarner!Y)
Gp_MB = N·(Rsi − Rs) − ( N·Boi − (N − Np)·Bo )/Bg
        + N·Boi·ct/Bg + Np·Rs                                          (Tarner!O)
GOR   = Rs + (Krg/Kro)·(μo·Bo)/(μg·Bg)                                 (Tarner!P)

N, Np in MMstb;  Gp in MMscf;  Boi = Bo(Pri);  Bg in bbl/scf (Section 2 form)
```

Gas viscosity at reservoir temperature — sweet pseudo-criticals, **local** Tpr:

```
μg = μ_base(γg, Tres)/Tpr · exp( Dempsey(Ppr, Tpr) )
```

### 10.2 Walsh — generalized (volatile-oil) material balance

Same residual pair, same rel-perms, same trapezoid. The balance carries the
**volatilized oil–gas ratio** Rv — the sheet's tuned 6th-order polynomial
(Walsh!AH), divided by 1000 to bbl/scf:

```
Rv(P) = ( 1.045159231e−21·P⁶ − 1.7363576978649e−17·P⁵ + 1.17482373317021e−13·P⁴
        − 4.10981307039167e−10·P³ + 7.87671754746064e−7·P² − 0.000776441401360544·P
        + 0.332227112083792 ) / 1000
```

```
Gp_MB = ( N·( Boi·(1 − Rv·Rs) − (Bg − Rv·Bo)·Rsi − (Bo − Rs·Bg) )
          + Np·Bo − Np·Rs·Bg ) / ( Bo·Rv − Bg )
        + (N·Boi/Bg)·( ct/(1 − Swi) )                                  (Walsh!O)
So_MB = (1 − Swi)·( (1 − Np/N)·Bo·Bg − Boi·Rv·Bo )
        / ( Boi·(Bg − Rv·Bo)·(1 − ct) )                                (Walsh!Y)
Foo   = 1 / ( 1 + (Bo·Krg·μo·Rv)/(Bg·Kro·μg) )                         (Walsh!AI)
GOR   = Foo·( Rs + (Krg/Kro)·(μo·Bo)/(μg·Bg) )                         (Walsh!P)
```

Rates use the **constant calibrated PI** J (Walsh!$I$13 = J_2) — not a Darcy
recomputation, which is the substantive difference from Tarner's J1:

```
qt = J·λt·(P − Pwf)
qo = qt·λo / (λt·Bo)
```

**Two workbook quirks preserved:**

1. **μg = μo.** The sheet's "Gas Visc" column (Walsh!W) reads the *oil*
   viscosity cell (BHP!AQ), so gas mobility and the GOR ratio both run on the
   oil viscosity. Kept for parity.
2. **Bg in cf/scf** — the march form `0.0283·z·(T+460)/(P+14.5)`, **without**
   the /5.615 to bbl/scf, because the Walsh MB is written in those units. This
   is the one unit that differs between the two methods on this page: Tarner's
   Bg is bbl/scf, Walsh's is cf/scf.

Starting cumulative gas also differs: Tarner starts at 0, Walsh at Np₀·Rsi.

**Modelling limit (not a rounding issue).** Neither balance carries a
water-production term, so the Forecast W.C affects the lift calculation only and
never the material balance. On a high-water-cut well that is a real limit of the
method as ported.

---

## 11. Documented deviations from the workbooks

1. **Z factor**: the sheets GoalSeek Hall–Yarborough (left unconverged in places —
   BHP!Z50 residual −0.0715); WellSim uses explicit Brill & Beggs everywhere.
   Station-formula parity is pinned at 1e-9 with the sheet Z injected; full-march
   drift bands: natural < 2 %, gas-lift < 5.5 %, ESP < 3–5 %. Gas march: bit-exact.
2. **Solvers**: Brent replaces GoalSeek and the forecast's quadratic-LSQ
   curve-intersection — same intent, exact crossing.
3. **Forecast plateau Pwf**: reported at the produced (constrained) rate; the sheet
   reports the unconstrained intersection Pwf (quirk not replicated).
4. **Pressure update**: exact p/Z inversion instead of the sheet's one-step-lag
   Z estimate.
5. **Oil reservoir-limit Cg anchors**: first and last solved rows (the sheet pinned
   rows 5 & 14); Cg·Sg is a minor Ct term for oil, so near-immaterial.
6. **WHT**: always calculated (Ramey); the oil sheets' input-THT path was removed
   by design decision.
7. **Rounding artifacts** preserved where they matter for parity (π = 22/7 for the
   trajectory cosine, `rouhgsc` GoalSeek artifact available as a parameter override
   in tests).
8. **Oil-forecast PVT evaluation point**: Rs/Bo/Bg/μ are evaluated at the TRIAL
   pressure inside each step's solve, for both methods. The saved Tarner sheet
   froze PVT at initial values; the training material directs otherwise ("all the
   PVT data must be evaluated at the assumed reservoir pressure p2"), and the
   Walsh Gp residual moves with pressure almost entirely through the PVT
   (Bg, Rs, Rv) — freezing it leaves no root at all.
9. **Walsh PVT table pressure**: the sheet reads its PVT table at the parallel
   TARNER sheet's pressures — a shared-table convenience of the workbook.
   WellSim reads it at Walsh's own solved pressure.
