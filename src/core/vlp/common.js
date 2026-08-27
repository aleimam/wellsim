// Shared pieces of the BHP-sheet marches.

export const AIR_LB_PER_SCF = 0.0765; // gas mass term in R17/P17/T17
export const LIQ_LB_PER_FT3 = 62.4;   // liquid mass term (sheets use 62.4 here)

/** Throw a clear error naming every missing/non-numeric required input. */
export function requireInputs(obj, keys, context) {
  const missing = keys.filter((k) => obj?.[k] == null || Number.isNaN(obj[k]));
  if (missing.length)
    throw new Error(`${context}: missing required input(s): ${missing.join(', ')}`);
}

/** Chen (1979) explicit Fanning friction factor exactly as the sheets write it
 *  (BHP!AO / gas AT columns; LOG is log10). e = relative roughness argument. */
export function chenFanning(e, nre) {
  return (
    1 /
    (-4 *
      Math.log10(
        e / 3.7065 -
          (5.0452 / nre) * Math.log10(e ** 1.1098 / 2.8257 + (7.149 / nre) ** 0.8981)
      )) **
      2
  );
}

/** Friction pressure gradient, psi/ft (BHP!AQ / gas AX columns):
 *  f * w^2 / 7.413e10 / d_ft^5 / rho / 144, times the user match factor. */
export function frictionGradient(f, massLbDay, idFt, rhoMix, matchFriction) {
  return (
    (1 / 144) * ((f * massLbDay ** 2) / 7.413 / 1e10 / idFt ** 5 / rhoMix) * matchFriction
  );
}

/**
 * Ramey-style flowing-temperature chain exactly as the gas workbook builds
 * it (BHP!K10/K11 and the M/N columns): a geothermal "shelf" profile linear
 * from soil temperature at surface to Tres at TD, with the flowing
 * temperature relaxing toward it bottom-up by the fixed factor
 * K11 = exp(-K10 * L1), K10 = (OD_ft * 3.14 * U) / ((w/24) * Cp), and L1 the
 * FIRST station spacing along hole (workbook quirk, preserved).
 * grid: [{ tvdFt, ahFt }]. Returns { tF, shelfF, k10, k11 }.
 */
export function rameyTemperatures({ grid, totTvdFt, tresF, soilTempF, tubingOdIn, htcBtu, cpBtu, massLbDay }) {
  const k10 = ((tubingOdIn / 12) * 3.14 * htcBtu) / ((massLbDay / 24) * (cpBtu ?? 0.51));
  const k11 = Math.exp(-k10 * grid[1].ahFt);
  const shelfF = grid.map((g) => soilTempF + ((tresF - soilTempF) / totTvdFt) * g.tvdFt);
  const tF = new Array(grid.length);
  tF[grid.length - 1] = tresF;
  for (let i = grid.length - 2; i >= 0; i--) tF[i] = shelfF[i] + (tF[i + 1] - shelfF[i]) * k11;
  return { tF, shelfF, k10, k11 };
}
