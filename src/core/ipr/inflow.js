// Unified well-inflow definition. Single-layer is the default; multi-layer
// is an OPTIONAL block with its own inputs (training-deck-4 model). Either
// way the result carries one active `ipr` record, so the nodal solver,
// sensitivities and Pres solver consume it unchanged — and in multi-layer
// mode every layer's full record is kept alongside the one final J.
//
// Oil spec (one of):
//   { jTest?/jDarcy?/j?, jSource?, priPsi, pbPsi }              -> single
//   { multiLayer: { layers: [{ jTest?/jDarcy?/j?, jSource?, priPsi, pbPsi,
//       wcPct, gorScfStb, name? }], pwfSolutionPsi?, pbPsi?,
//       allowCrossflow? } }                                     -> multi
//
// Gas spec (one of):
//   { jTest?/jDarcy?/j?, c?, n?, priPsi }                       -> single
//   { multiLayer: { layers: [{ j-record fields, priPsi,
//       cgrStbMMscf, wgrStbMMscf, name? }], pwfSolutionPsi? } } -> multi
//       (J-form layers only — the gas collapse is exact)

import { createOilIpr } from './oil-ipr.js';
import { createGasIpr } from './gas-ipr.js';
import {
  equivalentOilIpr,
  multiLayerGasRates,
  equivalentGasIpr,
} from './multilayer.js';

export function createOilInflow(spec) {
  if (!spec.multiLayer) {
    return { mode: 'single', ipr: createOilIpr(spec), warnings: [] };
  }
  const { layers, pwfSolutionPsi, pbPsi, allowCrossflow } = spec.multiLayer;
  if (!Array.isArray(layers) || layers.length === 0)
    throw new Error('createOilInflow: multiLayer.layers must be a non-empty array');
  const built = layers.map((l, i) => {
    for (const k of ['wcPct', 'gorScfStb']) {
      if (l[k] == null) throw new Error(`createOilInflow: layer ${l.name ?? i} missing ${k}`);
    }
    return { name: l.name ?? `layer-${i + 1}`, ipr: createOilIpr(l), wcPct: l.wcPct, gorScfStb: l.gorScfStb };
  });
  const eq = equivalentOilIpr(built, { pwfSolutionPsi, pbPsi });
  return {
    mode: 'multi-layer',
    ipr: eq.ipr, // the one final J record
    layers: built, // every layer kept in full
    prAvgPsi: eq.prAvgPsi,
    pwfSolutionPsi: eq.pwfSolutionPsi,
    blended: { wcPct: eq.wcPct, gorScfStb: eq.gorScfStb },
    allowCrossflow: allowCrossflow ?? true,
    warnings: eq.warnings,
  };
}

export function createGasInflow(spec) {
  if (!spec.multiLayer) {
    return { mode: 'single', ipr: createGasIpr(spec), warnings: [] };
  }
  const { layers, pwfSolutionPsi } = spec.multiLayer;
  if (!Array.isArray(layers) || layers.length === 0)
    throw new Error('createGasInflow: multiLayer.layers must be a non-empty array');
  const built = layers.map((l, i) => {
    for (const k of ['cgrStbMMscf', 'wgrStbMMscf']) {
      if (l[k] == null) throw new Error(`createGasInflow: layer ${l.name ?? i} missing ${k}`);
    }
    return { name: l.name ?? `layer-${i + 1}`, ipr: createGasIpr(l), cgrStbMMscf: l.cgrStbMMscf, wgrStbMMscf: l.wgrStbMMscf };
  });
  const eq = equivalentGasIpr(built);
  const pwfSol = pwfSolutionPsi ?? eq.prAvgPsi / 2;
  const { totals, warnings } = multiLayerGasRates(pwfSol, built);
  return {
    mode: 'multi-layer',
    ipr: eq.ipr,
    layers: built,
    prAvgPsi: eq.prAvgPsi,
    pwfSolutionPsi: pwfSol,
    blended: { cgrStbMMscf: totals.cgrStbMMscf, wgrStbMMscf: totals.wgrStbMMscf },
    warnings,
  };
}

/**
 * Merge a multi-layer inflow's blended fluid ratios into a march config
 * (WC/GOR for oil, CGR/WGR for gas). Single-layer inflows return the config
 * unchanged — the march keeps its own inputs.
 */
export function applyInflowFluids(marchCfg, inflow) {
  if (inflow.mode !== 'multi-layer') return marchCfg;
  const b = inflow.blended;
  const out = { ...marchCfg };
  if (b.wcPct != null) out.wcPct = b.wcPct;
  if (b.gorScfStb != null) out.gorScfStb = b.gorScfStb;
  if (b.cgrStbMMscf != null) out.cgrStbMMscf = b.cgrStbMMscf;
  if (b.wgrStbMMscf != null) out.wgrStbMMscf = b.wgrStbMMscf;
  return out;
}
