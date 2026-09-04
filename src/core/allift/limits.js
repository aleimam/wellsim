// Artificial-lift screening envelopes — the GLOBAL, versioned band matrix.
//
// This is the reusable IP ported from the "limits" sheet of
// "Artificial Lift Method Selection_v07.xlsx" (M. El-Ashry, BAPETCO, 2020).
// It is data, not physics: heuristic screening bands that encode one team's
// judgement for onshore wells of that era. Because it is GLOBAL it must be
// version-stamped and recorded on every calculation run, so a screen done
// today still reproduces after the bands are later tuned. Editing a band is a
// RELEASED change (technical review), never a casual constant edit.
//
// A run MAY override any band per-run (with a recorded reason); those
// overrides live on the case revision, not here. See economics.js / the
// handler for how the version + any overrides are stamped onto the result.

export const LIMITS_VERSION = '1.0.0';

export const LIMITS_PROVENANCE =
  'Default screening bands v1 — from Artificial Lift Method Selection_v07.xlsx ' +
  '(BAPETCO, 2020), onshore Western-Desert assumptions. Advisory, not physical limits.';

// The eight screened parameters, in canonical units, grouped by the four
// selection "levels" (which is only how the workbook lays them out on its four
// charts — the technical verdict is the intersection across ALL of them).
export const PARAMS = [
  { key: 'qGrossStbD', label: 'Gross rate', unit: 'stb/d', level: 1 },
  { key: 'depthFt', label: 'Depth', unit: 'ft', level: 1 },
  { key: 'glr', label: 'GLR', unit: 'scf/stb', level: 2 },
  { key: 'whpPsi', label: 'WHP', unit: 'psi', level: 2 },
  { key: 'wcPct', label: 'Water cut', unit: '%', level: 3 },
  { key: 'gorScfStb', label: 'GOR', unit: 'scf/stb', level: 3 },
  { key: 'devDeg', label: 'Deviation', unit: 'deg', level: 4 },
  { key: 'dogLegDeg', label: 'Dog-leg', unit: 'deg/100ft', level: 4 },
];

export const LEVELS = [
  { level: 1, title: 'Depth + Gross Rate', params: ['depthFt', 'qGrossStbD'] },
  { level: 2, title: 'WHP + GLR', params: ['whpPsi', 'glr'] },
  { level: 3, title: 'Water-Cut + GOR', params: ['wcPct', 'gorScfStb'] },
  { level: 4, title: 'Deviation + Dog-Leg', params: ['devDeg', 'dogLegDeg'] },
];

// Method identity. `engine` marks which methods WellSim can actually DESIGN
// downstream; the rest are screened technically the same way (bands need no
// engine) but their economics come in as analyst clipboard input, never faked.
export const METHODS = [
  { key: 'ESP', label: 'ESP', engine: true },
  { key: 'GL', label: 'Gas Lift', engine: true },
  { key: 'SRP', label: 'Sucker Rod', engine: false },
  { key: 'JET', label: 'Jet Pump', engine: false },
  { key: 'PCP', label: 'PCP', engine: false },
];

// min/max per method per parameter. Nulls would mean "unbounded" (none here).
// Values are exactly the workbook's Min/Max columns; the workbook's third
// "typical/preferred" column is intentionally omitted from v1 (see README).
export const BANDS = {
  ESP: {
    qGrossStbD: [200, 8000], depthFt: [1000, 3700], glr: [1, 800], whpPsi: [15, 3000],
    wcPct: [0, 99], gorScfStb: [1, 80000], devDeg: [0.1, 70], dogLegDeg: [0.1, 8],
  },
  GL: {
    qGrossStbD: [50, 6500], depthFt: [1000, 3500], glr: [1, 1000], whpPsi: [15, 300],
    wcPct: [0, 99], gorScfStb: [1, 100000], devDeg: [0.1, 50], dogLegDeg: [0.1, 15],
  },
  SRP: {
    qGrossStbD: [25, 600], depthFt: [1000, 3100], glr: [1, 300], whpPsi: [15, 300],
    wcPct: [0, 99], gorScfStb: [1, 30000], devDeg: [0.1, 10], dogLegDeg: [0.1, 3],
  },
  JET: {
    qGrossStbD: [100, 4000], depthFt: [1000, 4000], glr: [1, 800], whpPsi: [15, 500],
    wcPct: [0, 99], gorScfStb: [1, 80000], devDeg: [0.1, 40], dogLegDeg: [0.1, 15],
  },
  PCP: {
    qGrossStbD: [10, 2000], depthFt: [1000, 2500], glr: [1, 400], whpPsi: [15, 500],
    wcPct: [0, 98.5], gorScfStb: [1, 26666.67], devDeg: [0.1, 6], dogLegDeg: [0.1, 3],
  },
};

/** The default global limits object as it is stamped onto a run. Per-run
 *  overrides are merged over `bands` by the caller, never mutated here. */
export function defaultLimits() {
  return { version: LIMITS_VERSION, provenance: LIMITS_PROVENANCE, bands: BANDS };
}
