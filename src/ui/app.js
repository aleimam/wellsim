/* WellSim UI — schema-driven forms + Plotly charts over the JSON API.
   Green inputs = user data (the workbook convention). */

const OIL_SCHEMA = [
  { title: 'Well & flow', fields: [
    ['thpPsi', 'FTHP', 'psi', 700],
    ['wcPct', 'Water cut', '%', 50],
    ['gorScfStb', 'GOR', 'scf/stb', 5000],
    ['tubingIdIn', 'Tubing ID', 'in', 2.992],
    ['roughness', 'Roughness', '-', 0.00006],
  ]},
  { title: 'Trajectory', fields: [
    ['topPerfAhM', 'Top perf depth', 'mAH', 2810],
    ['devStartM', 'Kick-off depth', 'm', 1910],
    ['devAngleDeg', 'Deviation angle', 'deg', 7],
  ]},
  { title: 'Fluids & PVT', fields: [
    ['api', 'Oil gravity', 'API', 46],
    ['gasSg', 'Gas SG', 'air=1', 0.842],
    ['rsiScfStb', 'Rsi', 'scf/stb', 700],
    ['tresF', 'Reservoir temp', 'F', 201],
    ['oilViscCp', 'Oil viscosity (tubing)', 'cp', 6],
    ['waterSg', 'Water SG', '-', 1.05],
    ['pbPsi', 'Pb (blank = calc)', 'psi', ''],
  ]},
  { title: 'Heat transfer (WHT is calculated)', fields: [
    ['soilTempF', 'Soil temp', 'F', 90],
    ['htcBtu', 'U coeff', 'BTU/hr.ft2.F', 3],
    ['tubingOdIn', 'Tubing OD', 'in', 3.5],
    ['cpBtu', 'Cp', 'BTU/lbm.F', 0.51],
  ]},
  { title: 'Match factors', fields: [
    ['matchHead', 'Matching head', '-', 1],
    ['matchFriction', 'Matching friction', '-', 1],
  ]},
];

// IPR basis (its own fieldset, like the gas tab): Darcy from reservoir
// properties, or the ESP workbook's route — the user types the PI J
// ('VLP-IPR'!B4 "Iput PI") and K becomes the DERIVED value, back-matched so
// J(Darcy) = PI at the chosen skin. Geometry is optional in PI mode.
const OIL_IPR_COMMON_FIELDS = [
  ['priPsi', 'Initial Pres (Pri)', 'psi', 3550],
  ['prPsi', 'Current Pres (blank = Pri)', 'psi', ''],
  ['userJ', 'Input PI J', 'bbl/d/psi', ''],
];
const OIL_IPR_DARCY_FIELDS = [
  ['permMd', 'Permeability K', 'mD', 50],
  ['thicknessFt', 'Net pay H', 'ft', 42.653],
  ['reFt', 'Re', 'ft', 1640.5],
  ['rwFt', 'Rw', 'ft', 0.5104166667],
  ['skin', 'Skin (user judgment)', '-', 0],
];
const WATER_IPR_COMMON_FIELDS = [
  ['priPsi', 'Initial Pres (Pri)', 'psi', 4800],
  ['prPsi', 'Current Pres (blank = Pri)', 'psi', ''],
  ['userJ', 'Input PI J', 'bbl/d/psi', ''],
];
const WATER_IPR_DARCY_FIELDS = [
  ['permMd', 'Permeability K', 'mD', 50],
  ['thicknessFt', 'Net pay H', 'ft', 42.653],
  ['reFt', 'Re', 'ft', 1640.5],
  ['rwFt', 'Rw', 'ft', 0.5104166667],
  ['skin', 'Skin (user judgment)', '-', 0],
  // injector only: the field's own step-rate / leak-off number. Blank = no
  // parting check at all, which is how the injector behaved before.
  ['fracGradPsiFt', 'Fracture gradient (injector)', 'psi/ft', 0.7],
];

// Per-lift demo cases. Each LIFT TYPE is a different source workbook, and
// switching lift loads that workbook's live case — but ONLY while the form
// still equals a pristine case (user-typed values are never clobbered).
// natural: the shipped demo (Oil well model Natural V3.1.7 route).
// esp: Oil well model_ESP_V5.01 — PI-input IPR (B4=2.7 @ B3=2650), test
//      point FTHP 160 / Qoil 2565 (VLP-IPR A22:B22), pump ESP B 538-3600,
//      145 stages @ 50 Hz, separator 95 % (I33:I37), actual Pint/Pdis
//      1392/2720 (B26:B27), trajectory 3240 mAH / KO 1500 / dev 0 (D3:D5).
const OIL_LIFT_CASES = {
  natural: {
    iprBasis: 'darcy',
    thpPsi: 700, wcPct: 50, gorScfStb: 5000, tubingIdIn: 2.992, roughness: 0.00006,
    topPerfAhM: 2810, devStartM: 1910, devAngleDeg: 7,
    api: 46, gasSg: 0.842, rsiScfStb: 700, tresF: 201, oilViscCp: 6, waterSg: 1.05, pbPsi: '',
    priPsi: 3550, prPsi: '', userJ: '',
    permMd: 50, thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0,
    testQOilStbD: 2100, testThpPsi: 700, testPwfPsi: '',
    pumpAhM: 2993.08, espFreqHz: 50, espStages: 145, espWearFactor: 0,
    espSepEffPct: 95, espMinIntakePsi: 300, espMeasPintPsi: '', espMeasPdisPsi: '',
  },
  esp: {
    iprBasis: 'pi',
    thpPsi: 160, wcPct: 5, gorScfStb: 384, tubingIdIn: 2.992, roughness: 0.00006,
    topPerfAhM: 3240, devStartM: 1500, devAngleDeg: 0,
    api: 32, gasSg: 0.812, rsiScfStb: 384, tresF: 230, oilViscCp: 6, waterSg: 1.05, pbPsi: '',
    priPsi: 2650, prPsi: '', userJ: 2.7,
    permMd: '', thicknessFt: 42.653, reFt: 1640.5, rwFt: 0.5104166667, skin: 0,
    testQOilStbD: 2565, testThpPsi: 160, testPwfPsi: '',
    pumpAhM: 2985, espFreqHz: 50, espStages: 145, espWearFactor: 0,
    espSepEffPct: 95, espMinIntakePsi: 300, espMeasPintPsi: 1392, espMeasPdisPsi: 2720,
  },
  gaslift: {
    iprBasis: 'pi',
    thpPsi: 300, wcPct: 25, gorScfStb: 412, tubingIdIn: 2.992, roughness: 0.0006,
    topPerfAhM: 3380, devStartM: 2400, devAngleDeg: 24.6,
    api: 33, gasSg: 0.812, rsiScfStb: 442, tresF: 251, oilViscCp: 6, waterSg: 1.05, pbPsi: '',
    priPsi: 5000, prPsi: '', userJ: 1.07896794858,
    permMd: '', thicknessFt: 65.62, reFt: 1640.5, rwFt: 0.2916666667, skin: 0,
    testQOilStbD: 1365, testThpPsi: 300, testPwfPsi: '',
    injDepthTvdM: 2490.92, injRateMMscfd: 0,
  },
};

// oil Forecast (Tarner) — grey input-or-calculated chained off Reserve
const OIL_FC_FIELDS = [
  ['startDate', 'Start date (blank = last prod)', '', ''],
  ['startNpMMstb', 'Start Np (blank = cum)', 'MMstb', ''],
  ['startPresPsi', 'Start Pres (blank = solved)', 'psi', ''],
  ['nMMstb', 'STOIIP N (blank = MB avg)', 'MMstb', ''],
  ['stepDays', 'Time step', 'days', 30],
  ['forecastFthpPsi', 'Forecast THP (blank = last prod)', 'psi', ''],
  ['fcWcPct', 'Forecast W.C (blank = last prod)', '%', ''],
  ['fcGorScfStb', 'Forecast GOR (blank = last prod)', 'scf/stb', ''],
  ['minPwfPsi', 'Minimum Pwf', 'psi', 500],
  ['swiFrac', 'Connate water Swi', 'frac', 0.15],
  ['tarCw', 'Cw', '1/psi', 0.00000263],
  ['tarCf', 'Cf (formation)', '1/psi', 0.00000325],
  ['abandonQoStbD', 'Abandonment rate', 'stb/d', 50],
  ['maxSteps', 'Max steps', '-', 60],
];

// ---- Water Well tab: oil-tab structure, water limits fixed (API 10,
// w.c. 100, no gas), rates are gross water, IPR pure linear Darcy ----
const WATER_SCHEMA = [
  { title: 'Well & flow', fields: [
    ['thpPsi', 'FTHP', 'psi', 200],
    ['tubingIdIn', 'Tubing ID', 'in', 2.992],
    ['roughness', 'Roughness', '-', 0.00006],
  ]},
  { title: 'Trajectory', fields: [
    ['topPerfAhM', 'Top perf depth', 'mAH', 2810],
    ['devStartM', 'Kick-off depth', 'm', 1910],
    ['devAngleDeg', 'Deviation angle', 'deg', 7],
  ]},
  { title: 'Fluids', fields: [
    ['waterSg', 'Water SG', '-', 1.05],
    ['gasSg', 'Lift-gas SG', 'air=1', 0.842],
    ['tresF', 'Reservoir temp', 'F', 201],
    ['injTempF', 'Injection water temp', 'F', 90],
  ]},
  { title: 'Heat transfer (WHT is calculated)', fields: [
    ['soilTempF', 'Soil temp', 'F', 90],
    ['htcBtu', 'U coeff', 'BTU/hr.ft2.F', 3],
    ['tubingOdIn', 'Tubing OD', 'in', 3.5],
    ['cpBtu', 'Cp', 'BTU/lbm.F', 0.51],
  ]},
  { title: 'Match factors', fields: [
    ['matchHead', 'Matching head', '-', 1],
    ['matchFriction', 'Matching friction', '-', 1],
  ]},
];
const WATER_TEST_FIELDS = [
  ['testQOilStbD', 'Test water rate', 'bbl/d', 2000],
  ['testThpPsi', 'Test FTHP', 'psi', 200],
  ['testPwfPsi', 'Test Pwf (blank = get Pwf)', 'psi', ''],
];
// VLP sensitivity parameters per fluid and lift type (blank cell = base).
// Water marches at its limiting case (no GOR / water cut), so only the
// hydraulic and lift parameters vary; the injector varies the injection
// THP, the injected-water temperature and the tubing.
const WATER_SENS_SETS = {
  natural: ['thpPsi', 'tubingIdIn'],
  gaslift: ['thpPsi', 'injRateMMscfd', 'tubingIdIn'],
  esp: ['thpPsi', 'freqHz', 'tubingIdIn'],
  injector: ['thpPsi', 'injTempF', 'tubingIdIn'],
};
const WATER_SENS_ROWS = [
  { label: 'VLP1', thpPsi: 400 },
  { label: 'VLP2', thpPsi: 300 },
  { label: 'VLP3', thpPsi: 100 },
];
const WATER_INJ_SENS_ROWS = [
  { label: 'VLP1', thpPsi: 100 },
  { label: 'VLP2', thpPsi: 1000 },
  { label: 'VLP3', thpPsi: 2000 },
];

// ---- oil Reserve estimate (workbook: oil reserve estimate) ----
// early-production window (days apart, like the workbook's prod_data)
const OIL_PROD_DEFAULTS = [
  { date: '17-Nov-14', thpPsi: 700, qOilStbD: 2100, gorScfStb: 5000, wcPct: 50 },
  { date: '1-Dec-14', thpPsi: 500, qOilStbD: 1700, gorScfStb: 5000, wcPct: 55 },
  { date: '17-Dec-14', thpPsi: 300, qOilStbD: 1200, gorScfStb: 5000, wcPct: 60 },
  {}, {}, {}, {}, {},
];
let oilProdCount = OIL_PROD_DEFAULTS.length;
// measured static reservoir pressures (memory-gauge surveys)
const OIL_STATIC_ROWS = [
  { date: '17-Nov-14', presPsi: 3550 },
  { date: '1-Dec-14', presPsi: 3200 },
  { date: '17-Dec-14', presPsi: 2900 },
  {},
];
// reservoir limit — oil saturation defaults (Ct = Cg·Sg + Co·So + Cw·Sw + Cf)
const OIL_RLT_FIELDS = [
  ['rltSg', 'Gas saturation Sg', 'frac', 0.1],
  ['rltSo', 'Oil saturation So', 'frac', 0.8],
  ['rltSw', 'Water saturation Sw', 'frac', 0.15],
  ['rltCg', 'Cg (blank = calc from Bg)', '1/psi', ''],
  ['rltCo', 'Co', '1/psi', 0.000001],
  ['rltCw', 'Cw', '1/psi', 0.000001],
  ['rltCf', 'Cf (formation)', '1/psi', 0.000003],
];

const OIL_GL_WELL_FIELDS = [
  ['injDepthTvdM', 'Injection depth', 'mTVD', 2490.92],
  ['injRateMMscfd', 'Injection rate', 'MMscf/d', 0],
];

const OIL_ESP_FIELDS = [
  ['pumpAhM', 'Pump depth', 'mAH', 2993.08],
  ['espFreqHz', 'Operating frequency', 'Hz', 50],
  ['espStages', 'No. of stages', '-', 145],
  ['espWearFactor', 'Wear factor', 'frac', 0],
  ['espSepEffPct', 'Gas separator efficiency', '%', 95],
  ['espMinIntakePsi', 'Design min intake P', 'psi', 300],
  ['espMeasPintPsi', 'Measured Pint (optional)', 'psi', ''],
  ['espMeasPdisPsi', 'Measured Pdis (optional)', 'psi', ''],
];
const OIL_ESP_CUSTOM_FIELDS = [['espRefFreqHz', 'Reference frequency', 'Hz', 60]];
const WATER_ESP_CUSTOM_FIELDS = [['espRefFreqHz', 'Reference frequency', 'Hz', 60]];
const OIL_ESP_MANUAL_FIELDS = [
  ['pumpDpPsi', 'Pump ΔP (manual)', 'psi', 1325.16],
  ['tubingGasScfD', 'Tubing gas (blank = formation)', 'scf/d', ''],
];
// water ESP: the same 69-pump database as oil (a pump curve is fluid-blind;
// water simply has no free gas, so no separator/intake-gas block). With a
// pump selected the dP is solved from the curve; Manual dP keeps the typed
// value and a frequency sensitivity scales it by the affinity law (f/f0)^2.
const WATER_ESP_FIELDS = [
  ['pumpAhM', 'Pump depth', 'mAH', 2993.08],
  ['espFreqHz', 'Operating frequency', 'Hz', 50],
  ['espStages', 'No. of stages', '-', 145],
  ['espWearFactor', 'Wear factor', 'frac', 0],
];
const WATER_ESP_MANUAL_FIELDS = [['pumpDpPsi', 'Pump ΔP (manual)', 'psi', 1325.16]];
const ESP_CURVE_COLS = [
  { key: 'headFt', label: 'head ft/stage' },
  { key: 'rateBpd', label: 'rate bbl/d' },
];
const ESP_CURVE_ROWS = Array.from({ length: 11 }, () => ({}));

const OIL_TEST_FIELDS = [
  ['testQOilStbD', 'Test oil rate', 'stb/d', 2100],
  ['testThpPsi', 'Test FTHP', 'psi', 700],
  ['testPwfPsi', 'Test Pwf (blank = get Pwf)', 'psi', ''],
];

const GAS_SCHEMA = [
  { title: 'Well & flow', fields: [
    ['thpPsi', 'FTHP', 'psi', 1625],
    ['cgrStbMMscf', 'CGR', 'stb/MMscf', 57.4358974],
    ['wgrStbMMscf', 'WGR', 'stb/MMscf', 3.8461538],
    ['tubingIdIn', 'Tubing ID', 'in', 2.992],
    ['roughnessBase', 'Base roughness', 'in', 0.0021],
  ]},
  { title: 'Trajectory', fields: [
    ['topPerfAhM', 'Top perf depth', 'mAH', 3013],
    ['devStartM', 'Kick-off depth', 'm', 690],
    ['devAngleDeg', 'Deviation angle', 'deg', 23.65],
  ]},
  { title: 'Fluids & PVT', fields: [
    ['condApi', 'Condensate gravity', 'API', 48.7],
    ['gasSg', 'Gas SG', 'air=1', 0.763],
    ['n2Pct', 'N2', '%', 1.2],
    ['co2Pct', 'CO2', '%', 3],
    ['h2sPpm', 'H2S', 'ppm', 2],
    ['tresF', 'Reservoir temp', 'F', 232],
    ['oilViscCp', 'Cond. viscosity', 'cp', 2],
    ['sigmaDyneCm', 'Surface tension', 'dyn/cm', 30],
  ]},
  { title: 'Heat transfer (WHT is calculated)', fields: [
    ['soilTempF', 'Soil temp', 'F', 90],
    ['htcBtu', 'U coeff', 'BTU/hr.ft2.F', 3],
    ['tubingOdIn', 'Tubing OD', 'in', 3.5],
    ['cpBtu', 'Cp', 'BTU/lbm.F', 0.51],
  ]},
  { title: 'Reservoir pressure', fields: [
    ['priPsi', 'Initial Pres (Pri)', 'psi', 3800],
    ['prPsi', 'Current Pres (blank = Pri)', 'psi', ''],
  ]},
  { title: 'Match factors', fields: [
    ['matchHead', 'Matching head', '-', 1],
    ['matchFriction', 'Matching friction', '-', 1],
  ]},
];

const GAS_DARCY_FIELDS = [
  // Gas Well model_temp V6.0.0 'VLP-IPR'!B30:B34, verbatim (31 Aug 2026 —
  // these five were placeholders before; the workbook is the spec)
  ['permMd', 'Permeability K', 'mD', 8.7],
  ['thicknessFt', 'Net pay H', 'ft', 45.934],
  ['reFt', 'Re', 'ft', 2460.75],
  ['rwFt', 'Rw', 'ft', 0.2916666667],
  ['skin', 'Skin (user judgment)', '-', 5],
];

// optional multi-layer Darcy IPR (training deck 4) — Re/Rw (and Pb, oil)
// shared from the single-layer inputs; per-layer K/H/skin/Pr + fluids
const OIL_ML_COLS = [
  { key: 'permMd', label: 'K mD' },
  { key: 'thicknessFt', label: 'H ft' },
  { key: 'skin', label: 'Skin' },
  { key: 'prPsi', label: 'Pr psi' },
  { key: 'wcPct', label: 'WC %' },
  { key: 'gorScfStb', label: 'GOR' },
];
const OIL_ML_ROWS = [
  { permMd: 50, thicknessFt: 42.653, skin: 0, prPsi: 3550, wcPct: 50, gorScfStb: 5000 },
  { permMd: 20, thicknessFt: 30, skin: 0, prPsi: 3000, wcPct: 60, gorScfStb: 4000 },
  {},
  {},
];
const GAS_ML_COLS = [
  { key: 'permMd', label: 'K mD' },
  { key: 'thicknessFt', label: 'H ft' },
  { key: 'skin', label: 'Skin' },
  { key: 'prPsi', label: 'Pr psi' },
  { key: 'cgrStbMMscf', label: 'CGR' },
  { key: 'wgrStbMMscf', label: 'WGR' },
];
const GAS_ML_ROWS = [
  { permMd: 5, thicknessFt: 80, skin: 0, prPsi: 3800, cgrStbMMscf: 57.4, wgrStbMMscf: 3.8 },
  { permMd: 3, thicknessFt: 50, skin: 0, prPsi: 3300, cgrStbMMscf: 40, wgrStbMMscf: 2 },
  {},
  {},
];

const GAS_CN_FIELDS = [
  ['cValue', 'C (blank = fit)', 'MMscf/d/psi^2n', ''],
  ['nValue', 'n (blank = fit)', '-', ''],
];

const GAS_TEST_ROWS = [
  { thpPsi: 2440, qMMscfd: 5.192, pwfPsi: '' },
  { thpPsi: 2000, qMMscfd: 10.002, pwfPsi: '' },
  { thpPsi: 1625, qMMscfd: 14.137, pwfPsi: '' },
  { thpPsi: '', qMMscfd: '', pwfPsi: '' },
];

const OIL_GL_FIELDS = [
  ['injMaxMMscfd', 'Max injection', 'MMscf/d', 2],
  ['injSteps', 'Steps', '-', 10],
];

// oil VLP sensitivity parameters per lift type (blank cell = base value)
const OIL_SENS_SETS = {
  natural: ['thpPsi', 'gorScfStb', 'wcPct', 'tubingIdIn'],
  gaslift: ['thpPsi', 'gorScfStb', 'wcPct', 'tubingIdIn', 'injRateMMscfd'],
  esp: ['thpPsi', 'gorScfStb', 'wcPct', 'tubingIdIn', 'freqHz'],
};
const OIL_SENS_ROWS = [
  { label: 'VLP1', wcPct: 0 },
  { label: 'VLP2', wcPct: 40 },
  { label: 'VLP3', wcPct: 80 },
];
// default demo history for the gas-model well (user-supplied)
const GAS_PROD_DEFAULTS = [
  { date: '17-Nov-14', thpPsi: 1625, qMMscfd: 18.56, cgrStbMMscf: 57, wgrStbMMscf: 3.8 },
  { date: '17-Nov-19', thpPsi: 1000, qMMscfd: 17, cgrStbMMscf: 40, wgrStbMMscf: 2.1 },
  { date: '26-Nov-24', thpPsi: 500, qMMscfd: 11, cgrStbMMscf: 20, wgrStbMMscf: 2.7 },
  {}, {}, {}, {}, {},
];
const MAX_PROD_ROWS = 200; // max permitted rows — inputs end where data ends
let gasProdCount = GAS_PROD_DEFAULTS.length;
// static surveys in the prod_data structure (user-supplied defaults):
// Date | STHP | Gas rate = 0 | CGR | WGR
const GAS_SITHP_ROWS = [
  { date: '17-Nov-14', sithpPsi: 2500, qMMscfd: 0, cgrStbMMscf: 57, wgrStbMMscf: 2.1 },
  { date: '17-Nov-19', sithpPsi: 2000, qMMscfd: 0, cgrStbMMscf: 40, wgrStbMMscf: 2.1 },
  { date: '26-Nov-24', sithpPsi: 1300, qMMscfd: 0, cgrStbMMscf: 20, wgrStbMMscf: 2.1 },
  {},
];
// reservoir limit — the workbook's green cells (Ct = Cg·Sg + Co·So + Cw·Sw + Cf)
const GAS_RLT_FIELDS = [
  ['rltSg', 'Gas saturation Sg', 'frac', 0.85],
  ['rltSo', 'Oil saturation So', 'frac', 0],
  ['rltSw', 'Water saturation Sw', 'frac', 0.15],
  ['rltCg', 'Cg (blank = calc from Bg)', '1/psi', ''],
  ['rltCo', 'Co', '1/psi', 0.000001],
  ['rltCw', 'Cw', '1/psi', 0.000001],
  ['rltCf', 'Cf (formation)', '1/psi', 0.000003],
];

const GAS_FC_FIELDS = [
  // grayed input-or-calculated: blank -> chained off the prod-data solver
  // (workbook AH7 start date / AH8 current Pres / AH11 cum gas)
  ['startDate', 'Start date (blank = last prod)', '', ''],
  ['startGpBscf', 'Start Gp (blank = cum)', 'Bscf', ''],
  ['startPresPsi', 'Start Pres (blank = solved)', 'psi', ''],
  ['stepDays', 'Time step', 'days', 30],
  ['forecastFthpPsi', 'Forecast FTHP', 'psi', 300],
  ['plateauMMscfd', 'Plateau (constraint)', 'MMscf/d', 12],
  ['minRateMMscfd', 'Abandonment rate', 'MMscf/d', 1],
  ['maxSteps', 'Max steps', '-', 60],
  ['giipBscf', 'GIIP (blank = prod-data p/Z fit)', 'Bscf', ''],
  ['pziPsi', 'pi/Zi (blank = prod-data fit)', 'psi', ''],
];

const GAS_SENS_COLS = ['thpPsi', 'cgrStbMMscf', 'wgrStbMMscf', 'tubingIdIn'];
const GAS_SENS_ROWS = [
  { label: 'VLP1', thpPsi: 2440 },
  { label: 'VLP2', thpPsi: 2000 },
  { label: 'VLP3', thpPsi: 1200 },
];

// ---------- form rendering ----------

const frow = (prefix, [k, label, unit, def]) =>
  `<div class="frow"><label title="${label} (${unit})">${label}<span class="unit">${unit}</span></label>` +
  `<input id="${prefix}-${k}" value="${def}" /></div>`;

function renderForm(containerId, prefix, schema) {
  const el = document.getElementById(containerId);
  el.innerHTML = schema
    .map((g) => `<div class="group"><h3>${g.title}</h3><div class="rows">${g.fields.map((f) => frow(prefix, f)).join('')}</div></div>`)
    .join('');
}

function renderFieldRow(containerId, prefix, fields) {
  document.getElementById(containerId).innerHTML =
    `<div class="rows">${fields.map((f) => frow(prefix, f)).join('')}</div>`;
}

/* ---- grayed calculated cells: a blank input the program filled shows its
   computed value in gray italics; the user typing reclaims it ---- */
function setComputed(id, value, decimals = 1) {
  const el = document.getElementById(id);
  if (!el || value == null) return;
  if (el.value.trim() === '' || el.dataset.computed === '1') {
    el.value =
      decimals === 'exp' ? Number(value).toExponential(4)
      : decimals === 'str' ? String(value)
      : Number(value).toFixed(decimals);
    el.dataset.computed = '1';
    el.classList.add('computed');
  }
}
document.addEventListener('input', (e) => {
  if (e.target?.dataset?.computed === '1') {
    delete e.target.dataset.computed;
    e.target.classList.remove('computed');
  }
});

/* ---- copyable side tables ---- */
function renderTables(containerId, tables) {
  const el = document.getElementById(containerId);
  el.innerHTML = tables
    .map(
      (t, i) =>
        `<div class="dt-head"><span>${t.title}</span><button class="copybtn" data-i="${i}">Copy</button></div>` +
        `<table><thead><tr>${t.headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
        // t.rowClass(row, i) -> a class for that <tr>, so a table can mark the
        // rows that need attention (a crossflowing layer) instead of leaving
        // the reader to compare two columns for every row
        `<tbody>${t.rows
          .map((r, ri) => {
            const cls = t.rowClass ? t.rowClass(r, ri) : '';
            return `<tr${cls ? ` class="${cls}"` : ''}>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`;
          })
          .join('')}</tbody></table>`
    )
    .join('');
  el.querySelectorAll('.copybtn').forEach((b) => {
    b.onclick = async () => {
      const t = tables[Number(b.dataset.i)];
      const tsv = [t.headers.join('\t'), ...t.rows.map((r) => r.join('\t'))].join('\n');
      try {
        await navigator.clipboard.writeText(tsv);
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Ctrl+C?';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1400);
    };
  });
}

// short, unit-bearing headers for the VLP sensitivity columns
const SENS_LABELS = {
  thpPsi: 'THP psi',
  __injThpPsi: 'Inj THP psi', // injector override (no flowing THP exists)
  gorScfStb: 'GOR scf/stb',
  wcPct: 'W.C %',
  tubingIdIn: 'Tbg ID in',
  injRateMMscfd: 'Inj gas MMscf/d',
  freqHz: 'Freq Hz',
  injTempF: 'Inj water T °F',
};

function renderSensTable(id, prefix, cols, rows, labelOverrides = {}, resetValues = false) {
  const t = document.getElementById(id);
  // keep whatever the user already typed when the column set changes
  const prev = {};
  if (!resetValues)
    for (let i = 0; i < rows.length; i++)
      for (const el of t.querySelectorAll(`input[id^="${prefix}-sens-${i}-"]`))
        prev[el.id] = el.value;
  t.innerHTML =
    `<tr><th>set</th>${cols.map((c) => `<th>${labelOverrides[c] ?? SENS_LABELS[c] ?? c}</th>`).join('')}</tr>` +
    rows
      .map((r, i) => {
        const cell = (c) => {
          const key = `${prefix}-sens-${i}-${c}`;
          const v = prev[key] ?? r[c] ?? '';
          return `<td><input id="${key}" value="${v}"/></td>`;
        };
        const lk = `${prefix}-sens-${i}-label`;
        return (
          `<tr><td><input id="${lk}" value="${prev[lk] ?? r.label}" style="width:52px"/></td>` +
          cols.map(cell).join('') +
          `</tr>`
        );
      })
      .join('');
}

function renderTestTable(id, prefix, rows) {
  const t = document.getElementById(id);
  const cols = ['thpPsi', 'qMMscfd', 'pwfPsi'];
  t.innerHTML =
    `<tr><th>THP psi</th><th>q MMscf/d</th><th>Pwf psi (blank=calc)</th></tr>` +
    rows
      .map(
        (r, i) =>
          `<tr>${cols.map((c) => `<td><input id="${prefix}-test-${i}-${c}" value="${r[c] ?? ''}"/></td>`).join('')}</tr>`
      )
      .join('');
}

function renderGridTable(id, prefix, cols, rows) {
  const t = document.getElementById(id);
  t.innerHTML =
    `<tr>${cols.map((c) => `<th class="col-${c.key}">${c.label}</th>`).join('')}</tr>` +
    rows
      .map(
        (r, i) =>
          `<tr>${cols
            .map((c) =>
              c.out
                ? `<td class="col-${c.key}"><input id="${prefix}-${i}-${c.key}" class="outcell" readonly tabindex="-1" value="${r[c.key] ?? ''}"/></td>`
                : `<td class="col-${c.key}"><input id="${prefix}-${i}-${c.key}" value="${r[c.key] ?? ''}"/></td>`
            )
            .join('')}</tr>`
      )
      .join('');
}

/**
 * A survey table that grows to the pasted/typed data — the prod_data
 * behaviour (paste, Import CSV, +10 rows, Clear) for the smaller reserve
 * tables. Clipboard/CSV cells are read in the order the table's INPUT
 * columns are declared; the calculated columns are skipped. Returns the live
 * row count through count(), so the form collector and the result-filling
 * loops follow the table instead of a fixed default length.
 */
function dynamicTable({ tableId, prefix, cols, defaults, minRows = 4 }) {
  const inputCols = cols.filter((c) => !c.out);
  let count = defaults.length;
  const values = () => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const row = {};
      for (const c of inputCols) row[c.key] = formVal(`${prefix}-${i}-${c.key}`);
      out.push(row);
    }
    return out;
  };
  const render = (vals) => {
    count = Math.min(Math.max(vals.length, minRows), MAX_PROD_ROWS);
    const rows = vals.slice(0, count);
    while (rows.length < count) rows.push({});
    renderGridTable(tableId, prefix, cols, rows);
  };
  const ensure = (n) => {
    if (n <= count) return;
    const vals = values();
    while (vals.length < Math.min(n, MAX_PROD_ROWS)) vals.push({});
    render(vals);
  };
  const fill = (rows, startIdx = 0) => {
    if (rows.length === 0) return;
    ensure(startIdx + rows.length);
    rows.forEach((r, k) => {
      const i = startIdx + k;
      if (i >= count) return;
      for (const c of inputCols) {
        const el = document.getElementById(`${prefix}-${i}-${c.key}`);
        if (el && r[c.key] != null && r[c.key] !== '') el.value = r[c.key];
      }
    });
  };
  const parse = (text) => parseTableClipboard(text, inputCols.map((c) => c.key));
  render(defaults);
  wireTableInput({ tableId, prefix, parse, fill, render, ensure, count: () => count, minRows });
  return { count: () => count, render, ensure, fill, parse, values };
}

/** Clipboard/CSV text (TSV, CSV or semicolon) -> rows keyed by `keys` in
 *  column order. A first line whose first cell STARTS with a letter is a
 *  header; a d-MMM-yy date does not (it only contains letters). */
function parseTableClipboard(text, keys) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  const rows = [];
  for (const line of lines) {
    const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (rows.length === 0 && /^[A-Za-z]/.test(cells[0] ?? '')) continue; // header
    if ((cells[0] ?? '') === '') continue;
    const row = {};
    keys.forEach((k, i) => (row[k] = cells[i]));
    rows.push(row);
  }
  return rows;
}

/** Wire the four action buttons and in-cell Ctrl+V for a dynamic table. */
function wireTableInput({ tableId, prefix, parse, fill, render, ensure, count, minRows }) {
  const el = document.getElementById(tableId);
  if (el) {
    el.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (!text.includes('\n') && !text.includes('\t')) return; // single value: default behavior
      e.preventDefault();
      const m = e.target?.id?.match(new RegExp(`^${prefix}-(\d+)-`));
      fill(parse(text), m ? Number(m[1]) : 0);
    });
  }
  const on = (id, fn) => {
    const b = document.getElementById(id);
    if (b) b.onclick = fn;
  };
  on(`${prefix}-paste`, async () => {
    try {
      fill(parse(await navigator.clipboard.readText()), 0);
    } catch {
      showError('Clipboard read not permitted — click a cell in the table and press Ctrl+V instead.');
    }
  });
  on(`${prefix}-csv`, () => csvImport(parse, fill));
  on(`${prefix}-add`, () => ensure(count() + 10));
  on(`${prefix}-clear`, () => render(Array.from({ length: minRows }, () => ({}))));
}

function collectGrid(prefix, cols, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = {};
    for (const c of cols) if (!c.out) row[c.key] = formVal(`${prefix}-${i}-${c.key}`);
    out.push(row);
  }
  return out;
}

function setOut(id, value, decimals = 1) {
  const el = document.getElementById(id);
  if (el) el.value = value == null ? '' : Number(value).toFixed(decimals);
}

// the workbook prod_data layout: Date | FTHP | Gas rate | CGR | WGR (inputs;
// Date accepts dd/mm/yyyy hh:mm:ss or a day serial, sporadic timing ok),
// then dt | Pwf | pr | z (calculated; Pwf accepts a gauge value).
const PROD_COLS = [
  { key: 'date', label: 'Date dd/mm/yyyy hh:mm:ss' },
  { key: 'thpPsi', label: 'FTHP psi' },
  { key: 'qMMscfd', label: 'Gas MMscf/d' },
  { key: 'cgrStbMMscf', label: 'CGR' },
  { key: 'wgrStbMMscf', label: 'WGR' },
  { key: 'dtDays', label: 'dt d', out: true },
  { key: 'pwfPsi', label: 'Pwf psi' },
  { key: 'presPsi', label: 'pr', out: true },
  { key: 'z', label: 'z', out: true },
];
// memory-gauge surveys: Date | Pr. The demo values ARE the pressures the
// SITHP route computes from its own defaults (2500/2000/1300 psi STHP), so
// routes 2 and 4 agree out of the box and can be cross-checked.
const GAS_GAUGE_ROWS = [
  { date: '17-Nov-14', presPsi: 3266.3 },
  { date: '17-Nov-19', presPsi: 2607.1 },
  { date: '26-Nov-24', presPsi: 1671.0 },
  {},
];
const GAS_GAUGE_COLS = [
  { key: 'date', label: 'Date dd-MMM-yy' },
  { key: 'presPsi', label: 'Pr psi (gauge)' },
  // blank = the reading is already at datum (the perf depth)
  { key: 'gaugeTvdM', label: 'Gauge TVD m' },
  { key: 'corrPsi', label: 'to datum psi', out: true },
  { key: 'dtDays', label: 'dt d', out: true },
  { key: 'z', label: 'z', out: true },
  { key: 'gpBscf', label: 'Gp Bscf', out: true },
  { key: 'pOverZ', label: 'p/Z psi', out: true },
];
const SITHP_COLS = [
  { key: 'date', label: 'Date dd-MMM-yy' },
  { key: 'sithpPsi', label: 'STHP psi' },
  { key: 'qMMscfd', label: 'Gas rate (0)' },
  { key: 'cgrStbMMscf', label: 'CGR' },
  { key: 'wgrStbMMscf', label: 'WGR' },
  { key: 'dtDays', label: 'dt d', out: true },
  { key: 'presPsi', label: 'pr', out: true },
  { key: 'z', label: 'z', out: true },
];

/* ---- dynamic prod_data table: grows to the pasted/typed data ---- */
function readProdValues() {
  const out = [];
  for (let i = 0; i < gasProdCount; i++) {
    const row = {};
    for (const c of PROD_COLS) if (!c.out) row[c.key] = formVal(`gas-prod-${i}-${c.key}`);
    out.push(row);
  }
  return out;
}

function renderProdTable(values) {
  gasProdCount = Math.min(Math.max(values.length, 4), MAX_PROD_ROWS);
  const rows = values.slice(0, gasProdCount);
  while (rows.length < gasProdCount) rows.push({});
  renderGridTable('gas-prod-table', 'gas-prod', PROD_COLS, rows);
}

function ensureProdRows(n) {
  if (n <= gasProdCount) return;
  const vals = readProdValues();
  while (vals.length < Math.min(n, MAX_PROD_ROWS)) vals.push({});
  renderProdTable(vals);
}

/** Parse clipboard text (TSV/CSV/semicolon) into prod rows; header line
 *  auto-skipped. Column order: Date, FTHP, q, CGR, WGR, Pwf. */
function parseProdClipboard(text) {
  return parseTableClipboard(text, ['date', 'thpPsi', 'qMMscfd', 'cgrStbMMscf', 'wgrStbMMscf', 'pwfPsi']);
}

function fillProdRows(rows, startIdx = 0) {
  if (rows.length === 0) return;
  ensureProdRows(startIdx + rows.length);
  rows.forEach((r, k) => {
    const i = startIdx + k;
    if (i >= gasProdCount) return;
    for (const c of PROD_COLS) {
      if (c.out) continue;
      const el = document.getElementById(`gas-prod-${i}-${c.key}`);
      if (el && r[c.key] != null && r[c.key] !== '') {
        el.value = r[c.key];
        delete el.dataset.computed;
        el.classList.remove('computed');
      }
    }
  });
}

/* ---- oil prod_data + static-survey tables (same pattern as gas) ---- */
const OIL_PROD_COLS = [
  { key: 'date', label: 'Date dd/mm/yyyy hh:mm:ss' },
  { key: 'thpPsi', label: 'FTHP psi' },
  { key: 'qOilStbD', label: 'Oil stb/d' },
  { key: 'gorScfStb', label: 'GOR scf/stb' },
  { key: 'wcPct', label: 'WC %' },
  { key: 'dtDays', label: 'dt d', out: true },
  { key: 'pwfPsi', label: 'Pwf psi' },
  { key: 'presPsi', label: 'pr', out: true },
  { key: 'z', label: 'z', out: true },
];
const OIL_STATIC_COLS = [
  { key: 'date', label: 'Date dd-MMM-yy' },
  { key: 'presPsi', label: 'Pres psi (gauge)' },
  { key: 'dtDays', label: 'dt d', out: true },
  { key: 'npMMstb', label: 'Np MMstb', out: true },
  { key: 'gpBscf', label: 'Gp Bscf', out: true },
  { key: 'nMMstb', label: 'N MMstb', out: true },
];

function readOilProdValues() {
  const out = [];
  for (let i = 0; i < oilProdCount; i++) {
    const row = {};
    for (const c of OIL_PROD_COLS) if (!c.out) row[c.key] = formVal(`oil-prod-${i}-${c.key}`);
    out.push(row);
  }
  return out;
}

function renderOilProdTable(values) {
  oilProdCount = Math.min(Math.max(values.length, 4), MAX_PROD_ROWS);
  const rows = values.slice(0, oilProdCount);
  while (rows.length < oilProdCount) rows.push({});
  renderGridTable('oil-prod-table', 'oil-prod', OIL_PROD_COLS, rows);
}

function ensureOilProdRows(n) {
  if (n <= oilProdCount) return;
  const vals = readOilProdValues();
  while (vals.length < Math.min(n, MAX_PROD_ROWS)) vals.push({});
  renderOilProdTable(vals);
}

/** Clipboard column order: Date, FTHP, q oil, GOR, WC, Pwf. */
function parseOilProdClipboard(text) {
  return parseTableClipboard(text, ['date', 'thpPsi', 'qOilStbD', 'gorScfStb', 'wcPct', 'pwfPsi']);
}

function fillOilProdRows(rows, startIdx = 0) {
  if (rows.length === 0) return;
  ensureOilProdRows(startIdx + rows.length);
  rows.forEach((r, k) => {
    const i = startIdx + k;
    if (i >= oilProdCount) return;
    for (const c of OIL_PROD_COLS) {
      if (c.out) continue;
      const el = document.getElementById(`oil-prod-${i}-${c.key}`);
      if (el && r[c.key] != null && r[c.key] !== '') {
        el.value = r[c.key];
        delete el.dataset.computed;
        el.classList.remove('computed');
      }
    }
  });
}

const PRES_FRACTIONS = [0.75, 0.5, 0.25];
// the ESP Pres sensitivity uses SHALLOWER steps: a pump still has to lift at
// modest depletion, and 0.25 x Pr kills most ESP wells outright
const ESP_PRES_FRACTIONS = [0.9, 0.8, 0.7];
/** What refreshPresDefaults last wrote, per prefix — a field still holding
 *  one of these is untouched and may be refreshed; anything else is the
 *  user's and is left alone. */
const presAuto = {};

function renderPresList(id, prefix, defaults) {
  document.getElementById(id).innerHTML = defaults
    .map((v, i) => `<input id="${prefix}-pres-${i}" value="${v}" />`)
    .join('');
  presAuto[prefix] = defaults.map((v) => String(v));
}

/**
 * Future reservoir pressures track the CURRENT Pr (falling back to Pri while
 * Pr is blank): they are fractions of the pressure the well is at NOW, not of
 * one it left behind — on a depleted well the Pri-based list could otherwise
 * sit above the current pressure. A value the user has typed is never
 * overwritten.
 */
function refreshPresDefaults(prefix, prId = `${prefix}-prPsi`, priId = `${prefix}-priPsi`, fractions = PRES_FRACTIONS) {
  const pr = Number(val(prId)) || Number(val(priId));
  if (!(pr > 0)) return;
  const next = fractions.map((x) => Math.round(pr * x));
  const prev = presAuto[prefix] ?? [];
  for (let i = 0; i < next.length; i++) {
    const el = document.getElementById(`${prefix}-pres-${i}`);
    if (!el) continue;
    const cur = el.value.trim();
    if (cur === '' || cur === String(prev[i] ?? '')) el.value = String(next[i]);
  }
  presAuto[prefix] = next.map((v) => String(v));
}

const val = (id) => document.getElementById(id)?.value?.trim() ?? '';

/** Form value for submission: a grayed computed cell counts as EMPTY so the
 *  server keeps computing it (the user has not committed a value). */
const formVal = (id) => {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.dataset.computed === '1') return '';
  return el.value.trim();
};

function collect(prefix, schema, extraFields = []) {
  const f = {};
  for (const g of schema) for (const [k] of g.fields) f[k] = formVal(`${prefix}-${k}`);
  for (const [k] of extraFields) f[k] = formVal(`${prefix}-${k}`);
  return f;
}

function collectSens(prefix, cols, n) {
  const sets = [];
  for (let i = 0; i < n; i++) {
    const s = { label: val(`${prefix}-sens-${i}-label`) };
    for (const c of cols) s[c] = val(`${prefix}-sens-${i}-${c}`);
    sets.push(s);
  }
  return sets;
}

function collectPres(prefix, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(val(`${prefix}-pres-${i}`));
  return out.filter((v) => v !== '');
}

function collectGasTests() {
  const pts = [];
  for (let i = 0; i < GAS_TEST_ROWS.length; i++) {
    pts.push({ thpPsi: val(`gas-test-${i}-thpPsi`), qMMscfd: val(`gas-test-${i}-qMMscfd`), pwfPsi: formVal(`gas-test-${i}-pwfPsi`) });
  }
  return pts.filter((p) => p.qMMscfd !== '');
}

// ---------- API + rendering ----------

async function api(path, body) {
  showError('');
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    showError(data.error);
    throw new Error(data.error);
  }
  // whatever this call is about to draw, make sure it ends up fitted to its
  // box (a run can finish while its panel is hidden — see refitCharts)
  setTimeout(refitCharts, 120);
  setTimeout(refitCharts, 700);
  return data;
}

function showError(msg) {
  const bar = document.getElementById('error-bar');
  bar.style.display = msg ? 'block' : 'none';
  bar.textContent = msg;
  bar.classList.remove('ok');
}

/** Short-lived confirmation on the same bar. Saving closes the account
 *  panel, so without this the user gets no acknowledgement at all. */
let okTimer = null;
function showOk(msg, ms = 2600) {
  const bar = document.getElementById('error-bar');
  bar.textContent = msg;
  bar.classList.add('ok');
  bar.style.display = 'block';
  clearTimeout(okTimer);
  okTimer = setTimeout(() => {
    if (bar.classList.contains('ok')) { bar.style.display = 'none'; bar.classList.remove('ok'); }
  }, ms);
}

const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

// ---- mobile Inputs | Results views (The PWF bottom-bar pattern) ----
const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

function setMobileView(v) {
  document.body.classList.toggle('view-inputs', v === 'inputs');
  document.body.classList.toggle('view-results', v === 'results');
  document.getElementById('mb-inputs').classList.toggle('active', v === 'inputs');
  document.getElementById('mb-results').classList.toggle('active', v === 'results');
  if (v === 'results') resizeVisibleCharts();
}

// Inputs is the start view on phones; a completed run jumps to Results —
// but only a run the USER started (the page's initial auto-solve must not
// steal the start view). Any tap on an action button opens a jump window.
let lastRunClickMs = 0;
document.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('.action')) lastRunClickMs = Date.now();
}, true);

function mobileShowResults() {
  if (isPhone() && Date.now() - lastRunClickMs < 30000) setMobileView('results');
}

// live headline result in the header (the PWF bar pattern)
function setHeadline(value, caption) {
  const el = document.getElementById('hdr-result');
  el.querySelector('.hv').textContent = value;
  el.querySelector('.hk').textContent = caption;
  el.classList.remove('empty');
}

function summary(id, cards) {
  document.getElementById(id).innerHTML = cards
    .filter((c) => c)
    .map(
      (c) => `<div class="card${c.warn ? ' warn' : ''}"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`
    )
    .join('');
  const first = cards.filter((c) => c)[0];
  if (first) setHeadline(first.v, first.k);
  mobileShowResults();
}

// On phones the chart size is FIXED, computed once from the viewport (screen
// width minus page padding and borders): charts fit the view exactly and never
// re-fit as panels toggle. Desktop keeps fluid autosizing. The phone bottom
// margin leaves room for the axis title AND the legend below it (no overlap).
// phones and touch tablets: no zoom/pan (an accidental finger-drag froze
// charts at a wrong scale) and no modebar (its icons sat on chart titles).
// Big-screen mouse users keep both.
const TOUCH_UI = () =>
  window.innerWidth < 640 || (((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window) && window.innerWidth < 1024);

const LAYOUT = () => ({
  margin: window.innerWidth < 640 ? { l: 46, r: 12, t: 34, b: 88 } : { l: 60, r: 20, t: 40, b: 45 },
  ...(window.innerWidth < 640
    ? { autosize: false, width: window.innerWidth - 18, height: 300 }
    : { height: 380 }),
  ...(TOUCH_UI() ? { dragmode: false } : {}),
  font: { family: '"IBM Plex Sans", "Segoe UI", sans-serif', size: window.innerWidth < 640 ? 11 : 12, color: '#0B1418' },
  legend: window.innerWidth < 640 ? { orientation: 'h', y: -0.42 } : { orientation: 'h', y: -0.22 },
  plot_bgcolor: '#FBFCFC',
  paper_bgcolor: '#FFFFFF',
});

const PLOT_CFG = () => ({ displaylogo: false, responsive: true, displayModeBar: TOUCH_UI() ? false : undefined, scrollZoom: false });

/**
 * Phone legend placement, applied to EVERY chart. A horizontal legend
 * defaults to sitting just under the plot, where it lands on the x-axis
 * title and — with many traces (the 11-trace pump curve) — swallows the
 * drawing area itself. So: estimate how many rows the legend needs at this
 * width, start it BELOW the tick-label + axis-title block, and grow the
 * canvas by exactly the legend's height, leaving the plot area intact.
 */
function applyPhoneLegend(layout, traces) {
  if (window.innerWidth >= 640 || !Array.isArray(traces) || !traces.length) return layout;
  const PLOT_H = 176;      // drawing area kept for the curves
  const AXIS_BLOCK = 55;   // x tick labels + axis title below the plot floor
  const LEGEND_GAP = 8;
  const margin = { ...(layout.margin ?? {}) };
  const usable = Math.max(160, (layout.width ?? window.innerWidth - 18) - (margin.l ?? 46) - (margin.r ?? 12));
  const named = traces.filter((t) => t.showlegend !== false && t.name);
  if (!named.length) return layout;
  const longest = Math.max(...named.map((t) => String(t.name).length), 6);
  const perRow = Math.max(1, Math.floor(usable / (longest * 5.6 + 30)));
  const rows = Math.ceil(named.length / perRow);
  const legendH = rows * 16 + 6;
  const legendTop = AXIS_BLOCK + LEGEND_GAP;
  layout.legend = { orientation: 'h', y: -(legendTop / PLOT_H), yanchor: 'top', x: 0, font: { size: 9 }, tracegroupgap: 2 };
  margin.b = legendTop + legendH + 8;
  layout.margin = margin;
  layout.height = (margin.t ?? 34) + PLOT_H + margin.b;
  return layout;
}

/**
 * Draw a chart. On phones the legend placement is estimated first (above)
 * and then CORRECTED from the drawing: text width per label is only ever a
 * guess, so after the plot exists we measure where the legend actually
 * landed against the axis title and nudge it down (growing the canvas by
 * the same amount) if it is still riding on the title.
 */
/**
 * Pressure is an absolute quantity: an axis that dips below zero is telling
 * the reader something that cannot exist. Plotly pads its autorange, so any
 * pressure axis left on autorange can show negative ticks — and the fitted
 * slope line on the reservoir-limit charts genuinely extrapolates below 0.
 *
 * Neither rangemode helps on its own: 'tozero' still starts negative when the
 * DATA is negative, and 'nonnegative' does not force the axis to begin AT
 * zero. So compute the axis maximum from the traces and pin [0, max].
 *
 * Done here, in the one function every chart goes through, so the rule holds
 * for charts that do not exist yet. An axis that already declares its own
 * range (the sensitivity charts pin [0, Pri]) is left alone.
 */
function floorPressureAxes(layout, traces) {
  if (!layout) return layout;
  const isPressure = (ax) => /\bpsi\b/i.test(ax?.title?.text ?? ax?.title ?? '');
  const out = { ...layout };
  for (const key of ['xaxis', 'yaxis', 'yaxis2']) {
    const ax = out[key];
    if (!ax || !isPressure(ax) || ax.range || ax.autorange === false) continue;
    // which trace values feed this axis
    const dim = key === 'xaxis' ? 'x' : 'y';
    const wantSecondary = key === 'yaxis2';
    let max = -Infinity;
    for (const t of traces ?? []) {
      if (dim === 'y' && ((t.yaxis === 'y2') !== wantSecondary)) continue;
      for (const v of t[dim] ?? []) {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    if (!Number.isFinite(max) || max <= 0) continue; // nothing sane to scale to
    out[key] = { ...ax, range: [0, max * 1.05] };
  }
  return out;
}

function plot(div, traces, layout) {
  const p = Plotly.newPlot(div, traces, applyPhoneLegend(floorPressureAxes(layout, traces), traces), PLOT_CFG());
  return p.then((gd) => {
    const el = gd ?? (typeof div === 'string' ? document.getElementById(div) : div);
    if (!el || !el.layout || el.offsetParent === null) return el;
    // Three measure-after-draw corrections, each a no-op when nothing is
    // wrong. Width FIRST: it changes what the other two are measuring.
    return fitChartWidth(el)
      .then(() => fitChartTitle(el))
      .then(() => fitChartLegend(el));
  });
}

/**
 * A chart can be drawn WIDER than the box holding it: inside a .chartrow the
 * chart is a flex child sharing the row with a 250px table, and if the flex
 * layout has not settled when Plotly measures (a row revealed in the same
 * tick, or drawn while hidden) it sizes to the pre-layout width. The SVG then
 * overhangs and laps the table beside it — measured 51px over, 42px of lap on
 * the gas-lift and traverse rows.
 * Measure against the container and resize when they disagree. A no-op when
 * they already match, which is the normal case.
 */
function fitChartWidth(el) {
  const svg = el.querySelector('svg.main-svg');
  if (!svg) return Promise.resolve(el);
  const have = svg.getBoundingClientRect().width;
  const want = el.getBoundingClientRect().width;
  if (!(want > 0) || Math.abs(have - want) <= 2) return Promise.resolve(el);
  return Promise.resolve(Plotly.Plots.resize(el)).then(() => el);
}

/** Keep the chart title inside the canvas: shrink it to fit, and if that
 *  would take it below readable size, wrap it onto a second line instead.
 *  Runs at every width — a narrow results column clips a long title on the
 *  desktop just as a phone does; it is a no-op when the title already fits.
 *  (The ESP pump-curve title carries the pump name, stage count and wear,
 *  which overran a phone canvas by 12 px at the default size.) */
function fitChartTitle(el) {
  const node = el.querySelector('.gtitle');
  const svg = el.querySelector('svg.main-svg');
  if (!node || !svg) return Promise.resolve(el);
  const avail = svg.getBoundingClientRect().width - 14;
  const width = node.getBoundingClientRect().width;
  if (width <= avail || width <= 0) return Promise.resolve(el);
  const current = parseFloat(getComputedStyle(node).fontSize) || 15;
  const needed = Math.floor(current * (avail / width));
  const MIN = 11;
  if (needed >= MIN) return Plotly.relayout(el, { 'title.font.size': needed }).then(() => el);
  // too long to shrink: break it at the em dash (or the first comma)
  const text = el.layout.title?.text ?? '';
  const at = text.indexOf(' — ') >= 0 ? text.indexOf(' — ') : text.indexOf(', ');
  if (at < 0) return Plotly.relayout(el, { 'title.font.size': MIN }).then(() => el);
  const wrapped = `${text.slice(0, at)}<br>${text.slice(at).replace(/^(\s*—\s*|,\s*)/, '')}`;
  return Plotly.relayout(el, {
    'title.text': wrapped,
    'title.font.size': MIN + 1,
    'margin.t': (el.layout.margin?.t ?? 34) + 14,
    height: (el.layout.height ?? 300) + 14,
  }).then(() => el);
}

/** The legend must clear the x-axis title; the phone estimate in
 *  applyPhoneLegend is text-width based, so correct it from the drawing.
 *  Runs at EVERY width: the sensitivity charts now carry up to 13 traces,
 *  whose legend wraps to three rows and overruns the desktop bottom margin
 *  (a fixed 45px sized for one row). A no-op when nothing overlaps. */
function fitChartLegend(el) {
  const title = el.querySelector('.g-xtitle');
  const legend = el.querySelector('g.legend');
  if (!title || !legend) return Promise.resolve(el);
  const t = title.getBoundingClientRect();
  const l = legend.getBoundingClientRect();
  const encroach = t.bottom + 6 - l.top; // >0 means the legend sits too high
  if (encroach <= 0) return Promise.resolve(el);
  const plotH = (el.layout.height ?? 300) - (el.layout.margin?.t ?? 34) - (el.layout.margin?.b ?? 60);
  if (plotH <= 0) return Promise.resolve(el);
  return Plotly.relayout(el, {
    'legend.y': (el.layout.legend?.y ?? -0.36) - encroach / plotH,
    'margin.b': (el.layout.margin?.b ?? 60) + encroach,
    height: (el.layout.height ?? 300) + encroach,
  }).then(() => el);
}

function plotNodal(div, xTitle, ipr, vlp, op, iprX, vlpX, opts = {}) {
  const traces = [
    { x: ipr.map(iprX), y: ipr.map((p) => p.pwfPsi), name: opts.iprName ?? 'IPR', mode: 'lines', line: { color: '#00636D', width: 3 } },
    { x: vlp.map(vlpX), y: vlp.map((p) => p.pwfPsi), name: opts.vlpName ?? 'VLP', mode: 'lines+markers', line: { color: '#C2540B', width: 3 } },
  ];
  if (op) {
    traces.push({
      x: [op.q], y: [op.pwfPsi], name: opts.opName ?? 'Operating point', mode: 'markers',
      marker: { symbol: 'diamond', size: 14, color: '#0B1418', line: { width: 2, color: '#fff' } },
    });
  }
  // extra curves (per-layer IPRs) go UNDER the composite and the VLP: they are
  // context, and a well with six layers must not bury the two curves the
  // operating point actually sits on
  if (opts.extra?.length) traces.unshift(...opts.extra);
  plot(div, traces, {
    ...LAYOUT(),
    title: opts.title ?? 'IPR / VLP — bottomhole node',
    // The rate axis starts at zero. A well does not produce a negative rate,
    // and letting the axis run left of zero pushed the whole operating range
    // into the right half of the plot. 'nonnegative' floors it whatever the
    // data does, the same guarantee floorPressureAxes gives the psi axes.
    //
    // The one thing this clips is the negative branch of a crossflowing
    // multi-layer curve. That branch is a picture of the sign, not the only
    // statement of it: the layer stays in the legend as "· CROSSFLOW", its
    // curve visibly runs off the left edge instead of turning up, and the
    // layer table still prints the negative rate and share on a tinted row.
    xaxis: { title: xTitle, rangemode: 'nonnegative' },
    yaxis: { title: 'Pressure, psi' },
  });
}

// Per-layer IPR curves for the multi-layer nodal chart. Three deliberate
// choices: layers are thin and dashed so the composite and the VLP stay the
// curves your eye lands on; a layer that crossflows AT THE OPERATING POINT is
// drawn in the warning colour and says so in the legend, because that is the
// one fact a reader must not miss; and the TRUE commingled sum is drawn too,
// because the chart's "IPR" is the collapsed one-final-J equivalent and the
// layers would otherwise appear not to add up to it.
const LAYER_COLORS = ['#4292c6', '#2C7048', '#8A6D1A', '#7038b0', '#00636D', '#93400A'];

// Crossflow is judged on the layer's PRIMARY rate (gross liquid, or gas),
// never on the plotted x quantity: a 100%-water oil layer has qOil = 0 and
// would hide its own crossflow behind a lost sign.
const mlRateOf = (p) => p.qGrossStbD ?? p.qMMscfd;

function mlLayerTraces(r, xOf) {
  const ml = r.multiLayer;
  if (!ml?.curves?.layers?.length) return [];
  const atOp = ml.layersAtOp?.layers ?? [];
  const traces = ml.curves.layers.map((L, i) => {
    const xflow = atOp[i] ? mlRateOf(atOp[i]) < 0 : false;
    return {
      x: L.curve.map(xOf),
      y: L.curve.map((p) => p.pwfPsi),
      name: `${L.name} · Pr ${fmt(L.prPsi, 0)}${xflow ? ' · CROSSFLOW' : ''}`,
      mode: 'lines',
      line: {
        color: xflow ? '#A93A2C' : LAYER_COLORS[i % LAYER_COLORS.length],
        width: 1.5,
        dash: xflow ? 'dot' : 'dash',
      },
    };
  });
  traces.push({
    x: ml.curves.total.map(xOf),
    y: ml.curves.total.map((p) => p.pwfPsi),
    name: 'IPR (layers summed)',
    mode: 'lines',
    line: { color: '#0B1418', width: 1.5, dash: 'longdash' },
  });
  return traces;
}

const FAM_BLUES = ['#9ecae1', '#4292c6', '#084594'];
const FAM_REDS = ['#fcae91', '#fb6a4a', '#a50f15'];

function plotSens(div, xTitle, iprFam, vlpFam, iprX, opts = {}) {
  // On a phone these families can reach nine traces; with the full names
  // the horizontal legend wraps to one row EACH and swallows the plot
  // (measured: a 182x176 legend box over a 271x73 plot). Compact labels —
  // "Req 4400" instead of "Required Pres1=4400 psi" — fit several per row.
  const phone = window.innerWidth < 640;
  const shortLabel = (s) => String(s).replace(/Pres\d+\s*=\s*/, '').replace(/\s*psi\s*$/, '');
  const iprName = phone ? (opts.iprNameShort ?? opts.iprName ?? 'IPR') : (opts.iprName ?? 'IPR');
  const vlpName = phone ? (opts.vlpNameShort ?? '') : (opts.vlpName ?? 'VLP');
  const nameOf = (base, label) => {
    const lab = phone ? shortLabel(label) : label;
    return base ? `${base} ${lab}` : lab;
  };
  const traces = [];
  // the current-Pr curve is what the per-set solutions are solved against, so
  // it leads the legend and is drawn solid and heavier than the future family
  const refs = iprFam.filter((m) => m.isCurrent);
  const future = iprFam.filter((m) => !m.isCurrent);
  refs.forEach((m) =>
    traces.push({
      x: m.curve.map(iprX), y: m.curve.map((p) => p.pwfPsi),
      name: nameOf(iprName, m.label), mode: 'lines',
      line: { color: '#00636D', width: 3.5 },
    })
  );
  future.forEach((m, i) =>
    traces.push({ x: m.curve.map(iprX), y: m.curve.map((p) => p.pwfPsi), name: nameOf(iprName, m.label), mode: 'lines', line: { color: FAM_BLUES[i % 3], width: 2.5 } })
  );
  vlpFam.forEach((m, i) =>
    traces.push({ x: m.curve.map((p) => p.q), y: m.curve.map((p) => p.pwfPsi), name: nameOf(vlpName, m.label), mode: 'lines', line: { color: FAM_REDS[i % 3], width: 2.5, dash: 'dot' } })
  );
  // each set's NODAL SOLUTION against the current IPR — the same numbers the
  // table lists. Without these the reader had to infer the intersection.
  const opQ = opts.opQ;
  // a set with its own water cut solves against its own IPR in rate terms —
  // draw it thin, in the set's colour, so its node is a visible intersection
  vlpFam.forEach((m, i) => {
    if (!m.iprCurve) return;
    traces.push({
      x: m.iprCurve.map(iprX), y: m.iprCurve.map((p) => p.pwfPsi),
      name: nameOf(iprName, `${m.label} @ Pr`), mode: 'lines',
      line: { color: FAM_REDS[i % 3], width: 1.25 },
    });
  });
  if (opQ) {
    const solved = vlpFam.map((m, i) => ({ m, i })).filter(({ m }) => m.op && opQ(m.op) != null);
    solved.forEach(({ m, i }) =>
      traces.push({
        x: [opQ(m.op)], y: [m.op.pwfPsi],
        name: phone ? 'node' : `${m.label} node`,
        showlegend: !phone || i === 0,
        mode: 'markers',
        marker: { symbol: 'diamond', size: 12, color: FAM_REDS[i % 3], line: { width: 1.5, color: '#0B1418' } },
      })
    );
  }
  // the pressure axis tops out at Pri: in a producing system neither the
  // IPR nor the VLP can sit above the initial reservoir pressure, so a
  // fixed [0, Pri] scale makes the families comparable run to run
  const layout = {
    ...LAYOUT(),
    title: opts.title ?? 'IPR & VLP sensitivities',
    xaxis: { title: xTitle },
    yaxis: { title: 'Pressure, psi', ...(opts.priPsi > 0 ? { range: [0, opts.priPsi] } : { rangemode: 'tozero' }) },
  };
  // injector: the injection-water temperature moves the BOTTOMHOLE
  // temperature rather than the pressure (incompressible water), so its
  // families are only visible on a second axis
  if (opts.showBht && vlpFam.some((m) => m.curve.some((p) => p.bhtF != null))) {
    vlpFam.forEach((m, i) =>
      traces.push({
        x: m.curve.map((p) => p.q), y: m.curve.map((p) => p.bhtF), name: nameOf('BHT', m.label),
        yaxis: 'y2', mode: 'lines', line: { color: FAM_BLUES[i % 3], width: 1.5, dash: 'dash' },
      })
    );
    layout.yaxis2 = { title: 'BHT, °F', overlaying: 'y', side: 'right', showgrid: false };
    layout.margin = { ...layout.margin, r: window.innerWidth < 640 ? 40 : 55 };
  }
  // (the phone legend placement is applied for every chart in plot())
  plot(div, traces, layout);
}

function plotWhp(div, xTitle, whp, thp) {
  const traces = [
    { x: whp.map((p) => p.q), y: whp.map((p) => p.whpPsi), name: 'Available WHP', mode: 'lines+markers', line: { color: '#2C7048', width: 3 } },
    { x: [whp[0]?.q, whp[whp.length - 1]?.q], y: [thp, thp], name: 'Operating THP', mode: 'lines', line: { color: '#888', dash: 'dash' } },
  ];
  const hasWht = whp.some((p) => p.whtF != null);
  if (hasWht) {
    traces.push({
      x: whp.map((p) => p.q), y: whp.map((p) => p.whtF), name: 'WHT (calc)', yaxis: 'y2',
      mode: 'lines+markers', line: { color: '#C2540B', width: 2, dash: 'dot' }, marker: { size: 5 },
    });
  }
  const base = LAYOUT();
  plot(
    div,
    traces,
    {
      ...base,
      margin: { ...base.margin, r: window.innerWidth < 640 ? 40 : 55 },
      title: hasWht ? 'Wellhead PQ & calculated WHT' : 'Wellhead PQ curve (WHP = IPR − VLP + THP)',
      xaxis: { title: xTitle },
      // display-only: pressure axis starts at zero (negative WHP region
      // beyond die-out is clipped on the chart; tables keep full values)
      yaxis: {
        title: 'WHP, psi',
        range: [0, Math.max(...whp.map((p) => p.whpPsi), thp) * 1.05],
      },
      yaxis2: { title: 'WHT, °F', overlaying: 'y', side: 'right', showgrid: false, titlefont: { color: '#C2540B' }, tickfont: { color: '#C2540B' } },
    });
}

// ---------- actions ----------

function oilLiftType() {
  return document.querySelector('input[name="oil-lift"]:checked').value;
}

// ---- optional multi-layer IPR (oil & gas well models) ----
const mlMode = (prefix) =>
  document.querySelector(`input[name="${prefix}-mlmode"]:checked`)?.value ?? 'single';

function switchMl(prefix) {
  document.getElementById(`${prefix}-ml`).style.display =
    mlMode(prefix) === 'multi' ? '' : 'none';
}

/** Active VLP sensitivity columns for each tab (lift/well-type aware). */
const oilSensCols = () => OIL_SENS_SETS[oilLiftType()] ?? OIL_SENS_SETS.natural;
const waterSensCols = () =>
  waterWellType() === 'injector'
    ? WATER_SENS_SETS.injector
    : WATER_SENS_SETS[waterLiftType()] ?? WATER_SENS_SETS.natural;
const waterSensRows = () =>
  waterWellType() === 'injector' ? WATER_INJ_SENS_ROWS : WATER_SENS_ROWS;

function refreshOilSens() {
  renderSensTable('oil-sens-table', 'oil', oilSensCols(), OIL_SENS_ROWS);
}
let waterSensType = null; // 'producer' | 'injector' — row MEANING, not just columns
function refreshWaterSens() {
  const type = waterWellType();
  const inj = type === 'injector';
  const typeChanged = waterSensType !== null && waterSensType !== type;
  waterSensType = type;
  renderSensTable('water-sens-table', 'water', waterSensCols(), waterSensRows(),
    inj ? { thpPsi: SENS_LABELS.__injThpPsi } : {}, typeChanged);
}

const iprBasisOf = (p) => document.querySelector(`input[name="${p}-iprbasis"]:checked`)?.value ?? 'darcy';
const oilIprBasis = () => iprBasisOf('oil');

function switchIprBasisFor(prefix) {
  const pi = iprBasisOf(prefix) === 'pi';
  const jRow = document.getElementById(`${prefix}-userJ`)?.closest('.frow');
  if (jRow) jRow.style.display = pi ? '' : 'none';
  const kEl = document.getElementById(`${prefix}-permMd`);
  const kLab = kEl?.closest('.frow')?.querySelector('label');
  if (kLab) kLab.firstChild.textContent = pi ? 'Matched K (from PI)' : 'Permeability K';
  // in PI mode K is DERIVED — clear a typed value so the next solve fills it grey
  if (pi && kEl && kEl.dataset.computed !== '1') kEl.value = '';
  const note = document.getElementById(`${prefix}-ipr-note`);
  if (note)
    note.textContent = pi
      ? (prefix === 'water'
          ? 'J is your input on the linear water IPR (Pb = 0); K is back-matched so J(Darcy) = PI (grey = derived). H/Re/Rw/skin optional.'
          : 'ESP workbook route: J is your input; K is back-matched so J(Darcy) = PI at your skin (grey = derived). H/Re/Rw/skin optional.')
      : 'Darcy from reservoir properties is the main J; the test block calibrates K against a production test.';
}
const switchOilIprBasis = () => switchIprBasisFor('oil');
const switchWaterIprBasis = () => switchIprBasisFor('water');

/** Grey-fill the matched K when the PI basis derived it. */
function showMatchedK(prefix, k) {
  if (iprBasisOf(prefix) !== 'pi' || k == null) return;
  const el = document.getElementById(`${prefix}-permMd`);
  if (!el) return;
  el.value = Number(k).toFixed(2);
  el.dataset.computed = '1';
  el.classList.add('computed');
}

/** The form equals one of the pristine lift cases? (grey cells count as
 *  untouched — the program filled them). */
function oilPristineCase() {
  outer: for (const [name, c] of Object.entries(OIL_LIFT_CASES)) {
    for (const [k, v] of Object.entries(c)) {
      if (k === 'iprBasis') { if (oilIprBasis() !== v) continue outer; continue; }
      const el = document.getElementById('oil-' + k);
      if (!el) continue;
      if (el.dataset.computed === '1') continue;
      if (el.value.trim() !== String(v)) continue outer;
    }
    return name;
  }
  return null;
}

function applyOilLiftCase(name) {
  const c = OIL_LIFT_CASES[name];
  if (!c) return;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'iprBasis') {
      const r = document.querySelector(`input[name="oil-iprbasis"][value="${v}"]`);
      if (r) r.checked = true;
      continue;
    }
    const el = document.getElementById('oil-' + k);
    if (!el) continue;
    el.value = String(v);
    delete el.dataset.computed;
    el.classList.remove('computed');
  }
  switchOilIprBasis();
  switchWaterIprBasis();
}

function switchLift() {
  const t = oilLiftType();
  document.getElementById('oil-lift-gl').style.display = t === 'gaslift' ? '' : 'none';
  document.getElementById('oil-lift-esp').style.display = t === 'esp' ? '' : 'none';
  applyOilRows();
  refreshOilSens();
  // each lift type is a different source workbook — load its live case, but
  // only while the form still equals a pristine case (never clobber typing)
  const pristine = oilPristineCase();
  if (OIL_LIFT_CASES[t] && pristine && pristine !== t) applyOilLiftCase(t);
}

// ---- ESP pump selection: database (background) | custom (add new) | manual ----
const pumpModeOf = (prefix) => {
  const v = document.getElementById(`${prefix}-espPumpSel`)?.value ?? '__manual';
  return v === '__manual' ? 'manual' : v === '__custom' ? 'custom' : 'db';
};
const espPumpMode = () => pumpModeOf('oil');

function switchEspPump() {
  // manual dP has no Sensitivity view — applyOilRows accounts for that
  const mode = espPumpMode();
  document.getElementById('oil-esp-custom').style.display = mode === 'custom' ? '' : 'none';
  document.getElementById('oil-esp-manual').style.display = mode === 'manual' ? '' : 'none';
  document.getElementById('oil-esp-matchrow').style.display = mode === 'manual' ? 'none' : '';
  applyOilRows();
}

/** Water tab: the same catalog, minus the custom-curve builder. */
function switchWaterEspPump() {
  const mode = pumpModeOf('water');
  document.getElementById('water-esp-custom').style.display = mode === 'custom' ? '' : 'none';
  document.getElementById('water-esp-manual').style.display = mode === 'manual' ? '' : 'none';
  document.getElementById('water-esp-matchrow').style.display = mode === 'manual' ? 'none' : '';
  // stages/wear only mean something against a pump curve
  for (const id of ['water-espStages', 'water-espWearFactor']) {
    const row = document.getElementById(id)?.closest('.frow');
    if (row) row.style.display = mode === 'manual' ? 'none' : '';
  }
  refreshWaterSens();
}

// ---- ESP view: Model match (final charts) | Sensitivity (Pres cases) ----

const espTab = () => document.querySelector('input[name="oil-esptab"]:checked')?.value ?? 'match';

function switchEspTab() {
  const sens = espTab() === 'sens';
  document.getElementById('oil-espsens-inputs').style.display = sens ? '' : 'none';
  applyOilRows();
}

/** Fill the oil and water pump selectors. BOTH tabs read the SAME catalogues:
 *  a pump curve is fluid-blind, so the original workbook set serves oil ESP and
 *  water ESP alike, and every added vendor catalogue appears on both. Manual ΔP
 *  and Custom pump stay at the top of the list, before any catalogue, because
 *  they are not catalogue entries and must not scroll away behind one. */
async function loadEspPumps() {
  const oil = document.getElementById('oil-espPumpSel');
  const water = document.getElementById('water-espPumpSel');
  oil.innerHTML =
    '<option value="__manual">Manual ΔP (no pump model)</option>' +
    '<option value="__custom">Custom pump (add new)…</option>';
  if (water) water.innerHTML = '<option value="__manual">Manual ΔP (no pump model)</option>' + '<option value="__custom">Custom pump (add new)…</option>';
  try {
    const r = await api('esp/pumps', {});
    // Group by catalogue. A pump recovered from a vendor PDF is not the same
    // kind of number as one transcribed from the workbook, and the person
    // picking it should be able to see which they are choosing.
    const LABEL = {
      workbook: 'Original catalogue (oil + water ESP)',
      'borets-2015': 'Borets 2015 catalogue (from vendor curves, ~3% on head)',
    };
    const groups = r.bySource ?? [{ source: 'workbook', pumps: r.pumps }];
    for (const g of groups) {
      for (const sel of [oil, water]) {
        if (!sel) continue;
        const grp = document.createElement('optgroup');
        grp.label = LABEL[g.source] ?? g.source;
        for (const name of g.pumps) {
          const o = document.createElement('option');
          o.value = name;
          o.textContent = name;
          grp.appendChild(o);
        }
        sel.appendChild(grp);
      }
    }
    oil.value = 'ESP B 538-3600'; // demo default from the workbook
    if (water) water.value = 'ESP B 538-3600';
  } catch {
    oil.value = '__manual';
    if (water) water.value = '__manual';
  }
  switchEspPump();
  switchWaterEspPump();
}

// ---- Water Well tab: the oil marches at their limiting case (API 10,
// w.c. 100, GOR 0) with its own panel — rates are gross water ----
const waterLiftType = () => document.querySelector('input[name="water-lift"]:checked')?.value ?? 'natural';

function switchWaterLift() {
  const t = waterLiftType();
  document.getElementById('water-lift-gl').style.display = t === 'gaslift' ? '' : 'none';
  document.getElementById('water-lift-esp').style.display = t === 'esp' ? '' : 'none';
  // the ESP chart rows belong to the ESP lift only — stale ones would
  // otherwise linger after switching back to natural flow
  if (t !== 'esp')
    for (const id of ['water-cr-esppump', 'water-cr-esptrav', 'water-cr-senspump', 'water-cr-senstrav'])
      document.getElementById(id).style.display = 'none';
  refreshWaterSens();
}

const waterWellType = () => document.querySelector('input[name="water-welltype"]:checked')?.value ?? 'producer';

function waterForm() {
  const f = collect('water', WATER_SCHEMA, [
    ...WATER_IPR_COMMON_FIELDS,
    ...WATER_IPR_DARCY_FIELDS,
    ...WATER_TEST_FIELDS,
    ...OIL_GL_FIELDS,
    ...OIL_GL_WELL_FIELDS,
    ...WATER_ESP_FIELDS,
    ...WATER_ESP_MANUAL_FIELDS,
  ]);
  f.iprBasis = iprBasisOf('water');
  f.liftType = waterWellType() === 'injector' ? 'natural' : waterLiftType();
  f.fluid = 'water';
  // the shared ESP database drives the water tab too; water is gas-free, so
  // the separator has nothing to separate
  f.espPumpMode = pumpModeOf('water');
  f.espPumpName = document.getElementById('water-espPumpSel')?.value ?? '';
  f.espCurve = collectGrid('water-espcurve', ESP_CURVE_COLS, ESP_CURVE_ROWS.length);
  f.espRefFreqHz = document.getElementById('water-espRefFreqHz')?.value ?? '';
  f.espSepEffPct = 0;
  // the water-well limits (the server enforces the same set)
  f.api = 10; f.wcPct = 100; f.gorScfStb = 0; f.rsiScfStb = 0; f.pbPsi = 0;
  return f;
}

// producer | injector selection: the injector hides lift and sensitivities
// (injection has no artificial lift; injectivity replaces the IPR curve)
/** An injector has no artificial lift and no pump: the gas-lift, ESP
 *  pump-curve, traverse and ESP-sensitivity rows belong to the producer.
 *  Hide AND purge them so a previous producer run cannot linger in the
 *  injector's results. */
const WATER_PRODUCER_ONLY_ROWS = [
  'water-cr-gl', 'water-cr-esppump', 'water-cr-esptrav',
  'water-cr-senspump', 'water-cr-senstrav',
];
// injector-only rows, cleared when a producer is selected
const WATER_INJECTOR_ONLY_ROWS = ['water-cr-injgrid'];
/** Wipe every water result — used when the well TYPE changes, because
 *  the shared rows (nodal, wellhead) then mean something different. */
function clearWaterResults() {
  for (const id of WATER_INJECTOR_ONLY_ROWS) {
    const row = document.getElementById(id);
    if (row) row.style.display = 'none';
  }
  document.getElementById('water-summary').innerHTML = '';
  document.querySelectorAll('#panel-water .results .chart').forEach((c) => {
    if (c.data) Plotly.purge(c);
  });
  document.querySelectorAll('#panel-water .results .datatable').forEach((t) => {
    t.innerHTML = '';
  });
  clearWaterProducerResults();
}

function clearWaterProducerResults() {
  for (const id of WATER_PRODUCER_ONLY_ROWS) {
    const row = document.getElementById(id);
    if (!row) continue;
    row.style.display = 'none';
    row.querySelectorAll('.chart').forEach((c) => {
      if (c.data) Plotly.purge(c);
    });
    row.querySelectorAll('.datatable').forEach((t) => {
      t.innerHTML = '';
    });
  }
}

/** Water sensitivity pressures default to 0.75 / 0.5 / 0.25 x Pri (the
 *  same fractions the oil and gas tabs use). Refilled from the CURRENT Pr
 *  unless the user has typed something of their own. */
function refreshWaterPresDefaults() {
  refreshPresDefaults('water');
}

function switchWaterType() {
  const inj = waterWellType() === 'injector';
  document.getElementById('water-lift-fieldset').style.display = inj ? 'none' : '';
  document.getElementById('water-lift-gl').style.display = inj ? 'none' : '';
  document.getElementById('water-lift-esp').style.display = inj ? 'none' : '';
  // the injector has its own VLP sensitivities (THP / inj water temp / tubing)
  document.getElementById('water-sens-fieldset').style.display = '';
  const sh = document.getElementById('water-sens-head');
  if (sh) sh.textContent = inj
    ? 'VLP parameter sets — available BHIP families (blank = base value)'
    : 'VLP parameter sets (blank = base value)';
  const ph = document.getElementById('water-pres-head');
  if (ph) ph.textContent = inj
    ? 'Future reservoir pressures, psi (injectivity line; J constant)'
    : 'Future reservoir pressures, psi (J constant — water μ·B do not change)';
  clearWaterResults();
  refreshWaterPresDefaults();
  if (!inj) switchWaterLift();
  refreshWaterSens();
  const row = document.getElementById('water-injTempF')?.closest('.frow');
  if (row) row.style.display = inj ? '' : 'none';
  const relabel = (id, txt) => {
    const l = document.getElementById(id)?.closest('.frow')?.querySelector('label');
    if (l) l.textContent = txt;
  };
  relabel('water-thpPsi', inj ? 'Injection THP' : 'FTHP');
  // per-type THP default: producer 200 psi, injector 2000 psi — swap only
  // while the field still holds the other type's default (user values kept)
  for (const id of ['water-thpPsi', 'water-testThpPsi']) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (inj && el.value.trim() === '200') el.value = '2000';
    if (!inj && el.value.trim() === '2000') el.value = '200';
  }
  relabel('water-testQOilStbD', inj ? 'Test injection rate' : 'Test water rate');
  relabel('water-testThpPsi', inj ? 'Test injection THP' : 'Test FTHP');
  relabel('water-testPwfPsi', inj ? 'Test BHIP (blank = march)' : 'Test Pwf (blank = get Pwf)');
}

function oilForm() {
  const f = collect('oil', OIL_SCHEMA, [
    ...OIL_IPR_COMMON_FIELDS,
    ...OIL_IPR_DARCY_FIELDS,
    ...OIL_TEST_FIELDS,
    ...OIL_GL_FIELDS,
    ...OIL_GL_WELL_FIELDS,
    ...OIL_ESP_FIELDS,
    ...OIL_ESP_CUSTOM_FIELDS,
    ...OIL_ESP_MANUAL_FIELDS,
    ...OIL_RLT_FIELDS,
    ...OIL_FC_FIELDS,
  ]);
  f.liftType = oilLiftType();
  f.espPumpMode = espPumpMode();
  f.espPumpName = document.getElementById('oil-espPumpSel')?.value ?? '';
  f.espCurve = collectGrid('oil-espcurve', ESP_CURVE_COLS, ESP_CURVE_ROWS.length);
  f.presSource = document.querySelector('input[name="oil-pressource"]:checked')?.value ?? 'prod';
  f.pwfMode = document.querySelector('input[name="oil-pwfmode"]:checked')?.value ?? 'vlp';
  f.fcMethod = document.querySelector('input[name="oil-fcmethod"]:checked')?.value ?? 'tarner';
  f.iprBasis = oilIprBasis();
  f.mlMode = mlMode('oil');
  f.mlLayers = collectGrid('oil-ml', OIL_ML_COLS, OIL_ML_ROWS.length);
  f.prodRows = collectGrid('oil-prod', OIL_PROD_COLS, oilProdCount);
  f.staticRows = collectGrid('oil-static', OIL_STATIC_COLS, oilStaticTable.count());
  return f;
}

// the three oil reserve methods legitimately differ — the user judges each
// by the quality of ITS inputs; cross-method agreement is the QC signal
const OIL_RESERVE_GUIDANCE = {
  prod: 'Best practice: regular flowing data with reliable rate/THP/GOR/WC records and a MATCHED well model (calibrate Darcy first). ' +
    'Limitations: Pres inherits any VLP-match or J error (drawdown maps into pr); result is a MINIMUM connected STOIIP that grows as depletion data accumulates.',
  static: 'Best practice: measured static pressures from memory-gauge surveys — the strongest data, independent of IPR/VLP matching; Np/Gp come from the prod-data cumulative. ' +
    'Limitations: needs true stabilized build-ups at gauge datum; rate/GOR records still set Np/Gp accuracy.',
  rlt: 'Best practice: a clean EARLY constant-rate drawdown in pseudo-steady state; quick minimum-volume screen. ' +
    'Limitations: assumes pss and constant Ct over the window; sensitive to Ct and to rate variations; differs from the material-balance methods by design.',
};

/**
 * Oil chart rows are a pure function of (module, lift, pump mode, ESP view).
 * Every switch calls this instead of setting rows itself — the scattered
 * version left rows stranded whenever two switches disagreed.
 * Rows whose CONTENT is drawn conditionally (gas-lift/pump-curve, traverses)
 * are only ever HIDDEN here; the drawing code reveals them once it fills them.
 */
function applyOilRows() {
  const m = document.querySelector('input[name="oil-module"]:checked')?.value ?? 'well';
  const lift = oilLiftType();
  const well = m === 'well';
  const espView = well && lift === 'esp' && espPumpMode() !== 'manual' && espTab() === 'sens';
  const set = (id, show) => {
    const e = document.getElementById(id);
    if (e) e.style.display = show ? '' : 'none';
  };
  set('oil-summary', well);
  set('oil-cr-nodal', well && !espView);
  set('oil-cr-whp', well && !espView);
  set('oil-cr-sens', well);
  set('oil-cr-espsens', espView);
  set('oil-cr-rsv1', m === 'reserve');
  set('oil-cr-rsv2', m === 'reserve');
  set('oil-cr-fc', m === 'forecast');
  // conditionally-drawn rows: hide when they cannot apply, never force-show
  // the gas-lift row is shared with the ESP pump curve: it belongs to those
  // two lifts, and must be SHOWN again when one of them comes back
  set('oil-cr-gl', well && !espView && lift !== 'natural');
  if (!well || espView || lift !== 'esp') set('oil-cr-esptrav', false);
  if (!well || lift !== 'esp') {
    set('oil-cr-senspump', false);
    set('oil-cr-senstrav', false);
  }
  resizeVisibleCharts();
}

function switchOilModule() {
  const m = document.querySelector('input[name="oil-module"]:checked').value;
  document.getElementById('oil-mod-well').style.display = m === 'well' ? '' : 'none';
  document.getElementById('oil-mod-reserve').style.display = m === 'reserve' ? '' : 'none';
  document.getElementById('oil-mod-forecast').style.display = m === 'forecast' ? '' : 'none';
  document.getElementById('panel-oil').classList.toggle('mode-reserve', m === 'reserve');
  applyOilRows();
  resizeVisibleCharts();
}

async function oilForecastRun() {
  const r = await api('oil/forecast', oilForm());
  document.getElementById('oil-fc-result').textContent =
    `${r.method === 'walsh' ? 'Walsh (generalized MB, Rv)' : 'Tarner'}: EUR = ${fmt(r.eurMMstb, 2)} MMstb (${fmt(r.recoveryPct, 1)}% of N ${fmt(r.nMMstb, 1)}), status: ${r.status}\n` +
    (r.method === 'walsh'
      ? `J (constant PI) = ${fmt(r.j, 3)}. `
      : `J1 (mobility PI) = ${fmt(r.j1, 3)}. `) +
    `Start: Np ${fmt(r.startNpMMstb, 3)} MMstb, Pres ${fmt(r.startPresPsi, 0)} psi, THP ${fmt(r.forecastFthpPsi, 0)} psi, W.C ${fmt(r.fcWcPct, 1)}%, GOR ${fmt(r.fcGorScfStb, 0)} scf/stb.`;
  setComputed('oil-nMMstb', r.nMMstb, 2);
  setComputed('oil-startNpMMstb', r.startNpMMstb, 3);
  setComputed('oil-startPresPsi', r.startPresPsi, 1);
  setComputed('oil-startDate', dayToDateStr(r.startDay) ?? r.startDay, 'str');
  setComputed('oil-forecastFthpPsi', r.forecastFthpPsi, 0);
  setComputed('oil-fcWcPct', r.fcWcPct, 1);
  setComputed('oil-fcGorScfStb', r.fcGorScfStb, 0);
  const hist = r.history ?? [];
  const all = [...hist.map((p) => p.tDays), ...r.rows.map((p) => p.tDays)];
  const useDates = all.length > 0 && all.every((t) => dayToDateStr(t) != null);
  const t0 = all.length ? all[0] : 0;
  const ax = (t) => (useDates ? dayToDateStr(t) : t - t0);
  const traces = [];
  if (hist.length) {
    traces.push(
      { x: hist.map((p) => ax(p.tDays)), y: hist.map((p) => p.qOilStbD), name: 'Rate (history)', mode: 'lines+markers', line: { color: '#2C7048', width: 2 } },
      { x: hist.map((p) => ax(p.tDays)), y: hist.map((p) => p.presPsi), name: 'Pres (history)', yaxis: 'y2', mode: 'lines+markers', line: { color: '#00636D', width: 2 } }
    );
  }
  traces.push(
    { x: r.rows.map((p) => ax(p.tDays)), y: r.rows.map((p) => p.qOilStbD), name: 'F Rate', mode: 'lines', line: { color: '#2C7048', width: 3, dash: 'dash' } },
    { x: r.rows.map((p) => ax(p.tDays)), y: r.rows.map((p) => p.presPsi), name: 'F Pres', yaxis: 'y2', mode: 'lines', line: { color: '#00636D', width: 2, dash: 'dot' } },
    { x: r.rows.map((p) => ax(p.tDays)), y: r.rows.map((p) => p.gorScfStb), name: 'F GOR scf/stb', mode: 'lines', line: { color: '#C2540B', width: 2, dash: 'dash' } }
  );
  plot('oil-chart-fc', traces, {
    ...LAYOUT(),
    margin: { ...LAYOUT().margin, r: window.innerWidth < 640 ? 40 : 55 },
    title: `${r.method === 'walsh' ? 'Walsh' : 'Tarner'} forecast — history + forecast`,
    xaxis: { title: useDates ? 'Date' : 'Time, days' },
    yaxis: { title: 'Rate stb/d · GOR scf/stb', rangemode: 'tozero' },
    yaxis2: { title: 'Pres, psi', overlaying: 'y', side: 'right', showgrid: false, titlefont: { color: '#00636D' }, tickfont: { color: '#00636D' } },
  });
  mobileShowResults();
  renderTables('oil-table-fc', [
    {
      title: `${r.method === 'walsh' ? 'Walsh' : 'Tarner'} forecast (first row = start)`, headers: ['date', 'q stb/d', 'Pres', 'Pwf', 'GOR', 'Np MMstb', 'Gp Bscf', 'So', 'Sg'],
      rows: r.rows.map((p) => [
        useDates ? dayToDateStr(p.tDays) : fmt(p.dtDays, 0),
        fmt(p.qOilStbD, 0), fmt(p.presPsi, 0), fmt(p.pwfPsi, 0), fmt(p.gorScfStb, 0),
        fmt(p.npMMstb, 3), fmt(p.gpBscf, 3), fmt(p.soFrac, 3), fmt(p.sgFrac, 3),
      ]),
    },
  ]);
}

function switchOilPresSource() {
  const s = document.querySelector('input[name="oil-pressource"]:checked').value;
  // static selection shows only the survey table; Np/Gp still come from the
  // (hidden) prod data table's cumulative
  document.getElementById('oil-rsv-prod').style.display = s === 'static' ? 'none' : '';
  document.getElementById('oil-rsv-static').style.display = s === 'static' ? '' : 'none';
  document.getElementById('oil-rsv-rlt').style.display = s === 'rlt' ? '' : 'none';
  document.getElementById('oil-rsv-prod').classList.toggle('rlt-slim', s === 'rlt');
  document.getElementById('oil-rsv-guidance').textContent = OIL_RESERVE_GUIDANCE[s] ?? '';
  document.getElementById('oil-stoiip-banner').innerHTML = ''; // avoid stale result on switch
}

function oilProdValidIdx() {
  const idx = [];
  for (let i = 0; i < oilProdCount; i++) {
    if (val(`oil-prod-${i}-date`) !== '' && val(`oil-prod-${i}-qOilStbD`) !== '') idx.push(i);
  }
  return idx;
}

async function oilReserveRun() {
  const r = await api('oil/reserve', oilForm());
  const banner = document.getElementById('oil-stoiip-banner');
  const note = document.getElementById('oil-reserve-result');

  if (r.mode === 'static') {
    // fill the survey table's output columns
    const sIdx = [];
    for (let i = 0; i < oilStaticTable.count(); i++) {
      if (val(`oil-static-${i}-date`) !== '' && val(`oil-static-${i}-presPsi`) !== '') sIdx.push(i);
    }
    r.rows.forEach((row, k) => {
      const i = sIdx[k];
      if (i == null) return;
      setOut(`oil-static-${i}-dtDays`, row.dtDays, 2);
      setOut(`oil-static-${i}-npMMstb`, row.npMMstb, 3);
      setOut(`oil-static-${i}-gpBscf`, row.gpBscf, 3);
      setOut(`oil-static-${i}-nMMstb`, row.nMMstb, 1);
    });
  } else {
    // fill the prod_data output columns and the Pwf input-or-calc cells
    const idx = oilProdValidIdx();
    r.rows.forEach((row, k) => {
      const i = idx[k];
      if (i == null) return;
      if (row.pwfSource === 'calculated') setComputed(`oil-prod-${i}-pwfPsi`, row.pwfPsi, 1);
      setOut(`oil-prod-${i}-dtDays`, row.dtDays, 2);
      setOut(`oil-prod-${i}-presPsi`, row.presPsi, 1);
      setOut(`oil-prod-${i}-z`, row.z, 4);
    });
  }

  const methodName =
    r.mode === 'static' ? 'MB on measured Pres history'
    : r.mode === 'rlt' ? 'Reservoir limit'
    : 'Havlena–Odeh MB, prod data';

  if (r.mode === 'rlt') {
    setComputed('oil-rltCg', r.rlt.cg, 'exp');
    note.textContent =
      `m = ${fmt(r.rlt.slopePsiDay, 3)} psi/day, Cg = ${r.rlt.cg.toExponential(3)}, Ct = ${r.rlt.ct.toExponential(3)} 1/psi, ` +
      `q̄ = ${fmt(r.rlt.qAvgStbD, 0)} stb/d.` + (r.rlt.warning ? `\n${r.rlt.warning}` : '');
    banner.innerHTML =
      r.rlt.stoiipMMstb != null
        ? `<span class="method">STOIP — minimum connected (${methodName})</span><span class="val">${fmt(r.rlt.stoiipMMstb, 1)} MMstb</span>`
        : `<span class="method">STOIP (${methodName})</span><span class="val warn">no depletion signal</span>`;
    if (r.rlt.stoiipMMstb != null) setHeadline(`${fmt(r.rlt.stoiipMMstb, 1)} MMstb`, 'STOIP min connected');
    mobileShowResults();
    // Pwf decline + slope line
    const tMax = Math.max(...r.rows.map((p) => p.dtDays));
    const pwf0 = r.rows[0].pwfPsi;
    plot('oil-chart-rsv1', [
      { x: r.rows.map((p) => p.dtDays), y: r.rows.map((p) => p.pwfPsi), name: 'Pwf', mode: 'markers', marker: { color: '#0B1418', size: 8 } },
      { x: [0, tMax], y: [pwf0, pwf0 - r.rlt.slopePsiDay * tMax], name: `slope m = ${fmt(r.rlt.slopePsiDay, 3)} psi/d`, mode: 'lines', line: { color: '#A93A2C', width: 2, dash: 'dash' } },
    ], { ...LAYOUT(), title: 'Reservoir limit — Pwf decline', xaxis: { title: 'dt, days' }, yaxis: { title: 'Pwf, psi' } });
    renderTables('oil-table-rsv1', [{
      title: 'Solved rows', headers: ['dt d', 'q stb/d', 'Pwf', 'pr', 'z'],
      rows: r.rows.map((p) => [fmt(p.dtDays, 1), fmt(p.qOilStbD, 0), fmt(p.pwfPsi, 0), fmt(p.presPsi, 0), fmt(p.z, 3)]),
    }]);
    Plotly.purge('oil-chart-rsv2');
    document.getElementById('oil-table-rsv2').innerHTML = '';
    return;
  }

  // MB modes: F vs Eo crossplot (slope N) + N vs Np stabilization
  const fit = r.fit;
  note.textContent =
    (fit.nAvgMMstb != null
      ? `N (average of F/Eo) = ${fmt(fit.nAvgMMstb, 1)} MMstb; N (slope of F vs Eo) = ${fmt(fit.nSlopeMMstb, 1)} MMstb. ` +
        `A wide gap between the two flags unstabilized data.`
      : '') + (fit.warning ? `\n${fit.warning}` : '');
  banner.innerHTML =
    fit.nAvgMMstb != null
      ? `<span class="method">STOIIP — minimum connected (${methodName})</span><span class="val">${fmt(fit.nAvgMMstb, 1)} MMstb</span>`
      : `<span class="method">STOIIP (${methodName})</span><span class="val warn">no depletion signal</span>`;
  if (fit.nAvgMMstb != null) setHeadline(`${fmt(fit.nAvgMMstb, 1)} MMstb`, 'STOIIP min connected');
  mobileShowResults();

  const mb = r.rows.filter((p) => p.npMMstb > 0);
  const eoMax = Math.max(0, ...mb.map((p) => p.eo));
  plot('oil-chart-rsv1', [
    { x: mb.map((p) => p.eo), y: mb.map((p) => p.fMMbbl), name: 'F vs Eo', mode: 'markers', marker: { color: '#0B1418', size: 8 } },
    ...(fit.nSlopeMMstb != null
      ? [{ x: [0, eoMax], y: [0, fit.nSlopeMMstb * eoMax], name: `slope N = ${fmt(fit.nSlopeMMstb, 1)} MMstb`, mode: 'lines', line: { color: '#A93A2C', width: 2, dash: 'dash' } }]
      : []),
  ], { ...LAYOUT(), title: 'Havlena–Odeh — F vs Eo', xaxis: { title: 'Eo, bbl/stb' }, yaxis: { title: 'F, MMbbl' } });

  const nPts = mb.filter((p) => p.nMMstb != null);
  plot('oil-chart-rsv2', [
    { x: nPts.map((p) => p.npMMstb), y: nPts.map((p) => p.nMMstb), name: 'N per row', mode: 'lines+markers', marker: { color: '#2C7048', size: 8 }, line: { color: '#2C7048', width: 1 } },
    ...(fit.nAvgMMstb != null
      ? [{ x: [0, Math.max(...nPts.map((p) => p.npMMstb), 0.001)], y: [fit.nAvgMMstb, fit.nAvgMMstb], name: `average N = ${fmt(fit.nAvgMMstb, 1)}`, mode: 'lines', line: { color: '#C2540B', width: 2, dash: 'dash' } }]
      : []),
  ], { ...LAYOUT(), title: 'N vs Np — does the estimate stabilize?', xaxis: { title: 'Np, MMstb' }, yaxis: { title: 'N, MMstb' } });

  renderTables('oil-table-rsv1', [{
    title: 'Material balance', headers: ['dt d', 'pr psi', 'Np MMstb', 'F MMbbl', 'Eo', 'N MMstb'],
    rows: mb.map((p) => [fmt(p.dtDays, 1), fmt(p.presPsi, 0), fmt(p.npMMstb, 3), fmt(p.fMMbbl, 4), p.eo.toExponential(3), p.nMMstb != null ? fmt(p.nMMstb, 1) : '']),
  }]);
  renderTables('oil-table-rsv2', [{
    title: 'PVT at pr', headers: ['pr psi', 'z', 'Rs', 'Bo', 'Bg bbl/scf'],
    rows: r.rows.map((p) => [fmt(p.presPsi, 0), fmt(p.z, 3), fmt(p.rsScfStb, 0), fmt(p.bo, 4), p.bgBblScf.toExponential(3)]),
  }]);
}

async function liquidGl(c) {
  const r = await api('oil/gaslift', c.form());
  const ok = r.points.filter((p) => p.status === 'ok');
  const dead = r.points.filter((p) => p.status !== 'ok');
  const traces = [
    { x: ok.map((p) => p.injRateMMscfd), y: ok.map((p) => p.qOilStbD), name: `Operating ${c.fluidName} rate`, mode: 'lines+markers', line: { color: '#2C7048', width: 3 } },
  ];
  if (r.optimum) {
    traces.push({
      x: [r.optimum.injRateMMscfd], y: [r.optimum.qOilStbD], name: 'Optimum', mode: 'markers',
      marker: { symbol: 'star', size: 16, color: '#C2540B', line: { width: 1, color: '#93400A' } },
    });
  }
  plot(`${c.prefix}-chart-gl`, traces, {
    ...LAYOUT(),
    title: `Gas-lift performance — ${c.fluidName} rate vs injection`,
    xaxis: { title: 'Injection rate, MMscf/d' },
    yaxis: { title: `${c.fluidName[0].toUpperCase() + c.fluidName.slice(1)} rate, bbl/d` },
  });
  const inc = r.incremental[r.incremental.length - 1];
  document.getElementById(`${c.prefix}-gl-result`).textContent =
    (r.optimum
      ? `Optimum: ${fmt(r.optimum.qOilStbD, 0)} bbl/d at ${fmt(r.optimum.injRateMMscfd, 2)} MMscf/d (Pwf ${fmt(r.optimum.pwfPsi, 0)} psi)\n`
      : 'No flowing point in the sweep.\n') +
    (dead.length ? `${dead.length} injection point(s) below kick-off (well dead there).\n` : '') +
    (inc ? `Incremental response at max injection: ${fmt(inc.dQdInjStbPerMMscf, 0)} bbl/d per MMscf/d.` : '');
  renderTables(`${c.prefix}-table-gl`, [
    {
      title: 'GL performance', headers: ['inj MMscf/d', `q ${c.fluidName}`, 'Pwf psi'],
      rows: r.points.map((p) => [fmt(p.injRateMMscfd, 2), p.status === 'ok' ? fmt(p.qOilStbD, 0) : p.status, p.status === 'ok' ? fmt(p.pwfPsi, 1) : '—']),
    },
  ]);
}

const oilGl = () => liquidGl(OIL_CTX);
const waterGl = () => liquidGl(WATER_CTX);

// shared oil/water well-model runners — the Water tab reuses the oil
// endpoints (fluid:'water'); c = { prefix, form, fluidName }
async function liquidSolve(c) {
  const r = await api('oil/nodal', c.form());
  const water = c.prefix === 'water';
  const qh = `q ${c.fluidName}`;
  if (r.ipr) showMatchedK(c.prefix, r.ipr.matchedPermMd);
  summary(`${c.prefix}-summary`, [
    { k: 'Operating rate', v: r.op ? `${fmt(r.op.qOilStbD, 0)} ${water ? 'bbl/d' : 'stb/d'}` : r.opStatus, warn: !r.op },
    { k: 'Operating Pwf', v: r.op ? `${fmt(r.op.pwfPsi, 0)} psi` : '—' },
    { k: 'WHT (calc)', v: r.op ? `${fmt(r.op.whtF, 1)} °F` : '—' },
    water ? null : { k: 'Pb', v: `${fmt(r.pbPsi, 0)} psi` },
    r.multiLayer ? null : { k: 'J Darcy (active)', v: fmt(r.ipr.jDarcy, 3) },
    !r.multiLayer && r.ipr.jTest ? { k: 'J Jones', v: fmt(r.ipr.jTest, 3) } : null,
    { k: `AOF (${c.fluidName})`, v: `${fmt(r.aofOilStbD, 0)} ${water ? 'bbl/d' : 'stb/d'}` },
    r.esp ? { k: 'Pump discharge', v: `${fmt(r.esp.dischargePsi, 0)} psi` } : null,
    r.esp ? { k: 'Pump intake', v: `${fmt(r.esp.intakePsi, 0)} psi` } : null,
    r.esp?.pumpName ? { k: `ΔP solved (${r.esp.pumpName})`, v: `${fmt(r.esp.pumpDpPsi, 0)} psi` } : null,
    r.esp?.headFt != null ? { k: 'Head / thrust', v: `${fmt(r.esp.headFt, 0)} ft · ${r.esp.thrust ?? '—'}` } : null,
    r.multiLayer ? { k: 'Pr avg (multi-layer)', v: `${fmt(r.multiLayer.prAvgPsi, 0)} psi` } : null,
    r.multiLayer ? { k: 'J final', v: fmt(r.multiLayer.jFinal, 3) } : null,
    r.multiLayer ? { k: 'Blended WC / GOR', v: `${fmt(r.multiLayer.blended.wcPct, 1)}% / ${fmt(r.multiLayer.blended.gorScfStb, 0)}` } : null,
    r.multiLayer?.layersAtOp?.warnings?.length
      ? { k: 'Crossflow', v: r.multiLayer.layersAtOp.warnings[0], warn: true }
      : null,
  ]);
  const axis = `${c.fluidName[0].toUpperCase() + c.fluidName.slice(1)} rate, ${water ? 'bbl/d' : 'stb/d'}`;
  plotNodal(`${c.prefix}-chart-nodal`, axis, r.iprCurve, r.vlpCurve,
    r.op ? { q: r.op.qOilStbD, pwfPsi: r.op.pwfPsi } : null,
    (p) => p.qOilStbD, (p) => p.q,
    { extra: mlLayerTraces(r, (p) => p.qOilStbD) });
  plotWhp(`${c.prefix}-chart-whp`, axis, r.whpCurve, Number(val(`${c.prefix}-thpPsi`)));
  setComputed(`${c.prefix}-pbPsi`, r.computed.pbPsi, 1);
  setComputed(`${c.prefix}-prPsi`, r.computed.prPsi, 1);
  const nodalTables = [
    {
      title: 'IPR',
      headers: water ? ['Pwf psi', qh] : ['Pwf psi', qh, 'q gross'],
      rows: r.iprCurve.map((p) =>
        water
          ? [fmt(p.pwfPsi, 1), fmt(p.qGrossStbD, 0)]
          : [fmt(p.pwfPsi, 1), fmt(p.qOilStbD, 0), fmt(p.qGrossStbD, 0)]),
    },
    {
      title: 'VLP', headers: [qh, 'Pwf psi'],
      rows: r.vlpCurve.map((p) => [fmt(p.q, 0), fmt(p.pwfPsi, 1)]),
    },
  ];
  if (r.multiLayer?.layersAtOp) {
    const lay = r.multiLayer.layersAtOp.layers;
    const props = r.multiLayer.curves?.layers ?? [];
    const tot = r.multiLayer.layersAtOp.totals;
    // Share is of GROSS, and it is signed: a crossflowing layer takes a
    // negative share, so the column sums to 100% and shows how much of the
    // producing layers' output is being pushed back into the thief zone.
    nodalTables.unshift({
      title: `Layers @ operating Pwf ${r.op ? fmt(r.op.pwfPsi, 0) + ' psi' : ''}`,
      headers: ['layer', 'Pr psi', 'J', 'q gross', 'q oil', 'q water', '% of gross', 'state'],
      rows: lay.map((l, i) => {
        const xflow = l.qGrossStbD < 0;
        const share = tot.qGrossStbD !== 0 ? (l.qGrossStbD / tot.qGrossStbD) * 100 : null;
        return [
          l.name,
          fmt(props[i]?.prPsi, 0),
          fmt(props[i]?.j, 3),
          fmt(l.qGrossStbD, 0),
          fmt(l.qOilStbD, 0),
          fmt(l.qWaterStbD, 0),
          share == null ? '—' : fmt(share, 1),
          xflow ? 'CROSSFLOW — taking fluid in' : 'producing',
        ];
      }),
      rowClass: (row, i) => (lay[i].qGrossStbD < 0 ? 'crossflow' : ''),
    });
  }
  renderTables(`${c.prefix}-table-nodal`, nodalTables);
  renderTables(`${c.prefix}-table-whp`, [
    {
      title: 'Wellhead PQ & WHT', headers: [qh, 'WHP psi', 'WHT °F', 'Pwf IPR', 'Pwf VLP'],
      rows: r.whpCurve.map((p) => [fmt(p.q, 0), fmt(p.whpPsi, 1), fmt(p.whtF, 1), fmt(p.pwfIprPsi, 1), fmt(p.pwfVlpPsi, 1)]),
    },
  ]);
  // water ESP: the pump curve and the traverse come from this same solve
  if (c.prefix === 'water') waterEspCharts(r);
  // ESP-only chart rows: manual-dP ESP shows the traverse (the input dP is
  // merged into the march at the pump depth); natural/gas-lift hide it
  if (c.prefix === 'oil') {
    if (r.espTraverse) {
      const t = r.espTraverse;
      // reveal BEFORE plotting: drawn into a display:none row Plotly falls back
      // to a 700px canvas that then overhangs the container and laps the table
      document.getElementById('oil-cr-esptrav').style.display = '';
      plot('oil-chart-esptrav', [
        { x: t.stations.map((s) => s.pPsi), y: t.stations.map((s) => s.tvdFt), name: 'Traverse top-down', mode: 'lines+markers', line: { color: '#0B1418', width: 2 } },
        { x: t.backStations.map((s) => s.pPsi), y: t.backStations.map((s) => s.tvdFt), name: 'IPR back-calc', mode: 'lines+markers', line: { color: '#2C7048', width: 2, dash: 'dash' } },
        { x: [t.dischargePsi, t.intakePsi], y: [t.pumpTvdFt, t.pumpTvdFt], name: `Pump ΔP ${fmt(t.dpPsi, 0)} psi`, mode: 'lines+markers', line: { color: '#A93A2C', width: 3 }, marker: { size: 8 } },
      ], {
        ...LAYOUT(),
        title: 'Traverse gradient — manual pump ΔP merged at pump depth',
        xaxis: { title: 'Pressure, psi' },
        yaxis: { title: 'Depth TVD, ft', autorange: 'reversed' },
      });
      renderTables('oil-table-esptrav', [{
        title: 'Traverse', headers: ['TVD ft', 'P psi'],
        rows: t.stations.map((s) => [fmt(s.tvdFt, 0), fmt(s.pPsi, 1)]),
      }]);
    } else {
      document.getElementById('oil-cr-esptrav').style.display = 'none';
    }
  }
}

const OIL_CTX = { prefix: 'oil', form: oilForm, fluidName: 'oil' };
const WATER_CTX = { prefix: 'water', form: waterForm, fluidName: 'water' };
const oilSolve = () =>
  oilLiftType() === 'esp' && espPumpMode() !== 'manual' ? espRun() : liquidSolve(OIL_CTX);

// full ESP solve — traverse match at the intake with the coupled pump dP;
// pump curve family + results block shown beside; traverse chart below
async function espRun() {
  const r = await api('oil/esp', oilForm());
  showMatchedK('oil', r.matchedPermMd);
  const op = r.op;
  summary('oil-summary', [
    { k: 'Operating rate', v: `${fmt(op.qOilStbD, 0)} stb/d` },
    { k: 'Pwf (traverse)', v: `${fmt(op.pwfTraversePsi, 0)} psi` },
    { k: 'Pump intake', v: `${fmt(op.pintTraversePsi, 0)} psi` },
    { k: 'Pump discharge', v: `${fmt(op.pdisPsi, 0)} psi` },
    { k: 'Pump ΔP', v: `${fmt(op.dpPsi, 0)} psi` },
    { k: 'Head', v: `${fmt(op.headFt, 0)} ft` },
    { k: 'WHT (calc)', v: `${fmt(op.whtF, 1)} °F` },
    { k: 'Free gas @ intake', v: `${fmt(op.state.freeGasPct, 1)} %`, warn: op.state.sepRequired && (r.opts?.sepEffPct ?? 0) <= 0 },
    { k: 'Thrust', v: op.thrust.status, warn: op.thrust.status !== 'ok' },
    op.designFloor && !op.designFloor.ok
      ? { k: 'Design floor', v: `intake < ${fmt(op.designFloor.minIntakePsi, 0)} psi`, warn: true }
      : null,
  ]);
  // pump curve family + thrust envelope + operating point
  const traces = r.family.map((c) => ({
    x: c.points.map((p) => p.rateBpd), y: c.points.map((p) => p.headFt),
    name: `${c.freqHz} Hz`, mode: 'lines', line: { width: c.freqHz === r.opts.freqHz ? 3 : 1.4 },
  }));
  for (const t of r.thrustLines) {
    traces.push({
      x: t.points.map((p) => p.rateBpd), y: t.points.map((p) => p.headFt),
      name: t.key === 'bep' ? 'BEP' : `${t.key}-thrust`, mode: 'lines',
      line: { color: t.key === 'bep' ? '#2C7048' : '#C2540B', width: 1.5, dash: 'dash' },
    });
  }
  traces.push({
    x: [r.opPoint.rateBpd], y: [r.opPoint.headFt], name: 'Operating point', mode: 'markers',
    marker: { symbol: 'star', size: 16, color: '#A93A2C', line: { width: 1, color: '#7a1f14' } },
  });
  plot('oil-chart-gl', traces, {
    ...LAYOUT(),
    title: `Pump curve — ${r.pump.name}, ${r.opts.stages} stages, wear ${fmt(r.opts.wearFactor, 2)}`,
    xaxis: { title: 'Rate @ pump, bbl/d' },
    yaxis: { title: 'Head, ft', rangemode: 'tozero' },
  });
  // results block shown beside the pump curve: the solved NODE, then the
  // pump's own state at that node (the same parameter set the sensitivity
  // cases report, so the two views are directly comparable)
  renderTables('oil-table-gl', [
    {
      title: 'Solution point', headers: ['item', 'value'],
      rows: [
        ['Qoil surface, stb/d', fmt(op.qOilStbD, 0)],
        ['Qgross surface, bbl/d', fmt(op.qGrossStbD, 0)],
        ['Pwf traverse / IPR, psi', `${fmt(op.pwfTraversePsi, 1)} / ${fmt(op.pwfIprPsi, 1)}`],
        ['Pump intake (traverse), psi', fmt(op.pintTraversePsi, 1)],
        ['Pump intake (IPR), psi', fmt(op.pintIprPsi, 1)],
        ['Pump discharge, psi', fmt(op.pdisPsi, 1)],
        ['WHT (calc), °F', fmt(op.whtF, 1)],
      ],
    },
    { title: 'Pump @ solution point', headers: ['parameter', 'value'], rows: pumpPointRows(r.point) },
  ]);
  // FINAL model-match charts: IPR vs the coupled ESP-VLP + wellhead curve
  plotNodal('oil-chart-nodal', 'Oil rate, stb/d', r.iprCurve, r.vlpCurve,
    { q: op.qOilStbD, pwfPsi: op.pwfTraversePsi },
    (p) => p.qOilStbD, (p) => p.q);
  renderTables('oil-table-nodal', [
    {
      title: 'IPR', headers: ['Pwf psi', 'q oil', 'q gross'],
      rows: r.iprCurve.map((p) => [fmt(p.pwfPsi, 1), fmt(p.qOilStbD, 0), fmt(p.qGrossStbD, 0)]),
    },
    {
      title: 'ESP VLP', headers: ['q oil', 'Pwf psi'],
      rows: r.vlpCurve.map((p) => [fmt(p.q, 0), fmt(p.pwfPsi, 1)]),
    },
  ]);
  plotWhp('oil-chart-whp', 'Oil rate, stb/d', r.whpCurve, Number(val('oil-thpPsi')));
  renderTables('oil-table-whp', [{
    title: 'Wellhead PQ & WHT (ESP)', headers: ['q oil', 'WHP psi', 'WHT °F', 'Pwf IPR', 'Pwf VLP'],
    rows: r.whpCurve.map((p) => [fmt(p.q, 0), fmt(p.whpPsi, 1), fmt(p.whtF, 1), fmt(p.pwfIprPsi, 1), fmt(p.pwfVlpPsi, 1)]),
  }]);
  // traverse on its OWN row (separate from the sensitivity view)
  const tv = [
    { x: op.stations.map((s) => s.pPsi), y: op.stations.map((s) => s.tvdFt), name: 'Traverse top-down', mode: 'lines+markers', line: { color: '#0B1418', width: 2 } },
    { x: op.backStations.map((s) => s.pPsi), y: op.backStations.map((s) => s.tvdFt), name: 'IPR back-calc', mode: 'lines+markers', line: { color: '#2C7048', width: 2, dash: 'dash' } },
  ];
  if (r.measured.pintPsi != null)
    tv.push({ x: [r.measured.pintPsi], y: [r.measured.pumpTvdFt], name: 'Measured Pint', mode: 'markers', marker: { symbol: 'diamond', size: 12, color: '#C2540B' } });
  if (r.measured.pdisPsi != null)
    tv.push({ x: [r.measured.pdisPsi], y: [r.measured.pumpTvdFt], name: 'Measured Pdis', mode: 'markers', marker: { symbol: 'diamond', size: 12, color: '#A93A2C' } });
  document.getElementById('oil-cr-esptrav').style.display = ''; // before plotting — see above
  plot('oil-chart-esptrav', tv, {
    ...LAYOUT(),
    title: 'Traverse gradient — top-down vs IPR back-calc',
    xaxis: { title: 'Pressure, psi' },
    yaxis: { title: 'Depth TVD, ft', autorange: 'reversed' },
  });
  renderTables('oil-table-esptrav', [{
    title: 'Traverse', headers: ['TVD ft', 'P psi'],
    rows: op.stations.map((s) => [fmt(s.tvdFt, 0), fmt(s.pPsi, 1)]),
  }]);
}


async function espSensRun() {
  const body = oilForm();
  body.presList = collectPres('oil-esp', 3);
  const r = await api('oil/espsens', body);
  const phone = window.innerWidth < 640;
  const traces = [];
  // the reference: where the well sits today, drawn like the main sensitivity
  if (r.currentIpr)
    traces.push({
      x: r.currentIpr.map((p) => p.qOilStbD), y: r.currentIpr.map((p) => p.pwfPsi),
      name: phone ? `Pr ${Math.round(r.basePrPsi)}` : `IPR Pr=${Math.round(r.basePrPsi)} psi (current)`,
      mode: 'lines', line: { color: '#00636D', width: 3.5 },
    });
  // the future-pressure family
  r.cases.forEach((c, i) =>
    traces.push({
      x: c.iprCurve.map((p) => p.qOilStbD), y: c.iprCurve.map((p) => p.pwfPsi),
      name: phone ? String(Math.round(c.presPsi)) : `IPR ${c.label}`,
      mode: 'lines', line: { color: FAM_BLUES[i % 3], width: 2.5 },
    })
  );
  // the ESP-coupled VLP every node sits on — one curve: the pump, tubing and
  // THP do not change with reservoir pressure
  if (r.vlpCurve)
    traces.push({
      x: r.vlpCurve.map((p) => p.q), y: r.vlpCurve.map((p) => p.pwfPsi),
      name: phone ? 'VLP' : 'ESP VLP (coupled)', mode: 'lines',
      line: { color: '#C2540B', width: 2.5, dash: 'dot' },
    });
  // and the solved node for each case, as an intersection you can see
  r.cases.forEach((c, i) => {
    if (!c.op) return;
    traces.push({
      x: [c.op.qOilStbD], y: [c.op.pwfPsi],
      name: phone ? 'node' : `${c.label} node`, showlegend: !phone || i === 0,
      mode: 'markers',
      marker: { symbol: 'diamond', size: 12, color: FAM_REDS[i % 3], line: { width: 1.5, color: '#0B1418' } },
    });
  });
  plot('oil-chart-espsens', traces, {
    ...LAYOUT(),
    title: `ESP Pres sensitivity — ${r.pump.name}, ${r.opts.stages} stages @ ${r.opts.freqHz} Hz`,
    xaxis: { title: 'Oil rate, stb/d', rangemode: 'tozero' },
    // same Pri cap as every other sensitivity chart, so runs stay comparable
    yaxis: { title: 'Pressure, psi', ...(r.priPsi > 0 ? { range: [0, r.priPsi] } : { rangemode: 'tozero' }) },
  });
  mobileShowResults();
  renderTables('oil-table-espsens', [{
    title: 'ESP state at each solved node',
    headers: ['case', 'Pres psi', 'J', 'q stb/d', 'Pwf', 'Pint', 'Pdis', 'ΔP', 'head ft', 'Qg@pump', 'grad', 'free gas %', 'WHT °F', 'thrust'],
    rows: r.cases.map((c) =>
      c.op
        ? [c.label, fmt(c.presPsi, 0), fmt(c.j, 3), fmt(c.op.qOilStbD, 0), fmt(c.op.pwfPsi, 0), fmt(c.op.pintPsi, 0), fmt(c.op.pdisPsi, 0), fmt(c.op.dpPsi, 0), fmt(c.op.headFt, 0), fmt(c.op.qGrossPumpBpd, 0), fmt(c.op.gradPsiFt, 4), fmt(c.op.freeGasPct, 1), fmt(c.op.whtF, 1), c.op.thrust]
        : [c.label, fmt(c.presPsi, 0), fmt(c.j, 3), c.opStatus, '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']),
  }]);
  const sr = document.querySelector('input[name="oil-esptab"][value="sens"]');
  if (sr) sr.checked = true;
  switchEspTab();
}

async function espStagesRun() {
  const r = await api('oil/espstages', oilForm());
  document.getElementById('oil-esp-result').textContent =
    `Stage match (new pump, wear 0) at test rate ${fmt(r.testQOilStbD, 0)} stb/d:\n` +
    (r.capped
      ? `traverse match wants ${r.stagesMatch} stages, but that pulls the intake under the ` +
        `${fmt(r.minIntakePsi, 0)} psi design floor — DESIGN CAPPED at ${r.stages} stages ` +
        `(intake ${fmt(r.intakePsi, 0)} psi). Applied to the stages input.`
      : `stages = ${r.stages} (exact ${fmt(r.stagesExact, 2)}) — design proof OK: ` +
        `intake ${fmt(r.intakePsi, 0)} psi ≥ ${fmt(r.minIntakePsi, 0)} psi floor. Applied to the stages input.`);
  document.getElementById('oil-espStages').value = String(r.stages);
  if (r.pwfSource === 'ipr') setComputed('oil-testPwfPsi', r.pwfIprPsi, 1); // macro-written cell, user-overwritable
}

/** Water ESP charts drawn from the single nodal solve: the pump curve with
 *  its thrust envelope, and the traverse (top-down vs the IPR back-calc)
 *  with the pump step at pump depth. Hidden unless a pump is driving. */
function waterEspCharts(r) {
  const pumpRow = document.getElementById('water-cr-esppump');
  const travRow = document.getElementById('water-cr-esptrav');
  const e = r.esp;
  const show = !!(e && e.pumpName && e.family);
  pumpRow.style.display = show ? '' : 'none';
  travRow.style.display = e && r.espTraverse ? '' : 'none';
  if (show) {
    const traces = e.family.map((c) => ({
      x: c.points.map((p) => p.rateBpd), y: c.points.map((p) => p.headFt),
      name: `${c.freqHz} Hz`, mode: 'lines', line: { width: c.freqHz === e.opts.freqHz ? 3 : 1.4 },
    }));
    for (const t of e.thrustLines) {
      traces.push({
        x: t.points.map((p) => p.rateBpd), y: t.points.map((p) => p.headFt),
        name: t.key === 'bep' ? 'BEP' : `${t.key}-thrust`, mode: 'lines',
        line: { color: t.key === 'bep' ? '#2C7048' : '#C2540B', width: 1.5, dash: 'dash' },
      });
    }
    if (e.opPoint)
      traces.push({
        x: [e.opPoint.rateBpd], y: [e.opPoint.headFt], name: 'Operating point', mode: 'markers',
        marker: { symbol: 'star', size: 16, color: '#A93A2C', line: { width: 1, color: '#7a1f14' } },
      });
    plot('water-chart-esppump', traces, {
      ...LAYOUT(),
      title: `Pump curve — ${e.pumpName}, ${e.opts.stages} stages, wear ${fmt(e.opts.wearFactor, 2)}`,
      xaxis: { title: 'Rate @ pump, bbl/d' },
      yaxis: { title: 'Head, ft', rangemode: 'tozero' },
    });
    renderTables('water-table-esppump', [
      {
        title: 'Solution point', headers: ['item', 'value'],
        rows: [
          ['Q water surface, bbl/d', r.op ? fmt(r.op.qOilStbD, 0) : '—'],
          ['Pwf, psi', r.op ? fmt(r.op.pwfPsi, 1) : '—'],
          ['Pump intake, psi', fmt(e.intakePsi, 1)],
          ['Pump discharge, psi', fmt(e.dischargePsi, 1)],
          ['WHT (calc), °F', r.op ? fmt(r.op.whtF, 1) : '—'],
        ],
      },
      { title: 'Pump @ solution point', headers: ['parameter', 'value'], rows: pumpPointRows(e.point) },
    ]);
  }
  const tr = r.espTraverse;
  if (e && tr) {
    plot('water-chart-esptrav', [
      { x: tr.stations.map((s) => s.pPsi), y: tr.stations.map((s) => s.tvdFt), name: 'Traverse top-down', mode: 'lines+markers', line: { color: '#0B1418', width: 2 } },
      { x: tr.backStations.map((s) => s.pPsi), y: tr.backStations.map((s) => s.tvdFt), name: 'IPR back-calc', mode: 'lines+markers', line: { color: '#2C7048', width: 2, dash: 'dash' } },
      { x: [tr.intakePsi, tr.dischargePsi], y: [tr.pumpTvdFt, tr.pumpTvdFt], name: `Pump ΔP ${fmt(tr.dpPsi, 0)} psi`, mode: 'lines+markers', line: { color: '#C2540B', width: 3 }, marker: { size: 9 } },
    ], {
      ...LAYOUT(),
      title: 'Traverse gradient — top-down vs IPR back-calc',
      xaxis: { title: 'Pressure, psi' },
      yaxis: { title: 'Depth TVD, ft', autorange: 'reversed' },
    });
    renderTables('water-table-esptrav', [{
      title: 'Traverse', headers: ['TVD ft', 'P psi'],
      rows: tr.stations.map((s) => [fmt(s.tvdFt, 0), fmt(s.pPsi, 1)]),
    }]);
  }
}

/** Water tab: the same stage match against the shared pump database. */
async function waterEspStagesRun() {
  const r = await api('oil/espstages', waterForm());
  const el = document.getElementById('water-esp-result');
  if (r.error) { el.textContent = r.error; return; }
  el.textContent =
    `Stage match (new pump, wear 0) at test rate ${fmt(r.testQOilStbD, 0)} bbl/d:\n` +
    (r.capped
      ? `traverse match wants ${r.stagesMatch} stages, but that pulls the intake under the ` +
        `${fmt(r.minIntakePsi, 0)} psi design floor — DESIGN CAPPED at ${r.stages} stages ` +
        `(intake ${fmt(r.intakePsi, 0)} psi). Applied to the stages input.`
      : `stages = ${r.stages} (exact ${fmt(r.stagesExact, 2)}) — design proof OK: ` +
        `intake ${fmt(r.intakePsi, 0)} psi ≥ ${fmt(r.minIntakePsi, 0)} psi floor. Applied to the stages input.`);
  document.getElementById('water-espStages').value = String(r.stages);
  if (r.pwfSource === 'ipr') setComputed('water-testPwfPsi', r.pwfIprPsi, 1); // macro-written cell, user-overwritable
}

async function espWearRun() {
  const r = await api('oil/espwear', oilForm());
  document.getElementById('oil-esp-result').textContent =
    `Wear match from actual Pint/Pdis:\n` +
    `\u0394P actual = ${fmt(r.dpMeasPsi, 1)} psi vs theoretical ${fmt(r.dpTheoPsi, 1)} \u2192 wear = ${fmt(r.wearFactor, 4)} (applied to the wear input).\n` +
    `QC only \u2014 implied PI at constant Pres ${fmt(r.prPsi, 0)} psi = ${fmt(r.jMatched, 4)} bbl/d/psi (K ${fmt(r.matchedPermMd, 2)} mD); NOT applied.`;
  document.getElementById('oil-espWearFactor').value = r.wearFactor.toFixed(4);
}
const waterSolve = () => (waterWellType() === 'injector' ? waterInjSolve() : liquidSolve(WATER_CTX));

// injector nodal: available BHIP (falls with rate — friction) crossing the
// injectivity line Pr + q/J (rises); THP-required and calculated BHT below
async function waterInjSolve() {
  clearWaterProducerResults();
  const r = await api('water/injector', waterForm());
  summary('water-summary', [
    { k: 'Injection rate', v: r.op ? `${fmt(r.op.qBpd, 0)} bbl/d` : r.opStatus, warn: !r.op },
    { k: 'BHIP', v: r.op ? `${fmt(r.op.pwfPsi, 0)} psi` : '—' },
    { k: 'BHT (calc)', v: r.op ? `${fmt(r.op.bhtF, 1)} °F` : '—' },
    { k: 'J injectivity', v: fmt(r.jInj, 3) },
    { k: 'Pr', v: `${fmt(r.prPsi, 0)} psi` },
    r.deficitPsi != null ? { k: 'THP deficit', v: `${fmt(r.deficitPsi, 0)} psi`, warn: true } : null,
    // formation parting — shown only when a fracture gradient was entered
    r.fracPsi != null ? { k: 'Parting pressure', v: `${fmt(r.fracPsi, 0)} psi` } : null,
    r.aboveFracPsi != null
      ? {
          k: 'Above parting by',
          v: r.fracUnavoidable
            ? `${fmt(r.aboveFracPsi, 0)} psi — no THP injects below it`
            : `${fmt(r.aboveFracPsi, 0)} psi — drop THP to ${fmt(r.thpAtFracPsi, 0)}`,
          warn: true,
        }
      : null,
  ]);
  plotNodal('water-chart-nodal', 'Injection rate, bbl/d', r.injCurve, r.vlpCurve,
    r.op ? { q: r.op.qBpd, pwfPsi: r.op.pwfPsi } : null,
    (p) => p.q, (p) => p.q,
    { title: 'Injectivity — bottomhole node', iprName: 'Required (Pr + q/J)', vlpName: 'Available BHIP', opName: 'Injection point' });
  plot('water-chart-whp', [
    { x: r.thpCurve.map((p) => p.q), y: r.thpCurve.map((p) => p.thpReqPsi), name: 'Injection THP required', mode: 'lines+markers', line: { color: '#0B1418', width: 3 } },
    { x: r.thpCurve.map((p) => p.q), y: r.thpCurve.map((p) => p.bhtF), name: 'BHT (calc)', yaxis: 'y2', mode: 'lines', line: { color: '#00636D', width: 2, dash: 'dot' } },
  ], {
    ...LAYOUT(),
    margin: { ...LAYOUT().margin, r: window.innerWidth < 640 ? 40 : 55 },
    title: 'Injection THP required & bottomhole temperature',
    xaxis: { title: 'Injection rate, bbl/d' },
    yaxis: { title: 'THP, psi', rangemode: 'tozero' },
    yaxis2: { title: 'BHT, °F', overlaying: 'y', side: 'right', showgrid: false, titlefont: { color: '#00636D' }, tickfont: { color: '#00636D' } },
  });
  renderTables('water-table-nodal', [
    {
      title: 'Injectivity (required)', headers: ['q bbl/d', 'Pwf psi'],
      rows: r.injCurve.map((p) => [fmt(p.q, 0), fmt(p.pwfPsi, 1)]),
    },
    {
      title: 'Available BHIP', headers: ['q bbl/d', 'BHIP psi', 'BHT °F'],
      rows: r.vlpCurve.map((p) => [fmt(p.q, 0), fmt(p.pwfPsi, 1), fmt(p.bhtF, 1)]),
    },
  ]);
  renderTables('water-table-whp', [
    {
      title: 'THP required & BHT', headers: ['q bbl/d', 'THP req psi', 'BHT °F'],
      rows: r.thpCurve.map((p) => [fmt(p.q, 0), fmt(p.thpReqPsi, 1), fmt(p.bhtF, 1)]),
    },
  ]);
}

async function waterInjCalibrateRun() {
  const r = await api('water/injcalibrate', waterForm());
  document.getElementById('water-cal-result').textContent =
    `Test BHIP = ${fmt(r.testPwfPsi, 1)} psi (${r.pwfSource})\n` +
    `J injectivity = ${fmt(r.jTest, 4)} bbl/d/psi\n` +
    `Matched K = ${fmt(r.matchedPermMd, 2)} mD at skin ${r.skinUsed} — applied to the K input.`;
  document.getElementById('water-permMd').value = r.matchedPermMd.toFixed(4);
  if (r.pwfSource === 'calculated') setComputed('water-testPwfPsi', r.testPwfPsi, 1);
}

async function liquidCalibrate(c) {
  const r = await api('oil/calibrate', c.form());
  let txt =
    `Test Pwf = ${fmt(r.testPwfPsi, 1)} psi (${r.pwfSource})\n` +
    `J Jones = ${fmt(r.jTest, 4)} bbl/d/psi (gross ${fmt(r.testQGrossStbD, 0)} bbl/d)\n` +
    `Matched K = ${fmt(r.matchedPermMd, 2)} mD at skin ${r.skinUsed} — applied to the K input.`;
  document.getElementById(`${c.prefix}-permMd`).value = r.matchedPermMd.toFixed(4);
  if (r.pwfSource === 'calculated') setComputed(`${c.prefix}-testPwfPsi`, r.testPwfPsi, 1);
  // multi-layer fit: total J fitted to Jones, layer K's are the solver
  if (r.mlFit) {
    txt +=
      `\n\nMulti-layer fit: J Jones @ PrAvg ${fmt(r.mlFit.prAvgPsi, 0)} psi = ${fmt(r.mlFit.jTestMl, 4)}; ` +
      `total J was ${fmt(r.mlFit.jFinal, 4)} → all layer K's scaled ×${fmt(r.mlFit.scale, 4)}:\n` +
      r.mlFit.layers.map((l) => `L${l.idx + 1}: K ${fmt(l.kOld, 2)} → ${fmt(l.kNew, 3)} mD`).join('\n');
    r.mlFit.layers.forEach((l) => {
      const el = document.getElementById(`${c.prefix}-ml-${l.idx}-permMd`);
      if (el) el.value = l.kNew.toFixed(4);
    });
  }
  document.getElementById(`${c.prefix}-cal-result`).textContent = txt;
}

const oilCalibrate = () => liquidCalibrate(OIL_CTX);
const waterCalibrate = () =>
  waterWellType() === 'injector' ? waterInjCalibrateRun() : liquidCalibrate(WATER_CTX);

/** The pump's state at a solved node, as table rows — the same parameter
 *  set everywhere it is reported (match case and every sensitivity). */
function pumpPointRows(p) {
  if (!p) return [];
  return [
    ['Pump', p.pumpName],
    ['Stages', fmt(p.stages, 0)],
    ['Frequency, Hz', `${fmt(p.freqHz, 0)} (curve ref ${fmt(p.refFreqHz, 0)})`],
    ['Wear factor', fmt(p.wearFactor, 3)],
    ['Head total / per stage, ft', `${fmt(p.headFt, 1)} / ${fmt(p.headPerStageFt, 2)}`],
    ['Pump ΔP, psi', fmt(p.dpPsi, 1)],
    ['Rate @ pump (after sep), bbl/d', fmt(p.qGrossPumpBpd, 0)],
    ['Rate @ pump (no sep), bbl/d', fmt(p.qGrossPumpNoSepBpd, 0)],
    ['Composite gradient, psi/ft', fmt(p.gradPsiFt, 4)],
    ['Free gas @ intake, %', `${fmt(p.freeGasPct, 2)}${p.sepRequired ? ' (separator required)' : ''}`],
    ['Separator efficiency, %', fmt(p.sepEffPct, 0)],
    ['Thrust', `${p.thrust} — window ${fmt(p.thrustDownBpd, 0)} / BEP ${fmt(p.thrustBepBpd, 0)} / ${fmt(p.thrustUpBpd, 0)} bbl/d`],
    ['Hydraulic power, hp', fmt(p.hydraulicHp, 1)],
    ['ΔP fixed point', p.dpConverged ? 'converged' : 'NOT converged'],
  ];
}

/** The solved node of every VLP set, below the sensitivity chart, plus the
 *  ESP pump-curve and traverse families when a pump drives the well. */
function renderSensResults(prefix, r, rateLabel) {
  const fam = r.vlpFamily ?? [];
  const anyEsp = fam.some((m) => m.esp);
  const anyTrav = fam.some((m) => m.traverse);
  renderTables(`${prefix}-table-sens`, [{
    title: 'Nodal solution per VLP set (at current Pr)',
    headers: anyEsp
      ? ['set', rateLabel, 'Pwf psi', 'WHP psi', 'WHT °F', 'Hz', 'ΔP psi', 'head ft', 'Pint psi', 'Pdis psi', 'thrust']
      : ['set', rateLabel, 'Pwf psi', 'WHP psi', 'WHT °F'],
    rows: fam.map((m) => {
      const base = m.op
        ? [m.label, fmt(m.op.qOilStbD, 0), fmt(m.op.pwfPsi, 1), fmt(m.op.whpPsi, 1), fmt(m.op.whtF, 1)]
        : [m.label, m.opStatus ?? '—', '—', '—', '—'];
      if (!anyEsp) return base;
      return m.esp
        ? [...base, fmt(m.esp.freqHz, 0), fmt(m.esp.dpPsi, 0), fmt(m.esp.headFt, 0), fmt(m.esp.intakePsi, 0), fmt(m.esp.dischargePsi, 0), m.esp.thrust]
        : [...base, '—', '—', '—', '—', '—', '—'];
    }),
  }]);
  // pump curve per set (each set may run at its own frequency)
  const pumpRow = document.getElementById(`${prefix}-cr-senspump`);
  const travRow = document.getElementById(`${prefix}-cr-senstrav`);
  const hasCurves = fam.some((m) => m.pumpCurve);
  pumpRow.style.display = hasCurves ? '' : 'none';
  travRow.style.display = anyTrav ? '' : 'none';
  if (hasCurves) {
    const traces = [];
    fam.forEach((m, i) => {
      if (!m.pumpCurve) return;
      traces.push({
        x: m.pumpCurve.points.map((p) => p.rateBpd), y: m.pumpCurve.points.map((p) => p.headFt),
        name: `${m.label} @ ${m.pumpCurve.freqHz} Hz`, mode: 'lines',
        line: { color: FAM_REDS[i % 3], width: 2.5 },
      });
      if (m.esp)
        traces.push({
          x: [m.esp.qGrossPumpBpd], y: [m.esp.headFt], name: `${m.label} node`, mode: 'markers',
          marker: { symbol: 'star', size: 14, color: FAM_REDS[i % 3], line: { width: 1, color: '#0B1418' } },
        });
    });
    for (const t of r.thrustLines ?? [])
      traces.push({
        x: t.points.map((p) => p.rateBpd), y: t.points.map((p) => p.headFt),
        name: t.key === 'bep' ? 'BEP' : `${t.key}-thrust`, mode: 'lines',
        line: { color: t.key === 'bep' ? '#2C7048' : '#C2540B', width: 1.5, dash: 'dash' },
      });
    plot(`${prefix}-chart-senspump`, traces, {
      ...LAYOUT(),
      title: `Pump curve per sensitivity — ${r.pumpName ?? 'pump'}, ${r.espOpts?.stages ?? '—'} stages`,
      xaxis: { title: 'Rate @ pump, bbl/d' },
      yaxis: { title: 'Head, ft', rangemode: 'tozero' },
    });
    // the full pump state at each set's solved node, one column per set
    const pts = fam.filter((m) => m.esp?.point);
    const labels = pumpPointRows(pts[0]?.esp.point).map((r) => r[0]);
    renderTables(`${prefix}-table-senspump`, [{
      title: 'Pump @ each solved node',
      headers: ['parameter', ...pts.map((m) => m.label)],
      rows: labels.map((lab, i) => [lab, ...pts.map((m) => pumpPointRows(m.esp.point)[i][1])]),
    }]);
  }
  // traverse per set, each with its pump step at pump depth
  if (anyTrav) {
    const tv = [];
    fam.forEach((m, i) => {
      if (!m.traverse) return;
      const t = m.traverse;
      tv.push({ x: t.stations.map((s) => s.pPsi), y: t.stations.map((s) => s.tvdFt), name: `${m.label} top-down`, mode: 'lines', line: { color: FAM_REDS[i % 3], width: 2 } });
      tv.push({ x: t.backStations.map((s) => s.pPsi), y: t.backStations.map((s) => s.tvdFt), name: `${m.label} IPR back-calc`, mode: 'lines', line: { color: FAM_BLUES[i % 3], width: 1.6, dash: 'dash' } });
      tv.push({ x: [t.intakePsi, t.dischargePsi], y: [t.pumpTvdFt, t.pumpTvdFt], name: `${m.label} ΔP ${fmt(t.dpPsi, 0)} psi`, mode: 'lines+markers', line: { color: FAM_REDS[i % 3], width: 3 }, marker: { size: 8 } });
    });
    plot(`${prefix}-chart-senstrav`, tv, {
      ...LAYOUT(),
      title: 'Traverse per sensitivity — top-down vs IPR back-calc',
      xaxis: { title: 'Pressure, psi' },
      yaxis: { title: 'Depth TVD, ft', autorange: 'reversed' },
    });
    renderTables(`${prefix}-table-senstrav`, [{
      title: 'Pump node per set', headers: ['set', 'pump TVD ft', 'Pint psi', 'Pdis psi', 'ΔP psi'],
      rows: fam.filter((m) => m.traverse).map((m) => [
        m.label, fmt(m.traverse.pumpTvdFt, 0), fmt(m.traverse.intakePsi, 1), fmt(m.traverse.dischargePsi, 1), fmt(m.traverse.dpPsi, 1),
      ]),
    }]);
  }
}

async function oilSens() {
  const body = oilForm();
  body.vlpSets = collectSens('oil', oilSensCols(), OIL_SENS_ROWS.length);
  body.presList = collectPres('oil', 3);
  const r = await api('oil/sensitivity', body);
  plotSens('oil-chart-sens', 'Oil rate, stb/d', r.iprFamily, r.vlpFamily, (p) => p.qOilStbD, { priPsi: r.priPsi, opQ: (o) => o.qOilStbD });
  renderSensResults('oil', r, 'q oil stb/d');
}

/** Injectivity sensitivities: every THP set solved against Pri and each
 *  future Pres. x = the nodal solution rate, y = the injection THP that
 *  places it — one line per reservoir pressure. */
function renderInjGrid(r) {
  const row = document.getElementById('water-cr-injgrid');
  const grid = r.grid ?? [];
  const usable = grid.filter((g) => g.points.some((p) => p.status === 'ok' || p.status === 'grid-cap'));
  row.style.display = usable.length ? '' : 'none';
  if (!usable.length) return;
  const traces = grid.map((g, i) => {
    const pts = g.points.filter((p) => p.qBpd > 0);
    return {
      x: pts.map((p) => p.qBpd),
      y: pts.map((p) => p.thpPsi),
      name: g.isPri ? `Pri ${Math.round(g.presPsi)}` : `Pr ${Math.round(g.presPsi)}`,
      mode: 'lines+markers',
      line: { color: g.isPri ? '#0B1418' : FAM_BLUES[(i - 1) % 3], width: g.isPri ? 3 : 2.2, dash: g.isPri ? 'solid' : 'dot' },
      marker: { size: 9, symbol: g.isPri ? 'diamond' : 'circle' },
    };
  });
  plot('water-chart-injgrid', traces, {
    ...LAYOUT(),
    title: 'Injectivity sensitivities',
    xaxis: { title: 'Injection rate at the solved node, bbl/d', rangemode: 'tozero' },
    yaxis: { title: 'Injection THP, psi', rangemode: 'tozero' },
  });
  renderTables('water-table-injgrid', [{
    title: 'Nodal solutions — THP x reservoir pressure',
    headers: ['set', 'THP psi', 'Pres psi', 'q inj bbl/d', 'BHIP psi', 'BHT °F', 'status'],
    rows: grid.flatMap((g) => g.points.map((p) => [
      p.label,
      fmt(p.thpPsi, 0),
      fmt(p.presPsi, 0),
      p.status === 'ok' || p.status === 'grid-cap' ? fmt(p.qBpd, 0) : '—',
      p.pwfPsi != null ? fmt(p.pwfPsi, 1) : '—',
      p.bhtF != null ? fmt(p.bhtF, 1) : '—',
      p.status === 'ok' ? 'ok' : p.deficitPsi != null ? `no injection (deficit ${fmt(p.deficitPsi, 0)} psi)` : p.status,
    ])),
  }]);
}

async function waterSens() {
  const inj = waterWellType() === 'injector';
  const body = waterForm();
  body.vlpSets = collectSens('water', waterSensCols(), waterSensRows().length);
  body.presList = collectPres('water', 3);
  const r = await api(inj ? 'water/injsensitivity' : 'oil/sensitivity', body);
  // water IPR curves carry the rate in qGrossStbD (gross water basis);
  // for the injector the "IPR" family is the injectivity line at future Pres
  plotSens(
    'water-chart-sens',
    inj ? 'Injection rate, bbl/d' : 'Water rate, bbl/d',
    r.iprFamily,
    r.vlpFamily,
    (p) => p.qGrossStbD ?? p.qOilStbD,
    inj
      // the injector deliberately pushes ABOVE the reservoir pressure, so
      // its axis stays auto-scaled — capping it at Pri would clip the very
      // curves it exists to show
      ? {
          title: 'Injectivity & available-BHIP sensitivities',
          iprName: 'Required', iprNameShort: 'Req',
          vlpName: 'Available', vlpNameShort: 'Av',
          showBht: true,
        }
      : { priPsi: r.priPsi, opQ: (o) => o.qOilStbD }
  );
  if (inj) {
    // the injector has no producing node/pump: families + the injectivity grid
    for (const id of ['water-cr-senspump', 'water-cr-senstrav'])
      document.getElementById(id).style.display = 'none';
    document.getElementById('water-table-sens').innerHTML = '';
    renderInjGrid(r);
  } else {
    document.getElementById('water-cr-injgrid').style.display = 'none';
    renderSensResults('water', r, 'q water bbl/d');
  }
}

function gasIprMode() {
  return document.querySelector('input[name="gas-iprmode"]:checked').value;
}

function gasModule() {
  return document.querySelector('input[name="gas-module"]:checked').value;
}

function switchGasModule() {
  const m = gasModule();
  // reserve mode: half-page table with the chart beside it
  document.getElementById('panel-gas').classList.toggle('mode-reserve', m === 'reserve');
  document.getElementById('gas-mod-well').style.display = m === 'well' ? '' : 'none';
  document.getElementById('gas-mod-reserve').style.display = m === 'reserve' ? '' : 'none';
  document.getElementById('gas-mod-forecast').style.display = m === 'forecast' ? '' : 'none';
  document.getElementById('gas-cr-nodal').style.display = m === 'well' ? '' : 'none';
  document.getElementById('gas-chart-sens').style.display = m === 'well' ? '' : 'none';
  document.getElementById('gas-cr-whp').style.display = m === 'well' ? '' : 'none';
  document.getElementById('gas-cr-pz').style.display = m === 'reserve' ? '' : 'none';
  document.getElementById('gas-cr-fc').style.display = m === 'forecast' ? '' : 'none';
  resizeVisibleCharts();
}

function switchGasIpr() {
  const m = gasIprMode();
  document.getElementById('gas-ipr-darcy').style.display = m === 'j' ? '' : 'none';
  document.getElementById('gas-ipr-cn').style.display = m === 'cn' ? '' : 'none';
}

function gasForm() {
  const f = collect('gas', GAS_SCHEMA, [...GAS_CN_FIELDS, ...GAS_DARCY_FIELDS, ...GAS_FC_FIELDS, ...GAS_RLT_FIELDS]);
  f.iprMode = gasIprMode();
  f.mlMode = mlMode('gas');
  f.mlLayers = collectGrid('gas-ml', GAS_ML_COLS, GAS_ML_ROWS.length);
  f.presSource = document.querySelector('input[name="gas-pressource"]:checked')?.value ?? 'flowing';
  f.testPoints = collectGasTests();
  f.prodRows = collectGrid('gas-prod', PROD_COLS, gasProdCount);
  f.sithpRows = collectGrid('gas-sithp', SITHP_COLS, gasSithpTable.count());
  f.gaugeRows = collectGrid('gas-gauge', GAS_GAUGE_COLS, gasGaugeTable.count());
  return f;
}

// each method is legitimate on its own inputs — the three can differ; the
// user judges by the quality of each method's inputs, and cross-method
// agreement is the QC signal
const RESERVE_GUIDANCE = {
  prod: 'Best practice: regular flowing data with reliable rate/THP records and a MATCHED well model (calibrate Darcy first). ' +
    'Limitations: Pres inherits any VLP-match or J error (drawdown maps into pr); result is a MINIMUM connected GIIP that grows as depletion data accumulates.',
  sithp: 'Best practice: stabilized shut-in surveys — the strongest data, independent of IPR/VLP matching; Gp comes from the prod-data cumulative. ' +
    'Limitations: needs true stabilized SITHP (long enough shut-in) and a liquid-free static column; rate records still set Gp accuracy.',
  gauge: 'Best practice: measured static reservoir pressures from memory or permanent gauges — the most direct p/Z route, with no march and no IPR between the data and the answer. ' +
    'Limitations: each reading must be a STABILIZED (built-up / extrapolated) pressure at datum, not a flowing one, and corrected to the datum depth before entry; Gp still comes from the rate records.',
  rlt: 'Best practice: a clean EARLY constant-rate drawdown in pseudo-steady state; quick minimum-volume screen. ' +
    'Limitations: assumes pss and constant Ct over the window; sensitive to Ct and to rate variations; differs from the p/Z methods by design.',
};

function switchGasPresSource() {
  const s = document.querySelector('input[name="gas-pressource"]:checked').value;
  // shut-in selection shows only the survey table; Gp still comes from the
  // (hidden) prod data table's cumulative
  document.getElementById('gas-rsv-prod').style.display = s === 'sithp' || s === 'gauge' ? 'none' : '';
  document.getElementById('gas-rsv-sithp').style.display = s === 'sithp' ? '' : 'none';
  document.getElementById('gas-rsv-gauge').style.display = s === 'gauge' ? '' : 'none';
  document.getElementById('gas-rsv-rlt').style.display = s === 'rlt' ? '' : 'none';
  // reservoir-limit view slims the prod table to the essential columns
  document.getElementById('gas-rsv-prod').classList.toggle('rlt-slim', s === 'rlt');
  document.getElementById('gas-rsv-guidance').textContent = RESERVE_GUIDANCE[s] ?? '';
  document.getElementById('gas-giip-banner').innerHTML = ''; // avoid stale result on switch
}

/** Indexes of prod-table rows the server accepted (date + rate present). */
function prodValidIdx() {
  const idx = [];
  for (let i = 0; i < gasProdCount; i++) {
    if (val(`gas-prod-${i}-date`) !== '' && val(`gas-prod-${i}-qMMscfd`) !== '') idx.push(i);
  }
  return idx;
}

async function gasReserveRun() {
  const r = await api('gas/reserve', gasForm());
  if (r.mode === 'sithp') {
    // fill the survey table's output columns (dt, pr, z from the static march)
    const sIdx = [];
    for (let i = 0; i < gasSithpTable.count(); i++) {
      if (val(`gas-sithp-${i}-date`) !== '' && val(`gas-sithp-${i}-sithpPsi`) !== '') sIdx.push(i);
    }
    r.rows.forEach((row, k) => {
      const i = sIdx[k];
      if (i == null) return;
      setOut(`gas-sithp-${i}-dtDays`, row.dtDays, 2);
      setOut(`gas-sithp-${i}-presPsi`, row.presPsi, 1);
      setOut(`gas-sithp-${i}-z`, row.z, 4);
    });
  }
  // fill the prod_data output columns (pr, z) and the Pwf input-or-calc cells
  if (r.mode === 'flowing' || r.mode === 'rlt') {
    const idx = prodValidIdx();
    r.rows.forEach((row, k) => {
      const i = idx[k];
      if (i == null) return;
      if (row.pwfSource === 'calculated') setComputed(`gas-prod-${i}-pwfPsi`, row.pwfPsi, 1);
      setOut(`gas-prod-${i}-dtDays`, row.dtDays, 2);
      setOut(`gas-prod-${i}-presPsi`, row.presPsi, 1);
      setOut(`gas-prod-${i}-z`, row.z, 4);
    });
  }
  if (r.mode === 'gauge') {
    // fill the survey table's output columns (dt, z, Gp, p/Z)
    const gIdx = [];
    for (let i = 0; i < gasGaugeTable.count(); i++) {
      if (val(`gas-gauge-${i}-date`) !== '' && val(`gas-gauge-${i}-presPsi`) !== '') gIdx.push(i);
    }
    r.rows.forEach((row, k) => {
      const i = gIdx[k];
      if (i == null) return;
      setOut(`gas-gauge-${i}-corrPsi`, row.corrPsi, 1);
      setOut(`gas-gauge-${i}-dtDays`, row.dtDays, 2);
      setOut(`gas-gauge-${i}-z`, row.z, 4);
      setOut(`gas-gauge-${i}-gpBscf`, row.gpBscf, 3);
      setOut(`gas-gauge-${i}-pOverZ`, row.pOverZ, 1);
    });
  }
  const giipTxt = r.fit.giipBscf != null ? `${fmt(r.fit.giipBscf, 2)} Bscf` : 'no depletion signal';
  const routeTxt =
    r.mode === 'sithp' ? '2: SITHP statics (zero-rate correlation)'
    : r.mode === 'gauge' ? '4: measured Pr (memory gauges)'
    : r.mode === 'rlt' ? `3: reservoir limit (all ${r.rows.length} rows, workbook method)`
    : '1: prod data & macro (Pres solver)';
  document.getElementById('gas-reserve-result').textContent =
    `Minimum connected GIIP = ${giipTxt}  [selection ${routeTxt}]\n` +
    (r.mode === 'rlt'
      ? `m = ${fmt(r.rlt.slopePsiDay, 4)} psi/day, q avg = ${fmt(r.rlt.qAvgMMscfd, 2)} MMscf/d\n` +
        `Cg = ${r.rlt.cg.toExponential(4)}, Ct = ${r.rlt.ct.toExponential(4)} 1/psi, Bg = ${r.rlt.bg1.toExponential(4)} cf/scf\n` +
        (r.rlt.vpMMcf != null ? `Vp = ${r.rlt.vpMMcf.toExponential(4)} (workbook units)\n` : '')
      : `pi/Zi (fit) = ${fmt(r.fit.pziPsi, 1)} psi, slope = ${fmt(r.fit.slope, 2)} psi/Bscf\n`) +
    `Gp to date = ${fmt(r.lastGpBscf, 3)} Bscf` +
    (r.fit.warning ? `\n⚠ ${r.fit.warning}` : '') +
    (r.warnings?.length ? `\n⚠ ${r.warnings.join('; ')}` : '');
  if (r.mode === 'rlt') setComputed('gas-rltCg', r.rlt.cg, 'exp');
  // big-font GIP result for the selected method
  const banner = document.getElementById('gas-giip-banner');
  const methodName =
    r.mode === 'sithp' ? 'SITHP statics'
    : r.mode === 'gauge' ? 'Measured Pr (gauges)'
    : r.mode === 'rlt' ? 'Reservoir limit'
    : 'Prod data / Pres solver';
  banner.innerHTML =
    r.fit.giipBscf != null
      ? `<span class="method">GIP — minimum connected (${methodName})</span><span class="val">${fmt(r.fit.giipBscf, 1)} Bscf</span>`
      : `<span class="method">GIP (${methodName})</span><span class="val warn">no depletion signal</span>`;
  if (r.fit.giipBscf != null) setHeadline(`${fmt(r.fit.giipBscf, 1)} Bscf`, 'GIP min connected');
  mobileShowResults();
  if (r.fit.giipBscf != null) {
    setComputed('gas-giipBscf', r.fit.giipBscf, 2);
    setComputed('gas-pziPsi', r.fit.pziPsi, 1);
  }

  if (r.mode === 'rlt') {
    // the workbook's top graph: Pwf vs elapsed time with the fitted slope
    const pts = r.rows;
    const mt = pts.reduce((a, p) => a + p.dtDays, 0) / pts.length;
    const my = pts.reduce((a, p) => a + p.pwfPsi, 0) / pts.length;
    const t0 = pts[0].dtDays;
    const t1 = pts[pts.length - 1].dtDays;
    const slope = -r.rlt.slopePsiDay;
    plot('gas-chart-pz', [
      { x: pts.map((p) => p.dtDays), y: pts.map((p) => p.pwfPsi), name: 'Pwf', mode: 'markers', marker: { size: 9, color: '#7038b0' } },
      { x: [t0, t1], y: [my + slope * (t0 - mt), my + slope * (t1 - mt)], name: `slope ${fmt(r.rlt.slopePsiDay, 3)} psi/day`, mode: 'lines', line: { color: '#2C7048', dash: 'dash' } },
    ], {
      ...LAYOUT(),
      title: 'Reservoir limit — Pwf vs time (all rows)',
      xaxis: { title: 'dt, days' },
      yaxis: { title: 'Pwf, psi' },
    });
    renderTables('gas-table-pz', [
      {
        title: 'Reservoir limit', headers: ['dt d', 'q', 'Pwf', 'pr', 'z'],
        rows: pts.map((p) => [fmt(p.dtDays, 2), fmt(p.qMMscfd, 2), fmt(p.pwfPsi, 1), fmt(p.presPsi, 1), fmt(p.z, 4)]),
      },
    ]);
    return;
  }

  // p/Z chart: fitted points + line to GIIP (the prod-data chart shows only
  // its own points — no SITHP overlay, per user request)
  const mainName =
    r.mode === 'sithp' ? 'SITHP statics (zero-rate corr.)'
    : r.mode === 'gauge' ? 'Measured Pr (memory gauges)'
    : 'Production (back-calc Pr)';
  const mainColor = r.mode === 'sithp' ? '#C2540B' : r.mode === 'gauge' ? '#7038b0' : '#00636D';
  const mainSymbol = r.mode === 'sithp' ? 'square' : r.mode === 'gauge' ? 'diamond' : 'circle';
  const traces = [
    { x: r.rows.map((p) => p.gpBscf), y: r.rows.map((p) => p.pOverZ), name: mainName, mode: 'markers', marker: { size: 9, color: mainColor, symbol: mainSymbol } },
  ];
  if (r.fit.giipBscf != null) {
    traces.push({ x: [0, r.fit.giipBscf], y: [r.fit.pziPsi, 0], name: 'p/Z line → GIIP', mode: 'lines', line: { color: '#2C7048', dash: 'dash', width: 2 } });
  }
  plot('gas-chart-pz', traces, {
    ...LAYOUT(),
    // the selection is already named by the legend trace, so the title does
    // not repeat it — it overran the chart canvas on a narrow results column
    title: 'p/Z vs Gp — minimum connected GIIP',
    xaxis: { title: 'Gp, Bscf', rangemode: 'tozero' },
    yaxis: { title: 'p/Z, psi', rangemode: 'tozero' },
  });
  renderTables('gas-table-pz', [
    r.mode === 'gauge'
      ? {
          title: 'Memory gauges → p/Z', headers: ['dt d', 'Pr psi', 'z', 'Gp Bscf', 'p/Z psi'],
          rows: r.rows.map((p) => [fmt(p.dtDays, 2), fmt(p.presPsi, 1), fmt(p.z, 4), fmt(p.gpBscf, 3), fmt(p.pOverZ, 1)]),
        }
      : r.mode === 'sithp'
      ? {
          title: 'SITHP → Pres → p/Z', headers: ['dt d', 'SITHP', 'Pres', 'z', 'p/Z', 'Gp Bscf'],
          rows: r.rows.map((p) => [fmt(p.dtDays ?? p.tDays, 2), fmt(p.sithpPsi, 0), fmt(p.presPsi, 1), fmt(p.z, 4), fmt(p.pOverZ, 1), fmt(p.gpBscf, 3)]),
        }
      : {
          title: 'prod_data (solver outputs)', headers: ['dt d', 'q', 'Pwf', 'dp', 'pr', 'z', 'p/Z', 'Gp Bscf'],
          rows: r.rows.map((p) => [fmt(p.dtDays, 2), fmt(p.qMMscfd, 2), fmt(p.pwfPsi, 1), fmt(p.dpPsi, 1), fmt(p.presPsi, 1), fmt(p.z, 4), fmt(p.pOverZ, 1), fmt(p.gpBscf, 3)]),
        },
  ]);
}

// toDays basis: text dates parse to epoch days; numeric serials pass through
// untouched. 7000..36890 reads as epoch days (1989-2071), 36890..80000 as an
// Excel serial; anything else has no calendar meaning -> null (plot elapsed
// days instead).
function dayToDateStr(t) {
  if (!Number.isFinite(t)) return null;
  let ms = null;
  if (t >= 7000 && t <= 36890) ms = t * 86400000;
  else if (t > 36890 && t <= 80000) ms = (t - 25569) * 86400000;
  if (ms == null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

async function gasForecastRun() {
  const r = await api('gas/forecast', gasForm());
  document.getElementById('gas-fc-result').textContent =
    `EUR = ${fmt(r.eurBscf, 2)} Bscf (${fmt(r.recoveryPct, 1)}% of GIIP ${fmt(r.giipBscf, 1)}), status: ${r.status}\n` +
    `Plateau held ${r.rows.filter((p) => p.onPlateau).length} of ${r.rows.length} steps. ` +
    `Start: Gp ${fmt(r.startGpBscf, 3)} Bscf, Pres ${fmt(r.startPresPsi, 0)} psi.\n` +
    // the workbook's Forecast sheet derives its start state from the
    // PROD-DATA sheet, so this chain ignores whichever reserve selection is
    // on screen. On the demo that is 182 Bscf vs ~120 from SITHP/gauges —
    // worth saying out loud rather than leaving two numbers to disagree.
    `GIIP and pi/Zi are the prod-data p/Z fit (Reserve selection 1), not the selection currently shown. Type a GIIP to override.` +
    // an FTHP marked * was back-solved because the well was choked to the
    // plateau -- it is the wellhead pressure the constrained rate implies,
    // not the FTHP you typed
    (r.rows.some((p) => p.fthpSource === 'solved')
      ? `\nFTHP marked * is back-solved from the choked rate (${r.rows.filter((p) => p.fthpSource === 'solved').length} step(s) on plateau); elsewhere it is the forecast FTHP you entered.`
      : '');
  setComputed('gas-giipBscf', r.giipBscf, 2);
  setComputed('gas-pziPsi', r.pziPsi, 1);
  setComputed('gas-startGpBscf', r.startGpBscf, 3);
  setComputed('gas-startPresPsi', r.startPresPsi, 1);
  setComputed('gas-startDate', dayToDateStr(r.startDay) ?? r.startDay, 'str');
  // workbook Forecast chart: history + forecast on one date axis (rate and
  // Gp left, Pres right). Calendar dates only when every point converts.
  const hist = r.history ?? [];
  const all = [...hist.map((p) => p.tDays), ...r.rows.map((p) => p.tDays)];
  const useDates = all.length > 0 && all.every((t) => dayToDateStr(t) != null);
  const t0 = all.length ? all[0] : 0;
  const ax = (t) => (useDates ? dayToDateStr(t) : t - t0);
  const traces = [];
  if (hist.length) {
    traces.push(
      { x: hist.map((p) => ax(p.tDays)), y: hist.map((p) => p.qMMscfd), name: 'Rate (history)', mode: 'lines+markers', line: { color: '#2C7048', width: 2 } },
      { x: hist.map((p) => ax(p.tDays)), y: hist.map((p) => p.presPsi), name: 'Pres (history)', yaxis: 'y2', mode: 'lines+markers', line: { color: '#00636D', width: 2 } },
      { x: hist.map((p) => ax(p.tDays)), y: hist.map((p) => p.thpPsi), name: 'FTHP (history)', yaxis: 'y2', mode: 'lines+markers', line: { color: '#7038b0', width: 2 } },
      { x: hist.map((p) => ax(p.tDays)), y: hist.map((p) => p.gpBscf), name: 'Gp (history)', mode: 'lines', line: { color: '#C2540B', width: 2 } }
    );
  }
  traces.push(
    { x: r.rows.map((p) => ax(p.tDays)), y: r.rows.map((p) => p.qMMscfd), name: 'F Rate', mode: 'lines', line: { color: '#2C7048', width: 3, dash: 'dash' } },
    { x: r.rows.map((p) => ax(p.tDays)), y: r.rows.map((p) => p.presPsi), name: 'F Pres', yaxis: 'y2', mode: 'lines', line: { color: '#00636D', width: 2, dash: 'dot' } },
    { x: r.rows.map((p) => ax(p.tDays)), y: r.rows.map((p) => p.fthpPsi), name: 'F FTHP', yaxis: 'y2', mode: 'lines', line: { color: '#7038b0', width: 2, dash: 'dash' } },
    { x: r.rows.map((p) => ax(p.tDays)), y: r.rows.map((p) => p.gpBscf), name: 'Cum gas', mode: 'lines', line: { color: '#C2540B', width: 2, dash: 'dash' } }
  );
  plot('gas-chart-fc', traces, {
    ...LAYOUT(),
    margin: { ...LAYOUT().margin, r: window.innerWidth < 640 ? 40 : 55 },
    title: 'Gas forecast — history + forecast (p/Z tank + nodal)',
    xaxis: { title: useDates ? 'Date' : 'Time, days' },
    yaxis: { title: 'Rate MMscf/d · Gp Bscf', rangemode: 'tozero' },
    yaxis2: { title: 'Pres · FTHP, psi', overlaying: 'y', side: 'right', showgrid: false, titlefont: { color: '#00636D' }, tickfont: { color: '#00636D' } },
  });
  mobileShowResults();
  renderTables('gas-table-fc', [
    {
      title: 'Forecast', headers: ['date', 'q MMscf/d', 'Pres', 'p/Z', 'Pwf', 'FTHP', 'FTHT °F', 'Gp Bscf', 'plateau'],
      rows: r.rows.map((p) => [
        useDates ? dayToDateStr(p.tDays) : fmt(p.dtDays, 0),
        fmt(p.qMMscfd, 2), fmt(p.presPsi, 0), fmt(p.pOverZ, 0), fmt(p.pwfPsi, 0),
        // on plateau the well is choked, so the FTHP is BACK-SOLVED from the
        // produced rate and Pwf and is higher than the forecast FTHP input;
        // off plateau it is the input by construction. Flag the solved ones.
        fmt(p.fthpPsi, 0) + (p.fthpSource === 'solved' ? '*' : ''),
        fmt(p.fthtF, 1),
        fmt(p.gpBscf, 2), p.onPlateau ? 'yes' : '',
      ]),
    },
  ]);
}

async function gasSolve() {
  const f = gasForm();
  const r = await api('gas/nodal', f);
  summary('gas-summary', [
    { k: 'Operating rate', v: r.op ? `${fmt(r.op.qMMscfd, 2)} MMscf/d` : r.opStatus, warn: !r.op },
    { k: 'Operating Pwf', v: r.op ? `${fmt(r.op.pwfPsi, 0)} psi` : '—' },
    { k: 'WHT (calc)', v: r.op ? `${fmt(r.op.whtF, 1)} °F` : '—' },
    r.ipr.mode === 'j'
      ? { k: 'J Darcy', v: r.ipr.j?.toExponential(3) }
      : { k: 'C / n', v: `${r.ipr.c?.toExponential(3)} / ${fmt(r.ipr.n, 3)}` },
    { k: 'AOF', v: `${fmt(r.aofMMscfd, 2)} MMscf/d` },
    r.multiLayer ? { k: 'Pr avg (multi-layer)', v: `${fmt(r.multiLayer.prAvgPsi, 0)} psi` } : null,
    r.multiLayer ? { k: 'J final (exact)', v: r.multiLayer.jFinal?.toExponential(3) } : null,
    r.multiLayer ? { k: 'Blended CGR / WGR', v: `${fmt(r.multiLayer.blended.cgrStbMMscf, 1)} / ${fmt(r.multiLayer.blended.wgrStbMMscf, 2)}` } : null,
    r.multiLayer?.layersAtOp?.warnings?.length
      ? { k: 'Crossflow', v: r.multiLayer.layersAtOp.warnings[0], warn: true }
      : null,
  ]);
  plotNodal('gas-chart-nodal', 'Gas rate, MMscf/d', r.iprCurve, r.vlpCurve,
    r.op ? { q: r.op.qMMscfd, pwfPsi: r.op.pwfPsi } : null,
    (p) => p.qMMscfd, (p) => p.q,
    { extra: mlLayerTraces(r, (p) => p.qMMscfd) });
  plotWhp('gas-chart-whp', 'Gas rate, MMscf/d', r.whpCurve, Number(val('gas-thpPsi')));
  setComputed('gas-prPsi', r.computed.prPsi, 1);
  const gasNodalTables = [
    {
      title: 'IPR', headers: ['Pwf psi', 'q MMscf/d'],
      rows: r.iprCurve.map((p) => [fmt(p.pwfPsi, 1), fmt(p.qMMscfd, 3)]),
    },
    {
      title: 'VLP', headers: ['q MMscf/d', 'Pwf psi'],
      rows: r.vlpCurve.map((p) => [fmt(p.q, 3), fmt(p.pwfPsi, 1)]),
    },
  ];
  if (r.multiLayer?.layersAtOp) {
    const lay = r.multiLayer.layersAtOp.layers;
    const props = r.multiLayer.curves?.layers ?? [];
    const tot = r.multiLayer.layersAtOp.totals;
    // signed share, exactly as the oil table: a thief zone takes a negative
    // percentage so the column still sums to 100%
    gasNodalTables.unshift({
      title: `Layers @ operating Pwf ${r.op ? fmt(r.op.pwfPsi, 0) + ' psi' : ''}`,
      headers: ['layer', 'Pr psi', 'J', 'q MMscf/d', 'cond stb/d', 'water stb/d', '% of gas', 'state'],
      rows: lay.map((l, i) => {
        const xflow = l.qMMscfd < 0;
        const share = tot.qMMscfd !== 0 ? (l.qMMscfd / tot.qMMscfd) * 100 : null;
        return [
          l.name,
          fmt(props[i]?.prPsi, 0),
          fmt(props[i]?.j, 6),
          fmt(l.qMMscfd, 3),
          fmt(l.qCondStbD, 0),
          fmt(l.qWaterStbD, 0),
          share == null ? '—' : fmt(share, 1),
          xflow ? 'CROSSFLOW — taking gas in' : 'producing',
        ];
      }),
      rowClass: (row, i) => (lay[i].qMMscfd < 0 ? 'crossflow' : ''),
    });
  }
  renderTables('gas-table-nodal', gasNodalTables);
  renderTables('gas-table-whp', [
    {
      title: 'Wellhead PQ & WHT', headers: ['q MMscf/d', 'WHP psi', 'WHT °F', 'Pwf IPR', 'Pwf VLP'],
      rows: r.whpCurve.map((p) => [fmt(p.q, 3), fmt(p.whpPsi, 1), fmt(p.whtF, 1), fmt(p.pwfIprPsi, 1), fmt(p.pwfVlpPsi, 1)]),
    },
  ]);
}

async function gasCalibrate() {
  const r = await api('gas/calibrate', gasForm());
  document.getElementById('gas-cal-result').textContent =
    `J (Pr², n=1 basis) = ${r.jTest.toExponential(4)} Mscf/d/psi²\n` +
    `Matched K = ${fmt(r.matchedPermMd, 3)} mD at skin ${r.skinUsed} — applied to the K input.\n` +
    (r.c != null
      ? `C&n (calculated): C = ${r.c.toExponential(4)}, n = ${fmt(r.n, 4)}, AOF = ${fmt(r.qMaxMMscfd, 2)} MMscf/d\n`
      : 'C&n needs at least 2 test points.\n') +
    r.points.map((p) => `q=${p.qMMscfd}: Pwf=${fmt(p.pwfPsi, 1)} (${p.pwfSource})`).join('\n');
  // actual matched K becomes the K input (Darcy Pr² is the main J)
  document.getElementById('gas-permMd').value = r.matchedPermMd.toFixed(4);
  // calculated C & n appear grayed in their cells; test-table Pwf's too
  if (r.c != null) {
    setComputed('gas-cValue', r.c, 'exp');
    setComputed('gas-nValue', r.n, 4);
  }
  r.points.forEach((p, i) => {
    if (p.pwfSource === 'calculated') setComputed(`gas-test-${i}-pwfPsi`, p.pwfPsi, 1);
  });
  // multi-layer fit: total J_t fitted to the test J, layer K's are the solver
  if (r.mlFit) {
    document.getElementById('gas-cal-result').textContent +=
      `\nMulti-layer fit: J test @ PrAvg ${fmt(r.mlFit.prAvgPsi, 0)} psi = ${r.mlFit.jTestMl.toExponential(4)}; ` +
      `total J was ${r.mlFit.jFinal.toExponential(4)} → all layer K's scaled ×${fmt(r.mlFit.scale, 4)}:\n` +
      r.mlFit.layers.map((l) => `L${l.idx + 1}: K ${fmt(l.kOld, 2)} → ${fmt(l.kNew, 3)} mD`).join('\n');
    r.mlFit.layers.forEach((l) => {
      const el = document.getElementById(`gas-ml-${l.idx}-permMd`);
      if (el) el.value = l.kNew.toFixed(4);
    });
  }
}

/** Gas sensitivities: the nodal solution per VLP set, against the CURRENT
 *  IPR — the same table the oil and water tabs show, and the same solutions
 *  the diamond nodes mark on the chart. */
function renderGasSensTable(r) {
  const fam = r.vlpFamily ?? [];
  const row = document.getElementById('gas-cr-sens');
  if (row) row.style.display = '';
  renderTables('gas-table-sens', [{
    title: 'Nodal solution per VLP set (at current Pr)',
    headers: ['set', 'q MMscf/d', 'Pwf psi', 'WHP psi', 'WHT °F'],
    rows: fam.map((m) =>
      m.op
        ? [m.label, fmt(m.op.qMMscfd, 2), fmt(m.op.pwfPsi, 1), fmt(m.op.whpPsi, 1), fmt(m.op.whtF, 1)]
        : [m.label, m.opStatus ?? '—', '—', '—', '—']
    ),
  }]);
}

async function gasSens() {
  const body = gasForm();
  body.vlpSets = collectSens('gas', GAS_SENS_COLS, GAS_SENS_ROWS.length);
  body.presList = collectPres('gas', 3);
  const r = await api('gas/sensitivity', body);
  plotSens('gas-chart-sens', 'Gas rate, MMscf/d', r.iprFamily, r.vlpFamily, (p) => p.qMMscfd, { priPsi: r.priPsi, opQ: (o) => o.qMMscfd });
  renderGasSensTable(r);
}

// ---------- init ----------

// ---- case Save as / Open: the full UI state as a JSON file ----
/* ---- session persistence: the form survives a refresh ------------------
 * Every input is autosaved (debounced) and restored on load, so a reload no
 * longer discards typed work. It reuses the Save-as/Open serialisation rather
 * than a second one, so anything those handle, this handles.
 * Storage can throw outright (private mode, quota, blocked site data), so
 * every access is guarded and failure simply means "start from defaults".
 */
const SESSION_KEY = 'wellsim.session.v1';
let sessionTimer = null;
let restoringSession = false;

function saveSession() {
  if (restoringSession) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(collectCase()));
  } catch { /* private mode, quota, or site data blocked — not worth reporting */ }
}

const saveSessionSoon = () => {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 400);
};

/** true if a previous session was restored. */
function restoreSession() {
  let c = null;
  try {
    c = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch { return false; }
  if (!c || c.app !== 'WellSim' || c.version !== 1) return false;
  restoringSession = true;
  try {
    applyCase(c);
    return true;
  } catch {
    // a stored state the current build cannot apply must not brick the app
    clearSession();
    return false;
  } finally {
    restoringSession = false;
  }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* nothing to clear */ }
}

/** Header "Reset": forget the saved session and reload into the demo case. */
function resetToDefaults() {
  clearSession();
  location.reload();
}

function collectCase() {
  const c = {
    app: 'WellSim',
    version: 1,
    savedAt: new Date().toISOString(),
    activeTab: ['oil', 'water', 'gas'].find(
      (t) => document.getElementById(`panel-${t}`).style.display !== 'none'
    ) ?? 'oil',
    inputs: {},
    computed: [],
    radios: {},
    selects: {},
    grids: { gasProd: readProdValues(), oilProd: readOilProdValues() },
  };
  document.querySelectorAll('main input[id], main select[id]').forEach((el) => {
    if (el.type === 'radio' || el.type === 'checkbox' || el.type === 'file') return;
    if (el.tagName === 'SELECT') { c.selects[el.id] = el.value; return; }
    if (el.classList.contains('outcell')) return; // pure outputs
    if (el.dataset.computed === '1') { c.computed.push(el.id); return; } // stays program-filled
    c.inputs[el.id] = el.value;
  });
  document.querySelectorAll('main input[type=radio]:checked').forEach((el) => {
    c.radios[el.name] = el.value;
  });
  return c;
}

function applyCase(c) {
  // dynamic tables first (their row count defines which cell ids exist)
  if (c.grids?.gasProd) renderProdTable(c.grids.gasProd);
  if (c.grids?.oilProd) renderOilProdTable(c.grids.oilProd);
  for (const [name, v] of Object.entries(c.radios ?? {})) {
    const el = document.querySelector(`input[name="${name}"][value="${v}"]`);
    if (el) el.checked = true;
  }
  for (const [id, v] of Object.entries(c.selects ?? {})) {
    const el = document.getElementById(id);
    if (el) el.value = v;
  }
  for (const [id, v] of Object.entries(c.inputs ?? {})) {
    const el = document.getElementById(id);
    if (el) {
      el.value = v;
      delete el.dataset.computed;
      el.classList.remove('computed');
    }
  }
  for (const id of c.computed ?? []) {
    const el = document.getElementById(id);
    if (el) { el.value = ''; delete el.dataset.computed; el.classList.remove('computed'); }
  }
  // re-apply every view switch to the restored state
  switchTab(c.activeTab ?? 'oil');
  switchOilModule();
  switchLift();
  switchOilIprBasis();
  switchOilPresSource();
  switchMl('oil');
  switchMl('gas');
  switchEspPump();
  switchEspTab();
  switchWaterType();
  switchWaterLift();
  switchGasModule();
  switchGasPresSource();
  switchGasIpr();
}

function exportFieldMeta() {
  const metadata = {};
  document.querySelectorAll('main input[id], main select[id]').forEach((el) => {
    const row = el.closest('.frow');
    const labelEl = row?.querySelector('label');
    const unit = labelEl?.querySelector('.unit')?.textContent?.trim() ?? '';
    const label = labelEl?.firstChild?.textContent?.trim() || el.id;
    const panel = el.closest('.panel')?.id?.replace(/^panel-/, '') || 'case';
    metadata[el.id] = { label, unit, section: panel, valueType: unit ? 'number' : 'text' };
  });
  return metadata;
}

function caseExportArtifact(formatId, baseName) {
  if (!globalThis.WellSimExport) throw new Error('export service did not load');
  return globalThis.WellSimExport.createArtifact(collectCase(), formatId, {
    baseName,
    fieldMeta: exportFieldMeta(),
  });
}

function downloadArtifact(artifact) {
  const blob = new Blob([artifact.content], { type: artifact.mediaType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = artifact.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function saveCaseAs() {
  let name;
  try { name = prompt('Save case as', 'wellsim-case.json'); } catch { name = 'wellsim-case.json'; }
  if (name === null) return; // cancelled
  if (!name) name = 'wellsim-case.json';
  try {
    const artifact = caseExportArtifact('case-json', name);
    downloadArtifact(artifact);
    showOk(`Downloaded ${artifact.filename}`);
  } catch (e) {
    showError(`could not export case: ${e.message}`);
  }
}

function syncExportFormat() {
  const format = globalThis.WellSimExport?.formats.find(
    (candidate) => candidate.id === document.getElementById('export-format').value
  );
  document.getElementById('export-note').textContent = format?.description ?? '';
}

function initExportPanel() {
  const select = document.getElementById('export-format');
  const formats = globalThis.WellSimExport?.formatsFor('case') ?? [];
  select.innerHTML = formats.map((format) => `<option value="${format.id}">${format.label}</option>`).join('');
  syncExportFormat();
}

function toggleExportPanel(force) {
  const panel = document.getElementById('export-panel');
  const show = force ?? panel.style.display === 'none';
  panel.style.display = show ? '' : 'none';
  if (show) {
    document.getElementById('acct-panel').style.display = 'none';
    const name = document.getElementById('export-name');
    if (!name.value.trim() || name.value === 'wellsim-case') name.value = `wellsim-${collectCase().activeTab}-case`;
  }
}

function exportCurrentCase() {
  try {
    const artifact = caseExportArtifact(
      document.getElementById('export-format').value,
      document.getElementById('export-name').value
    );
    downloadArtifact(artifact);
    toggleExportPanel(false);
    showOk(`Downloaded ${artifact.filename}`);
  } catch (e) {
    showError(`could not export case: ${e.message}`);
  }
}

function openCaseFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const c = JSON.parse(rd.result);
      if (c.app !== 'WellSim') throw new Error('not a WellSim case file');
      applyCase(c);
      showError('');
    } catch (e) {
      showError(`could not open case: ${e.message}`);
    }
  };
  rd.readAsText(file);
}

// ---- account: per-company server case database (free use stays) ----
let acct = null;
try { acct = JSON.parse(localStorage.getItem('wellsimAcct') || 'null'); } catch { acct = null; }

// The legacy web case store is disabled by default while the PostgreSQL/RBAC
// replacement is built. The portable program reports its own local case-store
// capability through the same endpoint, so the shared UI keeps working there.
let acctCapabilities = { enabled: false, registrationEnabled: false, mode: 'web' };

function acctUi() {
  const link = document.getElementById('acct-link');
  const panel = document.getElementById('acct-panel');
  link.style.display = acctCapabilities.enabled ? '' : 'none';
  if (!acctCapabilities.enabled) panel.style.display = 'none';

  const portable = acctCapabilities.mode === 'portable';
  link.textContent = portable ? 'Cases' : acct ? `${acct.username}@${acct.company}` : 'Sign in';
  document.getElementById('acct-out').style.display = acct ? 'none' : '';
  document.getElementById('acct-in').style.display = acct ? '' : 'none';
  if (acct)
    document.getElementById('acct-who').textContent = portable
      ? 'Cases saved beside the program'
      : `${acct.username} @ ${acct.company} — company cases`;

  const registerButton = document.getElementById('acct-register');
  const companyInput = document.getElementById('acct-company');
  const inviteInput = document.getElementById('acct-invite');
  const canRegister = acctCapabilities.registrationEnabled && !portable;
  registerButton.style.display = canRegister ? '' : 'none';
  companyInput.style.display = canRegister ? '' : 'none';
  inviteInput.style.display = canRegister ? '' : 'none';
  document.getElementById('acct-note').textContent = portable
    ? 'Cases are stored in the cases folder beside the program.'
    : canRegister
      ? 'Registration is invite-only. Visitor calculations and Save as / Open need no account.'
      : 'Registration is closed. Visitor calculations and Save as / Open need no account.';

  const signout = document.getElementById('acct-signout');
  if (signout) signout.style.display = portable ? 'none' : '';
}

async function acctLoadCapabilities() {
  try {
    const res = await fetch('/api/accounts/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const status = await res.json();
    if (!status.error) acctCapabilities = status;
  } catch { /* old/offline server: leave the legacy store hidden */ }

  if (!acctCapabilities.enabled && acct) {
    acct = null;
    try { localStorage.removeItem('wellsimAcct'); } catch { /* storage unavailable */ }
  }
  acctUi();
}

function acctSet(a) {
  acct = a;
  try {
    if (a) localStorage.setItem('wellsimAcct', JSON.stringify(a));
    else localStorage.removeItem('wellsimAcct');
  } catch { /* storage unavailable */ }
  acctUi();
}

async function acctAuth(pathName) {
  const r = await api(pathName, {
    company: val('acct-company'),
    username: val('acct-user'),
    password: document.getElementById('acct-pass').value,
    invite: document.getElementById('acct-invite').value,
  });
  acctSet({ token: r.token, company: r.company, username: r.username });
  document.getElementById('acct-pass').value = '';
  await acctRefresh();
}

async function acctRefresh() {
  if (!acct) return;
  let r;
  try {
    r = await api('cases/list', { token: acct.token });
  } catch {
    acctSet(null); // token expired (server restart) -> sign in again
    return;
  }
  const box = document.getElementById('acct-cases');
  box.innerHTML = r.cases.length
    ? r.cases
        .map(
          (c, i) =>
            `<div class="case-row"><span class="nm" title="${c.name}">${c.name}</span>` +
            `<span class="meta">${c.savedBy ?? ''} ${c.savedAt ? c.savedAt.slice(0, 10) : ''}</span>` +
            `<button class="copybtn" data-load="${c.name}">Load</button>` +
            `<button class="copybtn" data-del="${c.name}">Del</button></div>`
        )
        .join('')
    : '<div class="acct-note">no cases saved yet</div>';
  // only the newest two rows are visible (see style.css) — say how many
  // there are, or the rest are invisible as well as out of view
  const head = document.getElementById('acct-caseshead');
  if (head)
    head.textContent = r.cases.length
      ? `${r.cases.length} case${r.cases.length === 1 ? '' : 's'} \u00b7 newest first${r.cases.length > 2 ? ' \u00b7 scroll for older' : ''}`
      : '';
  box.querySelectorAll('[data-load]').forEach((b) => (b.onclick = guard(async () => {
    const r2 = await api('cases/load', { token: acct.token, name: b.dataset.load });
    applyCase(r2.case);
    document.getElementById('acct-case-name').value = r2.name;
    document.getElementById('acct-panel').style.display = 'none';
    showOk(`Loaded \u201c${r2.name}\u201d`);
  })));
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = guard(async () => {
    await api('cases/delete', { token: acct.token, name: b.dataset.del });
    await acctRefresh();
  })));
}

async function acctSaveCase() {
  if (!acct) return;
  const name = val('acct-case-name');
  if (!name) { showError('enter a case name'); return; }
  await api('cases/save', { token: acct.token, name, case: collectCase() });
  await acctRefresh();
  // close the panel once the save lands: it used to sit over the app until
  // the user dismissed it by hand. The NAME stays in the box so the case
  // you are working on is still tracked when you reopen.
  document.getElementById('acct-panel').style.display = 'none';
  showOk(`Saved \u201c${name}\u201d to ${acct.company}`);
}

// Plotly sizes a chart to its container AT DRAW TIME and afterwards only
// reacts to window resizes. So a chart drawn while its panel was hidden —
// or one whose row later changes width (the half-page reserve grid, the
// two-column layout) — keeps a stale SVG: too narrow leaves dead space,
// too wide SPILLS OVER the table beside it. Re-fit on demand...
// ...by re-fitting any VISIBLE chart whose drawing no longer matches its
// box. Mismatch-driven rather than blind, so it is cheap enough to run
// after every render as well as on every tab/module switch — that is what
// catches a solve which finished while its panel was still hidden (Plotly
// then draws at its 700 px fallback and would otherwise stay that way).
/**
 * Re-fit every visible chart: canvas to its container, then title and legend.
 * The startup solve draws before web fonts and the flex layout have settled,
 * so the first paint can be a size out — visible as a jump a few seconds
 * after every page load. Plotly's own responsive handler eventually corrects
 * the CANVAS but never re-runs our title/legend fitting, so this is wired to
 * fonts-ready, window load and resize below.
 */
function refitCharts() {
  document.querySelectorAll('.chart').forEach((el) => {
    if (!el.data || el.offsetParent === null) return;
    const boxW = el.getBoundingClientRect().width;
    if (boxW <= 0) return;
    const svg = el.querySelector('svg.main-svg');
    if (!svg || Math.abs(svg.getBoundingClientRect().width - boxW) > 2) {
      Promise.resolve(Plotly.Plots.resize(el)).then(() => tunePhoneChart(el));
    } else {
      tunePhoneChart(el);
    }
  });
}

// nothing called refitCharts before this: charts were left at whatever size
// they were first drawn at, and the fitters never re-ran on a window resize
let refitTimer = null;
const refitSoon = () => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(refitCharts, 150);
};
if (document.fonts?.ready) document.fonts.ready.then(refitCharts).catch(() => {});
window.addEventListener('load', refitCharts);
window.addEventListener('resize', refitSoon);
window.addEventListener('orientationchange', refitSoon);


/** Title (any width) and legend (phone) fitting, applied to a chart that
 *  is on screen NOW.
 *  Charts drawn while their half of the mobile view was hidden could not
 *  be measured at draw time, so this runs again whenever they surface. */
function tunePhoneChart(el) {
  if (!el.data || el.offsetParent === null) return Promise.resolve(el);
  return fitChartTitle(el).then(() => fitChartLegend(el));
}

function resizeVisibleCharts() {
  requestAnimationFrame(refitCharts);
  // a second pass once the layout has settled (panel shown, fonts applied)
  setTimeout(refitCharts, 250);
}

// ...and automatically: watch every chart's own box and re-fit whenever it
// no longer matches the drawing. Phones keep their deliberately fixed
// chart size (LAYOUT sets width there), so this only governs wider screens.
const chartResizeObserver =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
        if (window.innerWidth < 640) return;
        for (const entry of entries) {
          const el = entry.target;
          if (!el.data || el.offsetParent === null) continue;
          const svg = el.querySelector('svg.main-svg');
          if (!svg) continue;
          const boxW = el.getBoundingClientRect().width;
          if (boxW > 0 && Math.abs(svg.getBoundingClientRect().width - boxW) > 2)
            requestAnimationFrame(() => Plotly.Plots.resize(el));
        }
      });

function observeCharts() {
  if (!chartResizeObserver) return;
  document.querySelectorAll('.chart').forEach((el) => chartResizeObserver.observe(el));
}

function switchTab(which) {
  for (const t of ['oil', 'water', 'gas']) {
    document.getElementById(`panel-${t}`).style.display = which === t ? '' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('active', which === t);
  }
  resizeVisibleCharts();
}

// The 69-pump catalog is fetched async at startup, but oilForm()/waterForm()
// read the pump NAME synchronously — so any ESP action firing before the
// fetch lands sent an empty name and the user saw
//   pump "" not in the database
// once, on the startup solve or an early lift switch (re-clicking Solve
// cleared it). Every button and the startup solve go through guard(), so
// gating here closes every path at once. A failed fetch still resolves —
// loadEspPumps falls back to Manual dP — so this can never hang the UI.
let espPumpsReady = null;
function guard(fn) {
  return async () => {
    try { await espPumpsReady; } catch { /* catalog unavailable: forms fall back to manual */ }
    return fn().catch((e) => console.error(e));
  };
}

renderForm('oil-form', 'oil', OIL_SCHEMA);
renderFieldRow('water-ipr-common', 'water', WATER_IPR_COMMON_FIELDS);
renderFieldRow('water-ipr-darcy', 'water', WATER_IPR_DARCY_FIELDS);
renderFieldRow('oil-ipr-common', 'oil', OIL_IPR_COMMON_FIELDS);
renderFieldRow('oil-ipr-darcy', 'oil', OIL_IPR_DARCY_FIELDS);
renderFieldRow('oil-test', 'oil', OIL_TEST_FIELDS);
renderFieldRow('oil-gl-fields', 'oil', OIL_GL_WELL_FIELDS);
renderFieldRow('oil-gl-inputs', 'oil', OIL_GL_FIELDS);
renderFieldRow('oil-esp-fields', 'oil', OIL_ESP_FIELDS);
renderFieldRow('oil-esp-custom-fields', 'oil', OIL_ESP_CUSTOM_FIELDS);
renderFieldRow('oil-esp-manual-fields', 'oil', OIL_ESP_MANUAL_FIELDS);
/** Colour the custom-curve rows that carry the thrust markers. The ESP
 *  physics reads FIXED positions of the points array (esp-catalog THRUST:
 *  index 3 = down-thrust limit, 5 = BEP, 7 = up-thrust limit — the
 *  workbook ESP sheet's own row labels), so the user entering a custom
 *  pump must know which rows those are. */
function decorateThrustRows(tableId) {
  const t = document.getElementById(tableId);
  if (!t) return;
  const MARKS = { 3: ['thrust-down', '\u2193 down-thrust'], 5: ['thrust-bep', 'BEP'], 7: ['thrust-up', '\u2191 up-thrust'] };
  const rows = t.rows;
  rows[0].insertAdjacentHTML('afterbegin', '<th></th>');
  for (let i = 1; i < rows.length; i++) {
    const m = MARKS[i - 1];
    rows[i].insertAdjacentHTML('afterbegin', `<td class="thrust-cell">${m ? m[1] : ''}</td>`);
    if (m) rows[i].classList.add(m[0]);
  }
  t.insertAdjacentHTML(
    'afterend',
    '<div class="thrust-legend">' +
      '<span><span class="sw" style="background:#E8F0FB"></span>down-thrust limit (row 4)</span>' +
      '<span><span class="sw" style="background:#FFF3D6"></span>best-efficiency point (row 6)</span>' +
      '<span><span class="sw" style="background:#FBE9E7"></span>up-thrust limit (row 8)</span>' +
      '</div>'
  );
}
renderGridTable('oil-espcurve-table', 'oil-espcurve', ESP_CURVE_COLS, ESP_CURVE_ROWS);
renderGridTable('water-espcurve-table', 'water-espcurve', ESP_CURVE_COLS, ESP_CURVE_ROWS);
renderFieldRow('water-esp-custom-fields', 'water', WATER_ESP_CUSTOM_FIELDS);
decorateThrustRows('oil-espcurve-table');
decorateThrustRows('water-espcurve-table');
document.getElementById('oil-espPumpSel').onchange = switchEspPump;
espPumpsReady = loadEspPumps();
refreshOilSens();
renderPresList('oil-pres-list', 'oil', [2662.5, 1775, 887.5]);
document.querySelectorAll('input[name="oil-lift"]').forEach((r) => (r.onchange = switchLift));
switchLift();
// Water Well tab
renderForm('water-form', 'water', WATER_SCHEMA);
renderFieldRow('water-test', 'water', WATER_TEST_FIELDS);
renderFieldRow('water-gl-fields', 'water', OIL_GL_WELL_FIELDS);
renderFieldRow('water-gl-inputs', 'water', OIL_GL_FIELDS);
renderFieldRow('water-esp-fields', 'water', WATER_ESP_FIELDS);
renderFieldRow('water-esp-manual-fields', 'water', WATER_ESP_MANUAL_FIELDS);
document.getElementById('water-espPumpSel').onchange = switchWaterEspPump;
document.querySelectorAll('input[name="oil-iprbasis"]').forEach((r) => (r.onchange = switchOilIprBasis));
document.querySelectorAll('input[name="water-iprbasis"]').forEach((r) => (r.onchange = switchWaterIprBasis));
switchOilIprBasis(); // initial view: hide the PI row on the darcy default
switchWaterIprBasis();
document.getElementById('water-btn-espstages').onclick = guard(waterEspStagesRun);
refreshWaterSens();
renderPresList('water-pres-list', 'water', [3600, 2400, 1200]); // 0.75/0.5/0.25 x Pri 4800
document.querySelectorAll('input[name="water-lift"]').forEach((r) => (r.onchange = switchWaterLift));
switchWaterLift();
document.querySelectorAll('input[name="water-welltype"]').forEach((r) => (r.onchange = switchWaterType));
switchWaterType();

// oil Reserve estimate module
renderOilProdTable(OIL_PROD_DEFAULTS);
renderPresList('oil-esppres-list', 'oil-esp', ESP_PRES_FRACTIONS.map((x) => Math.round(3550 * x)));
const oilStaticTable = dynamicTable({ tableId: 'oil-static-table', prefix: 'oil-static', cols: OIL_STATIC_COLS, defaults: OIL_STATIC_ROWS });
renderFieldRow('oil-rlt-fields', 'oil', OIL_RLT_FIELDS);
renderFieldRow('oil-fc-fields', 'oil', OIL_FC_FIELDS);
document.getElementById('oil-prod-table').addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') ?? '';
  if (!text.includes('\n') && !text.includes('\t')) return; // single value: default behavior
  e.preventDefault();
  const m = e.target?.id?.match(/^oil-prod-(\d+)-/);
  fillOilProdRows(parseOilProdClipboard(text), m ? Number(m[1]) : 0);
});
document.getElementById('oil-prod-paste').onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    fillOilProdRows(parseOilProdClipboard(text), 0);
  } catch {
    showError('Clipboard read not permitted — click a cell in the table and press Ctrl+V instead.');
  }
};
document.getElementById('oil-prod-add').onclick = () => ensureOilProdRows(oilProdCount + 10);
document.getElementById('oil-prod-clear').onclick = () => renderOilProdTable([{}, {}, {}, {}, {}, {}, {}, {}]);
document.querySelectorAll('input[name="oil-pressource"]').forEach((r) => (r.onchange = switchOilPresSource));
switchOilPresSource();
document.querySelectorAll('input[name="oil-module"]').forEach((r) => (r.onchange = switchOilModule));
switchOilModule();

renderForm('gas-form', 'gas', GAS_SCHEMA);
renderFieldRow('gas-darcy-fields', 'gas', GAS_DARCY_FIELDS);
// multi-layer IPR editors
renderGridTable('oil-ml-table', 'oil-ml', OIL_ML_COLS, OIL_ML_ROWS);
renderGridTable('gas-ml-table', 'gas-ml', GAS_ML_COLS, GAS_ML_ROWS);
document.querySelectorAll('input[name="oil-mlmode"]').forEach((r) => (r.onchange = () => switchMl('oil')));
document.querySelectorAll('input[name="gas-mlmode"]').forEach((r) => (r.onchange = () => switchMl('gas')));
switchMl('oil');
switchMl('gas');
renderFieldRow('gas-cn-fields', 'gas', GAS_CN_FIELDS);
renderTestTable('gas-test-table', 'gas', GAS_TEST_ROWS);
renderSensTable('gas-sens-table', 'gas', GAS_SENS_COLS, GAS_SENS_ROWS);
renderPresList('gas-pres-list', 'gas', [2850, 1900, 950]);
renderProdTable(GAS_PROD_DEFAULTS);
const gasSithpTable = dynamicTable({ tableId: 'gas-sithp-table', prefix: 'gas-sithp', cols: SITHP_COLS, defaults: GAS_SITHP_ROWS });
const gasGaugeTable = dynamicTable({ tableId: 'gas-gauge-table', prefix: 'gas-gauge', cols: GAS_GAUGE_COLS, defaults: GAS_GAUGE_ROWS });
// clipboard paste into the prod table (Ctrl+V in any cell, or the button)
document.getElementById('gas-prod-table').addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') ?? '';
  if (!text.includes('\n') && !text.includes('\t')) return; // single value: default behavior
  e.preventDefault();
  const m = e.target?.id?.match(/^gas-prod-(\d+)-/);
  fillProdRows(parseProdClipboard(text), m ? Number(m[1]) : 0);
});
document.getElementById('gas-prod-paste').onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    fillProdRows(parseProdClipboard(text), 0);
  } catch {
    showError('Clipboard read not permitted — click a cell in the table and press Ctrl+V instead.');
  }
};
document.getElementById('gas-prod-add').onclick = () => ensureProdRows(gasProdCount + 10);
document.getElementById('gas-prod-clear').onclick = () => renderProdTable([{}, {}, {}, {}, {}, {}, {}, {}]);
renderFieldRow('gas-rlt-fields', 'gas', GAS_RLT_FIELDS);
renderFieldRow('gas-fc-fields', 'gas', GAS_FC_FIELDS);
document.querySelectorAll('input[name="gas-pressource"]').forEach((r) => (r.onchange = switchGasPresSource));
switchGasPresSource();
document.querySelectorAll('input[name="gas-iprmode"]').forEach((r) => (r.onchange = switchGasIpr));
switchGasIpr();
document.querySelectorAll('input[name="gas-module"]').forEach((r) => (r.onchange = switchGasModule));
switchGasModule();

// the future-pressure lists follow the reservoir pressure as it is edited
for (const prefix of ['oil', 'water', 'gas'])
  for (const k of ['prPsi', 'priPsi']) {
    const el = document.getElementById(`${prefix}-${k}`);
    if (el) el.addEventListener('input', () => {
      refreshPresDefaults(prefix);
      if (prefix === 'oil') refreshPresDefaults('oil-esp', 'oil-prPsi', 'oil-priPsi', ESP_PRES_FRACTIONS);
    });
  }
document.getElementById('tab-oil').onclick = () => switchTab('oil');
document.getElementById('tab-water').onclick = () => switchTab('water');
document.getElementById('tab-gas').onclick = () => switchTab('gas');
document.getElementById('mb-inputs').onclick = () => setMobileView('inputs');
document.getElementById('mb-results').onclick = () => setMobileView('results');
document.getElementById('save-case').onclick = (e) => { e.preventDefault(); saveCaseAs(); };
document.getElementById('open-case').onclick = (e) => { e.preventDefault(); document.getElementById('open-case-file').click(); };
document.getElementById('export-link').onclick = (e) => { e.preventDefault(); toggleExportPanel(); };
document.getElementById('export-format').onchange = syncExportFormat;
document.getElementById('export-download').onclick = exportCurrentCase;
document.getElementById('export-close').onclick = () => toggleExportPanel(false);
initExportPanel();
document.getElementById('open-case-file').onchange = (e) => {
  if (e.target.files?.[0]) openCaseFile(e.target.files[0]);
  e.target.value = '';
};
document.getElementById('acct-link').onclick = (e) => {
  e.preventDefault();
  if (!acctCapabilities.enabled) return;
  toggleExportPanel(false);
  const p = document.getElementById('acct-panel');
  p.style.display = p.style.display === 'none' ? '' : 'none';
  if (p.style.display !== 'none' && acct) acctRefresh();
};
document.getElementById('acct-login').onclick = guard(() => acctAuth('auth/login'));
document.getElementById('acct-register').onclick = guard(() => acctAuth('auth/register'));
document.getElementById('acct-signout').onclick = guard(async () => {
  if (acct) { try { await api('auth/logout', { token: acct.token }); } catch { /* already gone */ } }
  acctSet(null);
});
document.getElementById('acct-save').onclick = guard(acctSaveCase);
document.getElementById('acct-refresh').onclick = guard(acctRefresh);
acctUi();
acctLoadCapabilities();

// CSV import for the production tables (same column order as paste:
// Date, FTHP, rate, CGR|GOR, WGR|WC, Pwf; header line auto-skipped)
function csvImport(parse, fill) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.csv,.txt,text/csv';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => fill(parse(String(rd.result)), 0);
    rd.readAsText(f);
  };
  inp.click();
}
document.getElementById('gas-prod-csv').onclick = () => csvImport(parseProdClipboard, fillProdRows);
document.getElementById('oil-prod-csv').onclick = () => csvImport(parseOilProdClipboard, fillOilProdRows);

// printable report: hide the input column and chrome, keep summary + charts
document.getElementById('print-report').onclick = (e) => {
  e.preventDefault();
  window.print();
};
document.getElementById('water-btn-solve').onclick = guard(waterSolve);
document.getElementById('water-btn-calibrate').onclick = guard(waterCalibrate);
document.getElementById('water-btn-sens').onclick = guard(waterSens);
document.getElementById('water-btn-gl').onclick = guard(waterGl);
document.getElementById('oil-btn-solve').onclick = guard(oilSolve);
document.getElementById('oil-btn-calibrate').onclick = guard(oilCalibrate);
document.getElementById('oil-btn-sens').onclick = guard(oilSens);
document.getElementById('oil-btn-gl').onclick = guard(oilGl);
document.getElementById('oil-btn-reserve').onclick = guard(oilReserveRun);
document.getElementById('oil-btn-forecast').onclick = guard(oilForecastRun);
document.getElementById('oil-btn-espstages').onclick = guard(espStagesRun);
document.getElementById('oil-btn-espsens').onclick = guard(espSensRun);
document.querySelectorAll('input[name="oil-esptab"]').forEach((r) => (r.onchange = switchEspTab));
document.getElementById('oil-btn-espwear').onclick = guard(espWearRun);
document.getElementById('gas-btn-solve').onclick = guard(gasSolve);
document.getElementById('gas-btn-calibrate').onclick = guard(gasCalibrate);
document.getElementById('gas-btn-sens').onclick = guard(gasSens);
document.getElementById('gas-btn-reserve').onclick = guard(gasReserveRun);
document.getElementById('gas-btn-forecast').onclick = guard(gasForecastRun);

// keep every chart fitted to its own box, however the layout changes
observeCharts();

// autosave every edit, and offer a way back to the demo case
document.addEventListener('input', saveSessionSoon);
document.addEventListener('change', saveSessionSoon);
const resetLink = document.getElementById('reset-case');
if (resetLink) resetLink.onclick = (e) => { e.preventDefault(); resetToDefaults(); };

// restore the previous session BEFORE the first solve, so the solve runs on
// the restored inputs rather than the demo ones
restoreSession();

// installable + offline: registration is best-effort and never blocks the app
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // app.js runs at the end of body, so 'load' may ALREADY have fired — waiting
  // for it then means waiting forever and the worker never registers
  const registerSW = () => navigator.serviceWorker.register('/sw.js').catch(() => { /* blocked or unsupported */ });
  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);
}

// first load: solve whatever case we now hold (restored, or the prefilled demo)
guard(oilSolve)();
