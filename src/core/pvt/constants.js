// Unit-conversion constants exactly as used in the Excel toolset
// ('VLP-IPR'!E9:E13 block and BHP-sheet density conversions).

export const SCF_TO_M3 = 0.02831684639;   // scf -> m3          ('VLP-IPR'!E9)
export const BBL_TO_M3 = 0.158987304;     // bbl -> m3          ('VLP-IPR'!E10)
export const WATER_DENSITY_KGM3 = 998.9926968; // fresh water kg/m3 (Excel's constant)
export const LBFT3_PER_KGM3 = 62.36509524 / 998.9926968; // kg/m3 -> lbm/ft3 (Excel's pair)
export const KGM3_PER_LBFT3 = 998.9926968 / 62.36509524; // lbm/ft3 -> kg/m3
export const PSI_TO_PA = 1 / 0.000145037738; // psi -> Pa (Excel divides by 0.000145037738)

/** scf/stb -> m3/m3 (Excel: Rs * Scftom3 / bbltom3) */
export function scfStbToM3M3(rsScfStb) {
  return (rsScfStb * SCF_TO_M3) / BBL_TO_M3;
}

/** m3/m3 -> scf/stb (Excel: rs / Scftom3 * bbltom3) */
export function m3M3ToScfStb(rsM3M3) {
  return (rsM3M3 / SCF_TO_M3) * BBL_TO_M3;
}
