// Artificial-lift TECHNICAL screen — pure, engine-free.
//
// A method passes a parameter when the well value sits inside that method's
// band. No physics lives here: Qgross is computed upstream (WellSim's IPR) and
// handed in as a plain number, exactly like every other screened parameter.
// The four "levels" are presentation only — the applicable verdict is the
// intersection across ALL parameters.
//
// Life-of-well: the workbook screens three snapshots (Initial / +6 mo / +1 yr)
// because W.C, GLR and rate migrate a well across band edges over its life.
// We keep that: `screenLifecycle` reports both a STRICT set (passes every
// parameter at every snapshot) and a PERMISSIVE set (passes at some snapshot),
// so the analyst sees a method that is fine now but marginal later.

import { METHODS, PARAMS, LEVELS, BANDS } from './limits.js';

const inBand = (v, [min, max]) => v != null && Number.isFinite(v) && v >= min && v <= max;

/** Screen one snapshot (a full 8-parameter well point) against one bands set.
 *  Returns, per method: the per-parameter pass/fail detail, per-level pass,
 *  and an overall pass (all parameters in band). */
export function screenSnapshot(point, bands = BANDS) {
  const methods = {};
  for (const { key: m } of METHODS) {
    const band = bands[m];
    const params = {};
    for (const p of PARAMS) {
      const value = point[p.key];
      const range = band[p.key];
      params[p.key] = { value, min: range[0], max: range[1], pass: inBand(value, range) };
    }
    const levels = {};
    for (const lv of LEVELS) levels[lv.level] = lv.params.every((k) => params[k].pass);
    const pass = PARAMS.every((p) => params[p.key].pass);
    // which parameters actually knocked it out — the "why not" for the UI
    const failedParams = PARAMS.filter((p) => !params[p.key].pass).map((p) => p.key);
    methods[m] = { pass, levels, params, failedParams };
  }
  return { methods };
}

/** Screen a well across its snapshots. `points` is an ordered array of full
 *  well points (Initial, +6mo, +1yr — any length >= 1). */
export function screenLifecycle(points, bands = BANDS) {
  const perSnapshot = points.map((pt) => screenSnapshot(pt, bands));
  const strict = [];      // passes all parameters at EVERY snapshot
  const permissive = [];  // passes all parameters at SOME snapshot
  const byMethod = {};
  for (const { key: m } of METHODS) {
    const passes = perSnapshot.map((s) => s.methods[m].pass);
    const everywhere = passes.every(Boolean);
    const somewhere = passes.some(Boolean);
    if (everywhere) strict.push(m);
    if (somewhere) permissive.push(m);
    // union of parameters that failed in ANY snapshot — the durable blockers
    const failedUnion = [
      ...new Set(perSnapshot.flatMap((s) => s.methods[m].failedParams)),
    ];
    // per-parameter life-of-well aggregate for the matrix: 'pass' (all
    // snapshots), 'fail' (none), 'partial' (some) — drives the UI cell colour
    const paramAgg = {};
    for (const p of PARAMS) {
      const ps = perSnapshot.map((s) => s.methods[m].params[p.key].pass);
      paramAgg[p.key] = ps.every(Boolean) ? 'pass' : ps.some(Boolean) ? 'partial' : 'fail';
    }
    byMethod[m] = { everywhere, somewhere, passesPerSnapshot: passes, failedParams: failedUnion, paramAgg };
  }
  // per-level survivor lists (permissive across snapshots), for the 4 charts
  const perLevelSurvivors = {};
  for (const lv of LEVELS) {
    perLevelSurvivors[lv.level] = METHODS.filter(({ key: m }) =>
      perSnapshot.some((s) => s.methods[m].levels[lv.level]),
    ).map((x) => x.key);
  }
  return {
    perSnapshot,
    byMethod,
    perLevelSurvivors,
    technicallyApplicable: strict, // the headline set = strict intersection
    applicableSomeSnapshot: permissive,
  };
}

// The three side-gates ANNOTATE; they never hard-remove a method (a soft
// constraint you can engineer around — e.g. build gas compression). The UI
// shows these next to the recommendation so the analyst weighs them.
export function sideGates({ nearGasCompression, naturalFlow, sourGasHigh }) {
  const notes = [];
  if (nearGasCompression === false)
    notes.push({ method: 'GL', severity: 'warn', text: 'No gas compression nearby — Gas Lift needs a compression source (can be built).' });
  if (naturalFlow === true)
    notes.push({ method: null, severity: 'info', text: 'Well flows naturally at this stage — artificial lift may be deferred.' });
  if (sourGasHigh === true)
    notes.push({ method: null, severity: 'warn', text: 'High H2S/CO2 — check metallurgy/elastomers for all methods (esp. PCP elastomers).' });
  return notes;
}
