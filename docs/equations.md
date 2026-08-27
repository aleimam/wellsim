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

**Selection 1 — Pres solver + p/Z:** per row Pwf (input-or-march), then

```
Pr = √(1000·q/J + Pwf²)      Z = Z_BB(Pr, Tres)      Gp by trapezoid of q·dt
p/Z vs Gp straight line (least squares, prod points only):
GIIP [Bscf] = −(p/Z)ᵢ / slope        (minimum connected gas)
```

**Selection 2 — SITHP statics:** static gas march from SITHP down —
gas-head-only station march on the well-model grid, geothermal temperatures,
per-station explicit Z (validated 1.2 % vs the workbook's Cullender–Smith 7661.9 psi
case). Gp from the prod-table cumulative; then the same p/Z fit on the survey points.

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

Chained off the end of history (all three grey input-or-calculated):
start date = last prod date, start Gp = cumulative, start Pres = minimum solved Pres.

Per step (Δt default 30 d):

```
(p/Z)_target = (p/Z)ᵢ·(1 − Gp/GIIP)
Pr: first step = start Pres; after = Brent-invert P/Z(P) = target
IPR at Pr (Darcy) → nodal operating point at forecast FTHP
q = min(q_op, plateau)          Pwf reported at the produced rate
Gp += q·Δt/1000
```

Stops on abandonment rate, depletion, dead well, or max steps; reports EUR and
recovery %. Chart: history + forecast, calendar-date axis, rate/Gp left, Pres right.

---

## 10. Documented deviations from the workbooks

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
