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
  if (naturalFlow === true)
    notes.push({ method: null, severity: 'info', text: 'Well flows naturally at this stage — artificial lift may be deferred altogether.' });
  if (sourGasHigh === true) {
    notes.push({ method: null, severity: 'warn', text: 'High H2S/CO2 — check metallurgy for every surviving method: tubing, wellhead and any pump housing need sour-service grades.' });
    notes.push({ method: 'JET', severity: 'warn', text: 'Jet pump in sour service: the pump itself tolerates it (no moving parts, carbide nozzle and throat, inhibitor can ride down in the power fluid), but an OPEN power-fluid loop returns sour fluid through the surface plant — confirm a closed loop or sour-rated surface handling before selecting it.' });
  }
  return notes;
}

/**
 * Well-condition gates that RULE A METHOD OUT, each with its reason.
 *
 * These are NOT envelope bands: a method can clear every band and still be
 * undeployable on this well, because what stops it is a facility or a
 * metallurgy question rather than its operating envelope. They are therefore
 * kept out of screenLifecycle and applied on top of it, so the two kinds of
 * exclusion stay distinguishable — "outside its envelope" and "ruled out by
 * this well's conditions" are different findings, and the second is often the
 * actionable one (compression can be installed; sour service cannot be typed
 * away). Nothing is ever removed silently: the reason travels with it.
 *
 *   no gas compression -> Gas Lift  (no source of injection gas)
 *   flows naturally    -> Sucker Rod
 *   high H2S / CO2     -> Sucker Rod (rod-string sour service)
 *                      -> PCP        (stator elastomer)
 *
 * The jet pump is deliberately NOT excluded on sour gas. In the published
 * screening tables it rates well on corrosion — no moving parts downhole, a
 * carbide nozzle and throat, and inhibitor can ride down continuously in the
 * power fluid; sour service is one of the classic arguments FOR a jet pump.
 * Its real weakness is free gas at the throat, and that is already screened by
 * the GLR band. What sour gas does raise for a jet pump is a facilities
 * question — sour returns through an open power-fluid loop — so that travels
 * as a named warning in `sideGates`, not as an exclusion.
 *
 * Returns { METHOD: [reason, ...] } for the excluded methods only.
 */
export function gateExclusions({ nearGasCompression, naturalFlow, sourGasHigh } = {}) {
  const out = {};
  const add = (m, reason) => { (out[m] ??= []).push(reason); };
  if (nearGasCompression === false)
    add('GL', 'No gas compression nearby — gas lift has no source of injection gas. Removable: tie in or install compression.');
  if (naturalFlow === true)
    add('SRP', 'The well still flows naturally — a rod pump belongs on a well that can no longer flow unaided.');
  if (sourGasHigh === true) {
    add('SRP', 'High H2S/CO2 — sour service attacks the rod string (sulphide stress cracking) and the stuffing box.');
    add('PCP', 'High H2S/CO2 — H2S and CO2 swell and harden the stator elastomer until it chunks; in sour service the stator is the PCP\'s shortest-lived part. Removable: an elastomer qualified for THIS gas composition.');
  }
  return out;
}
