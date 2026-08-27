// IPR calibration — the workbook's Step-1 workflow (main deck slide 8):
// "Fill initial test data and run get_Pwf to get Pwf at test point", then
// J from the Jones general equation (oil) / squared-pressure form (gas).
//
// The test Pwf is EITHER a direct input (downhole gauge measurement) OR
// calculated by the get_Pwf equivalent — a march from the test THP at the
// test rate. Every result reports which one was used (pwfSource).

import { oilMarch, oilFraction } from '../vlp/oil-march.js';
import { gasMarch } from '../vlp/gas-march.js';
import { bubblePointPsi } from '../pvt/oil.js';
import { createOilIpr, jFromTest, jDarcyOil, permFromJOil } from '../ipr/oil-ipr.js';
import { createGasIpr, jFromTestGas, jDarcyGas, permFromJGas, fitCn } from '../ipr/gas-ipr.js';

/** get_Pwf macro equivalent: Pwf from the march at a test rate (the march
 *  cfg carries the test THP, WC, GOR, ...). */
export function getPwfOil(marchCfg, qOilStbD) {
  return oilMarch({ ...marchCfg, qOilStbD }).pwfPsi;
}

export function getPwfGas(marchCfg, qGasMMscfd) {
  return gasMarch({ ...marchCfg, qGasMMscfd }).pwfPsi;
}

/**
 * Calibrate the oil IPR from one initial test point.
 * test: { qOilStbD, pwfPsi? } — omit pwfPsi to have it calculated by
 * get_Pwf (marchCfg.thpPsi is then the test THP).
 * darcy (optional): { permMd?, thicknessFt, viscCp, bo, reFt, rwFt, skin? }
 *   — builds the Darcy J record ("IPR from Darcy"). With permMd omitted the
 *   permeability is back-matched so jDarcy equals the test J (the slide-8
 *   "tune K to match" workflow, closed form; matchedPermMd is reported).
 *   When darcy is present it becomes the ACTIVE J (workbook convention:
 *   "Darcy model is used for oil"); the Jones record stays selectable via
 *   withJSource(ipr, 'jones').
 * Returns { ipr, testPwfPsi, testQGrossStbD, pwfSource, matchedPermMd? }.
 */
export function calibrateOilIpr({ marchCfg, priPsi, pbPsi, test, darcy }) {
  const pb =
    pbPsi ??
    marchCfg.pbPsi ??
    bubblePointPsi({
      rsiScfStb: marchCfg.rsiScfStb,
      gasSg: marchCfg.gasSg,
      api: marchCfg.api,
      tempF: marchCfg.tresF,
    });
  const pwfSource = test.pwfPsi != null ? 'input' : 'calculated';
  const pwf = test.pwfPsi ?? getPwfOil(marchCfg, test.qOilStbD);
  const qGross = test.qOilStbD / oilFraction(marchCfg);
  const jTest = jFromTest({ qGrossStbD: qGross, pwfPsi: pwf, priPsi, pbPsi: pb });

  let jDarcy;
  let matchedPermMd;
  if (darcy) {
    matchedPermMd = darcy.permMd ?? permFromJOil({ j: jTest, ...darcy });
    jDarcy = jDarcyOil({ ...darcy, permMd: matchedPermMd });
  }
  return {
    ipr: createOilIpr({ jTest, jDarcy, priPsi, pbPsi: pb }),
    testPwfPsi: pwf,
    testQGrossStbD: qGross,
    pwfSource,
    matchedPermMd,
  };
}

/**
 * Calibrate the gas IPR (J form) from one initial test point.
 * test: { qMMscfd, pwfPsi? } — omit pwfPsi to calculate it by get_Pwf.
 * darcy (optional): { permMd?, thicknessFt, viscCp, z, tresF, reFt, rwFt,
 * skin? } — same two-record behavior as the oil side.
 */
export function calibrateGasJ({ marchCfg, priPsi, test, darcy }) {
  const pwfSource = test.pwfPsi != null ? 'input' : 'calculated';
  const pwf = test.pwfPsi ?? getPwfGas(marchCfg, test.qMMscfd);
  const jTest = jFromTestGas({ qMMscfd: test.qMMscfd, pwfPsi: pwf, priPsi });

  let jDarcy;
  let matchedPermMd;
  if (darcy) {
    matchedPermMd = darcy.permMd ?? permFromJGas({ j: jTest, ...darcy });
    jDarcy = jDarcyGas({ ...darcy, permMd: matchedPermMd });
  }
  return { ipr: createGasIpr({ jTest, jDarcy, priPsi }), testPwfPsi: pwf, pwfSource, matchedPermMd };
}

/**
 * Calibrate gas C&n from a multi-rate test. Each point:
 * { qMMscfd, pwfPsi?, thpPsi? } — a point without pwfPsi gets it from
 * get_Pwf at its own THP (thpPsi, falling back to marchCfg.thpPsi).
 * Returns { ipr, points (with resolved pwfPsi + pwfSource), qMaxMMscfd }.
 */
export function calibrateGasCn({ marchCfg, priPsi, points }) {
  const resolved = points.map((p) => {
    const pwfSource = p.pwfPsi != null ? 'input' : 'calculated';
    const pwfPsi =
      p.pwfPsi ??
      getPwfGas({ ...marchCfg, thpPsi: p.thpPsi ?? marchCfg.thpPsi }, p.qMMscfd);
    return { qMMscfd: p.qMMscfd, pwfPsi, pwfSource };
  });
  const { c, n, qMaxMMscfd } = fitCn(resolved, priPsi);
  return { ipr: createGasIpr({ c, n, priPsi }), points: resolved, qMaxMMscfd };
}
