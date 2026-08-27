// Water properties and liquid blending as the BHP sheets implement them.

import { WATER_DENSITY_KGM3, LBFT3_PER_KGM3 } from './constants.js';

export const DEFAULT_WATER_SG = 1.05; // BHP!M3 default input
export const WATER_VISCOSITY_CP = 0.5; // hardcoded in the BHP liquid blend (R18)

/** Water density, lbm/ft3 (BHP!AB12 = sg * 62.36509524). */
export function waterDensityLbft3(waterSg = DEFAULT_WATER_SG) {
  return waterSg * WATER_DENSITY_KGM3 * LBFT3_PER_KGM3;
}

/** Rate-weighted liquid viscosity, cp (BHP!R18): (mu_o*qo + 0.5*qw)/qL. */
export function liquidViscosityCp(oilViscCp, qLiquidBpd, qWaterBpd) {
  return (oilViscCp * (qLiquidBpd - qWaterBpd) + WATER_VISCOSITY_CP * qWaterBpd) / qLiquidBpd;
}

/** Water-cut blend used throughout the sheets: x_o + Yw*(x_w - x_o). */
export function waterCutBlend(oilValue, waterValue, waterFraction) {
  return oilValue + waterFraction * (waterValue - oilValue);
}
