// Artificial-lift economic screen — UDC (Undiscounted Development Cost).
//
//   UDC ($/bbl) = capex / cumulative-oil + opex
//
// Ported from the workbook's D16:D21 block, with its no-op term removed: the
// sheet wrote `=Cost*1e6/CUM + Opex*CUM/CUM`; the `*CUM/CUM` is identically 1,
// so it is dropped here.
//
// Cumulative oil follows WellSim's "input-or-calculated" idiom:
//   - ESP / Gas Lift  -> calculated from WellSim's forecast (a COMMON,
//     method-agnostic base forecast, injected by the handler), so UDC
//     differences reflect CAPEX, not different production assumptions.
//   - Sucker Rod / Jet / PCP  -> WellSim has no engine, so cum comes from the
//     analyst (clipboard). No fabricated fallback for these.
//   - If no forecast is available for ESP/GL, we fall back to the workbook's
//     3-snapshot trapezoid (the snapshots are already screen inputs) and tag
//     the value as an estimate.
//
// Every UDC therefore carries a `cumSource` provenance tag so a pasted number
// never renders with the same authority as a forecast-backed one.

/** Workbook trapezoid over the year: half-year segments between the three
 *  oil-rate snapshots. `days` defaults to 365. */
export function trapezoidCumStb(oilRatesStbD, days = 365) {
  const r = oilRatesStbD.filter((x) => Number.isFinite(x));
  if (r.length < 2) return null;
  const seg = days / (r.length - 1);
  let cum = 0;
  for (let i = 0; i < r.length - 1; i++) cum += (seg * (r[i] + r[i + 1])) / 2;
  return cum;
}

/** One method's UDC. `cum` is {value, source}. Returns null value if cum
 *  is missing (e.g. a non-engine method with nothing pasted). */
export function udcForMethod({ capexUsd, opexUsdPerBbl, cum }) {
  if (cum == null || !(cum.value > 0)) {
    return { udcUsdPerBbl: null, capexUsd, cumStb: cum?.value ?? null, cumSource: cum?.source ?? 'missing' };
  }
  const udc = (capexUsd / cum.value) + opexUsdPerBbl;
  return { udcUsdPerBbl: udc, capexUsd, cumStb: cum.value, cumSource: cum.source };
}

/**
 * Economic screen — the workbook's D16:D21 block.
 * UDC is computed for EVERY method that has a capex (the sheet lists a UDC per
 * method), using the SAME well cumulative for all of them (the one-year prod
 * cum is the well's oil production, not method-specific). The economical method
 * is then the cheapest that is BOTH technically applicable and under the UDC
 * limit.
 *  inputs:
 *    methods           - all method keys to cost, e.g. ['ESP','GL','SRP','JET','PCP']
 *    applicable        - keys that passed the technical screen
 *    capexUsdByMethod  - { ESP: 500000, ... }         (analyst input)
 *    opexUsdPerBbl     - global opex (workbook opex), e.g. 3
 *    udcLimitUsdPerBbl - pass/fail threshold (workbook UDC limit), e.g. 11
 *    cumByMethod       - { ESP: {value, source}, ... } (same value for all here)
 */
export function economicScreen({ methods, applicable, capexUsdByMethod, opexUsdPerBbl, udcLimitUsdPerBbl, cumByMethod }) {
  const rows = {};
  for (const m of methods) {
    if (capexUsdByMethod[m] == null) continue;
    const udc = udcForMethod({ capexUsd: capexUsdByMethod[m], opexUsdPerBbl, cum: cumByMethod[m] });
    rows[m] = {
      ...udc,
      technicallyApplicable: applicable.includes(m),
      economicPass: udc.udcUsdPerBbl != null && udc.udcUsdPerBbl <= udcLimitUsdPerBbl,
    };
  }
  const passers = Object.keys(rows)
    .filter((m) => rows[m].technicallyApplicable && rows[m].economicPass)
    .sort((a, b) => rows[a].udcUsdPerBbl - rows[b].udcUsdPerBbl);
  return {
    udcLimitUsdPerBbl,
    opexUsdPerBbl,
    byMethod: rows,
    cheapestApplicable: passers[0] ?? null, // the economical method
    ranked: passers,
  };
}
