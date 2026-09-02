// Gas reserve estimation & forecast — Module 2/3 (gas), following
// "Reserve Estimate from early gas production_V9.0.0.xls":
//  - Pres solver batch: per production point, Pwf (input or get_Pwf march),
//    then Pr from the frozen calibrated IPR (closed form), then Z at Pr;
//    cumulative Gp by trapezoid on dates (the sheet's T column).
//  - p/Z vs Gp straight line: GIIP = Gp at p/Z = 0 (the sheet's TREND) —
//    with early data this is the MINIMUM CONNECTED GIIP (a smaller
//    connected volume would have depleted more than observed).
//  - SITHP statics: shut-in wellhead pressure -> static BHP via the
//    average-T&Z gas column (Pws = SITHP*exp(0.01875*gg*D/(Tavg*Zavg)),
//    Zavg iterated), giving extra p/Z points at surveyed dates.
//  - Forecast: the workbook's Forecast macro as a real loop — each step
//    inverts the p/Z line for Pr, rebuilds the IPR, intersects with the VLP
//    at the forecast FTHP (Brent), applies the plateau constraint, and
//    advances Gp. Explicit Z everywhere (project decision).

import { gasMarch } from '../vlp/gas-march.js';
import { gasPseudoCriticals, zFactorBrillBeggs, gasDensityLbft3 } from '../pvt/gas.js';
import { buildGrid } from '../vlp/wellpath.js';
import {
  prFromTestGasJ,
  prFromTestGasCn,
  pwfAtQGasJ,
  pwfAtQGasCn,
  withCurrentPr,
} from '../ipr/gas-ipr.js';
import { gasOperatingPoint } from '../nodal/nodal.js';
import { brent } from '../solvers/brent.js';

/** Z at reservoir temperature for this well's gas (sour route, explicit). */
export function zAtRes(cfg, pPsi) {
  const pc = gasPseudoCriticals({ gasSg: cfg.gasSg, n2: cfg.n2 ?? 0, co2: cfg.co2 ?? 0, h2s: cfg.h2s ?? 0, method: 'sour' });
  return zFactorBrillBeggs(pPsi / pc.ppc, (cfg.tresF + 460) / pc.tpc).z;
}

/** Date -> fractional days. Accepts: a number (day serial, fractional ok),
 *  "dd/mm/yyyy hh:mm:ss" (also dd-mm-yyyy, dd.mm.yyyy; time optional —
 *  sporadic test timestamps like the workbook's 41960.5417 serials), or
 *  anything Date.parse understands (ISO). */
export const toDays = (d) => {
  if (typeof d === 'number') return d;
  const s = String(d).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // d-MMM-yy / d-MMM-yyyy (e.g. 17-Nov-14, the workbook's date format)
  const mn = s.match(
    /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (mn) {
    const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = MONTHS[mn[2].slice(0, 3).toLowerCase()];
    const dd = +mn[1];
    const yy = mn[3].length === 2 ? 2000 + +mn[3] : +mn[3];
    const hh = +(mn[4] ?? 0);
    const mi = +(mn[5] ?? 0);
    const ss = +(mn[6] ?? 0);
    if (mon == null || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) return NaN;
    return Date.UTC(yy, mon, dd, hh, mi, ss) / 86400000;
  }
  const m = s.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (m) {
    const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    // reject impossible day/month — JS Date would silently roll them over
    if (+dd < 1 || +dd > 31 || +mm < 1 || +mm > 12 || +hh > 23 || +mi > 59 || +ss > 59) return NaN;
    return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss) / 86400000;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t / 86400000;
};

/**
 * Pres solver batch (the Solver macro). rows: [{ date, qMMscfd, thpPsi?,
 * pwfPsi?, cgrStbMMscf?, wgrStbMMscf? }] — pwfPsi omitted -> get_Pwf march
 * at that row's THP and ratios. ipr: frozen calibrated record (J or C&n).
 * Returns enriched rows with pwfPsi/pwfSource/presPsi/z/pOverZ/gpBscf.
 */
export function gasPresSolver(marchCfg, ipr, rows) {
  let gp = 0;
  let prev = null;
  const t0 = rows.length ? toDays(rows[0].date) : 0;
  return rows.map((r) => {
    const tDays = toDays(r.date);
    const dtDays = tDays - t0; // the workbook's "delta, time days" column
    const pwfSource = r.pwfPsi != null ? 'input' : 'calculated';
    const pwfPsi =
      r.pwfPsi ??
      gasMarch({
        ...marchCfg,
        thpPsi: r.thpPsi ?? marchCfg.thpPsi,
        qGasMMscfd: r.qMMscfd,
        cgrStbMMscf: r.cgrStbMMscf ?? marchCfg.cgrStbMMscf,
        wgrStbMMscf: r.wgrStbMMscf ?? marchCfg.wgrStbMMscf,
      }).pwfPsi;
    const presPsi =
      ipr.c != null
        ? prFromTestGasCn({ qMMscfd: r.qMMscfd, pwfPsi, c: ipr.c, n: ipr.n })
        : prFromTestGasJ({ qMMscfd: r.qMMscfd, pwfPsi, j: ipr.j });
    const z = zAtRes(marchCfg, presPsi);
    if (prev) gp += ((tDays - prev.tDays) * (r.qMMscfd + prev.q)) / 2 / 1000; // Bscf
    prev = { tDays, q: r.qMMscfd };
    return {
      tDays,
      dtDays,
      qMMscfd: r.qMMscfd,
      thpPsi: r.thpPsi ?? null,
      pwfPsi,
      pwfSource,
      presPsi,
      dpPsi: presPsi - pwfPsi, // calculated drawdown
      z,
      pOverZ: presPsi / z,
      gpBscf: gp,
    };
  });
}

/** Least-squares p/Z vs Gp line (the sheet's TREND):
 *  points [{gpBscf, pOverZ}] -> { giipBscf, pziPsi, slope }. GIIP is the
 *  minimum connected gas of the observed depletion. */
export function giipFromPz(points) {
  const n = points.length;
  if (n < 2) throw new Error('giipFromPz: need at least 2 (Gp, p/Z) points');
  for (const p of points) {
    if (!Number.isFinite(p.gpBscf) || !Number.isFinite(p.pOverZ))
      throw new Error('giipFromPz: non-finite (Gp, p/Z) point — check the row dates and pressures');
  }
  const mx = points.reduce((a, p) => a + p.gpBscf, 0) / n;
  const my = points.reduce((a, p) => a + p.pOverZ, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.gpBscf - mx) * (p.pOverZ - my);
    den += (p.gpBscf - mx) ** 2;
  }
  if (den === 0) throw new Error('giipFromPz: all points at the same Gp — no depletion observed');
  const slope = num / den; // psi/Bscf (negative)
  const pziPsi = my - slope * mx;
  if (slope >= 0) return { giipBscf: null, pziPsi, slope, warning: 'p/Z not declining — no volumetric depletion signal' };
  return { giipBscf: -pziPsi / slope, pziPsi, slope };
}

/** Cumulative-production series from (date, rate) rows — trapezoid, Bscf.
 *  Returns { at(tDays), lastGpBscf, lastDay }. */
export function cumGp(prodRows) {
  const rows = prodRows
    .map((r) => ({ tDays: toDays(r.date), q: r.qMMscfd }))
    .sort((a, b) => a.tDays - b.tDays);
  const series = [];
  let gp = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) gp += ((rows[i].tDays - rows[i - 1].tDays) * (rows[i].q + rows[i - 1].q)) / 2 / 1000;
    series.push({ tDays: rows[i].tDays, gpBscf: gp });
  }
  const at = (tDays) => {
    if (series.length === 0) return 0;
    if (tDays <= series[0].tDays) return series[0].gpBscf;
    for (let i = 1; i < series.length; i++) {
      if (tDays <= series[i].tDays) {
        const a = series[i - 1];
        const b = series[i];
        return a.gpBscf + ((b.gpBscf - a.gpBscf) * (tDays - a.tDays)) / (b.tDays - a.tDays);
      }
    }
    return series[series.length - 1].gpBscf;
  };
  return { at, lastGpBscf: gp, lastDay: series.length ? series[series.length - 1].tDays : 0 };
}

/**
 * Static BHP from a shut-in wellhead pressure — THE SHEET'S METHOD: the
 * Cullender-Smith / average-T&Z correlation (gas deck slide 7) evaluated at
 * ZERO RATE, Pws = SITHP * exp(0.01875 * gg * TVDft / (TavgR * Zavg)) with
 * Zavg iterated at (Pavg, Tavg). (The full Gray march cannot be used at
 * near-zero rate: its holdup floods the static column with liquid —
 * measured +21..32% and NaN below 0.01 MMscf/d.)
 */
export function staticPresFromSithp({ sithpPsi, surfTempF, cfg }) {
  const tvdFt = cfg.perfTvdM * 3.281;
  const tAvgR = ((surfTempF ?? 60) + cfg.tresF) / 2 + 460;
  const pc = gasPseudoCriticals({ gasSg: cfg.gasSg, n2: cfg.n2 ?? 0, co2: cfg.co2 ?? 0, h2s: cfg.h2s ?? 0, method: 'sour' });
  let pws = sithpPsi * 1.15;
  let zAvg = 1;
  for (let i = 0; i < 60; i++) {
    const pAvg = (sithpPsi + pws) / 2;
    zAvg = zFactorBrillBeggs(pAvg / pc.ppc, tAvgR / pc.tpc).z;
    const next = sithpPsi * Math.exp((0.01875 * cfg.gasSg * tvdFt) / (tAvgR * zAvg));
    if (Math.abs(next - pws) < 1e-9) {
      pws = next;
      break;
    }
    pws = next;
  }
  return { presPsi: pws, zAvg, zRes: zAtRes(cfg, pws), gradientPsiFt: (pws - sithpPsi) / tvdFt };
}

/**
 * Static gas march — the marches sheet at ZERO RATE: same station grid and
 * trajectory as the flowing march, geothermal temperature (shut-in: surface
 * temp -> Tres linear in TVD), per-station Z (Brill & Beggs, well-model
 * composition), and ONLY the gas-head term (no friction, no holdup — the
 * liquid has segregated; CGR/WGR carried on the rows do not enter).
 * Marches SITHP at surface down to the static Pres at the perfs.
 */
export function staticGasMarch(cfg, { sithpPsi, surfTempF }) {
  const pc = gasPseudoCriticals({ gasSg: cfg.gasSg, n2: cfg.n2 ?? 0, co2: cfg.co2 ?? 0, h2s: cfg.h2s ?? 0, method: 'sour' });
  const path = { devStartM: cfg.devStartM ?? 0, devAngleDeg: cfg.devAngleDeg ?? 0 };
  const totTvdFt = cfg.perfTvdM * 3.281;
  const grid = buildGrid([{ toTvdFt: totTvdFt, steps: cfg.steps ?? 29, zone: 'static' }], path);
  const t0 = surfTempF ?? cfg.soilTempF ?? 60;
  const tAt = (tvdFt) => t0 + ((cfg.tresF - t0) / totTvdFt) * tvdFt;
  const stations = [];
  let p = sithpPsi;
  for (let i = 0; i < grid.length; i++) {
    const tF = tAt(grid[i].tvdFt);
    const z = zFactorBrillBeggs(p / pc.ppc, (tF + 460) / pc.tpc).z;
    const rho = gasDensityLbft3(cfg.gasSg, p, tF, z);
    stations.push({ tvdFt: grid[i].tvdFt, tF, pPsi: p, z, rhoLbft3: rho, gradPsiFt: rho / 144 });
    if (i < grid.length - 1) p += (rho / 144) * (grid[i + 1].tvdFt - grid[i].tvdFt);
  }
  return {
    presPsi: p,
    zRes: zAtRes(cfg, p),
    gradientPsiFt: (p - sithpPsi) / totTvdFt,
    stations,
  };
}

/**
 * GIIP from SITHP statics (no IPR needed): each q = 0 survey row's Pres via
 * the STATIC GAS MARCH (well-model data throughout), Gp at the survey date
 * from the flowing production rows (trapezoid), p/Z line -> minimum
 * connected GIIP. sithpRows: [{ date, sithpPsi, surfTempF?, cgrStbMMscf?,
 * wgrStbMMscf? }] (ratios carried for structure; a static column is
 * gas-head only); prodRows: [{ date, qMMscfd }].
 */
export function sithpReserve(cfg, sithpRows, prodRows) {
  if (sithpRows.length < 2)
    throw new Error('SITHP route needs at least 2 surveys (date + SITHP) to see depletion');
  const gp = cumGp(prodRows);
  const t0 = toDays(sithpRows[0].date);
  const points = sithpRows.map((r) => {
    const s = staticGasMarch(cfg, { sithpPsi: r.sithpPsi, surfTempF: r.surfTempF });
    const tDays = toDays(r.date);
    return {
      tDays,
      dtDays: tDays - t0,
      sithpPsi: r.sithpPsi,
      presPsi: s.presPsi,
      z: s.zRes,
      pOverZ: s.presPsi / s.zRes,
      gpBscf: gp.at(tDays),
      gradientPsiFt: s.gradientPsiFt,
    };
  });
  return { points, fit: giipFromPz(points), lastGpBscf: gp.lastGpBscf, lastDay: gp.lastDay };
}

/**
 * GIIP from MEASURED reservoir pressures (memory / permanent gauges) — the
 * shortest route to a p/Z line: no march and no IPR, because the pressure is
 * already the datum. Each row is a gauge survey [{ date, presPsi }] carrying
 * the static (built-up / extrapolated) reservoir pressure; Z comes from the
 * well-model composition at reservoir temperature, and Gp at the survey date
 * from the flowing production rows (the same trapezoid the other routes use).
 * prodRows: [{ date, qMMscfd }].
 */
/**
 * Correct a measured pressure from the gauge depth to the datum, through the
 * static gas column between them — the SAME average-T&Z correlation the SITHP
 * route uses (Pws = P * exp(0.01875*gg*dD/(TavgR*Zavg)), Zavg iterated), just
 * over a partial interval instead of the whole well.
 *
 * A memory gauge sits at its running depth, which is rarely the datum. Left
 * uncorrected a gauge ABOVE the datum reads low, and every p/Z point with it,
 * which biases the fitted GIIP.
 *
 * dTvdFt > 0 means the gauge is ABOVE the datum (pressure is added).
 */
export function gaugeToDatum({ pPsi, dTvdFt, cfg, gaugeTempF }) {
  if (!(Math.abs(dTvdFt) > 0.5)) return { presPsi: pPsi, gradientPsiFt: 0, dTvdFt: 0 };
  const tAvgR = ((gaugeTempF ?? cfg.tresF) + cfg.tresF) / 2 + 460;
  const pc = gasPseudoCriticals({ gasSg: cfg.gasSg, n2: cfg.n2 ?? 0, co2: cfg.co2 ?? 0, h2s: cfg.h2s ?? 0, method: 'sour' });
  let out = pPsi;
  for (let i = 0; i < 60; i++) {
    const zAvg = zFactorBrillBeggs(((pPsi + out) / 2) / pc.ppc, tAvgR / pc.tpc).z;
    const next = pPsi * Math.exp((0.01875 * cfg.gasSg * dTvdFt) / (tAvgR * zAvg));
    if (Math.abs(next - out) < 1e-9) { out = next; break; }
    out = next;
  }
  return { presPsi: out, gradientPsiFt: (out - pPsi) / dTvdFt, dTvdFt };
}

export function gaugeReserve(cfg, gaugeRows, prodRows) {
  if (gaugeRows.length < 2)
    throw new Error('gauge route needs at least 2 surveys (date + Pr) to see depletion');
  const gp = cumGp(prodRows);
  const t0 = toDays(gaugeRows[0].date);
  const datumTvdFt = cfg.perfTvdM * 3.281;
  const points = gaugeRows.map((r) => {
    const tDays = toDays(r.date);
    // gaugeTvdM blank -> the reading is already at datum (the previous
    // behaviour, and still the common case for a corrected report)
    const gTvdFt = r.gaugeTvdM != null ? r.gaugeTvdM * 3.281 : datumTvdFt;
    const corr = gaugeToDatum({ pPsi: r.presPsi, dTvdFt: datumTvdFt - gTvdFt, cfg, gaugeTempF: r.gaugeTempF });
    const presPsi = corr.presPsi;
    const z = zAtRes(cfg, presPsi);
    return {
      tDays,
      dtDays: tDays - t0,
      gaugePsi: r.presPsi,
      gaugeTvdM: r.gaugeTvdM ?? null,
      dTvdFt: corr.dTvdFt,
      corrPsi: presPsi - r.presPsi,
      presPsi,
      z,
      pOverZ: presPsi / z,
      gpBscf: gp.at(tDays),
    };
  });
  return { points, fit: giipFromPz(points), lastGpBscf: gp.lastGpBscf, lastDay: gp.lastDay };
}

/** Invert the p/Z line for pressure: find P with P/Z(P) = pzTarget. */
export function presFromPz(cfg, pzTargetPsi) {
  const f = (p) => p / zAtRes(cfg, p) - pzTargetPsi;
  return brent(f, 15, pzTargetPsi * 2.2, { tol: 1e-7 }).root;
}

/** Workbook Bg (reservoir limit sheet L32): 0.00504*5.61*(T+460)*z/p, cf/scf. */
export function bgCfScf(tresF, z, pPsi) {
  return (0.00504 * 5.61 * (tresF + 460) * z) / pPsi;
}

/**
 * Reservoir limit test — VERBATIM the gas reserve workbook's 'reservoir
 * limit' sheet (L24:P24, I26:M33). NO rate filtering: the slope is the LSQ
 * fit of Pwf vs elapsed time over ALL rows (SLOPE(E:E,A:A)*-1) and the rate
 * is the AVERAGE of all rows.
 *   m  = -slope(Pwf, t)                              psi/day
 *   Cg = (Bg1-Bg2)/Bg1/(P2-P1)  from two Pres-solver points (calculated,
 *        override with cgOverride)                   1/psi
 *   Ct = Cg*Sg + Co*So + Cw*Sw + Cf                  1/psi
 *   GIIP = qavg/(Ct*m)/1000                          Bscf
 *   Vp   = qavg/(Bg1*Ct*m)                           (workbook 'Vp, MMcf')
 * solvedRows: output of gasPresSolver (needs dtDays, pwfPsi, presPsi, z,
 * qMMscfd). Saturations/constants default to the workbook's green cells.
 */
export function reservoirLimitWorkbook(
  cfg,
  solvedRows,
  { sg = 0.85, so = 0, sw = 0.15, cfPsi = 3e-6, coPsi = 1e-6, cwPsi = 1e-6, cgOverride } = {}
) {
  if (solvedRows.length < 3)
    throw new Error('reservoir limit needs at least 3 production rows');
  const n = solvedRows.length;
  const mt = solvedRows.reduce((a, r) => a + r.dtDays, 0) / n;
  const mp = solvedRows.reduce((a, r) => a + r.pwfPsi, 0) / n;
  let num = 0;
  let den = 0;
  for (const r of solvedRows) {
    num += (r.dtDays - mt) * (r.pwfPsi - mp);
    den += (r.dtDays - mt) ** 2;
  }
  if (den === 0) throw new Error('reservoir limit: all rows at the same time');
  const m = -(num / den); // L24
  const a = solvedRows[0];
  const b = solvedRows[n - 1]; // workbook used rows 1 and ~6; first/last spans more dP
  const bg1 = bgCfScf(cfg.tresF, a.z, a.presPsi); // L32
  const bg2 = bgCfScf(cfg.tresF, b.z, b.presPsi); // L33
  const cg = cgOverride ?? (bg1 - bg2) / bg1 / (b.presPsi - a.presPsi); // M32
  const ct = sg * cg + so * coPsi + sw * cwPsi + cfPsi; // M24
  const qAvg = solvedRows.reduce((s, r) => s + r.qMMscfd, 0) / n; // N24
  const warning = m <= 0 ? 'Pwf not declining — no depletion slope' : undefined;
  const giipBscf = m > 0 ? qAvg / (ct * m) / 1000 : null; // P24
  const vpMMcf = m > 0 ? qAvg / (bg1 * ct * m) : null; // O24
  return { slopePsiDay: m, cg, ct, bg1, qAvgMMscfd: qAvg, giipBscf, vpMMcf, warning };
}

/**
 * Coupled p/Z + nodal forecast (the Forecast macro as a loop).
 * { marchCfg, ipr (frozen J or C&n), giipBscf, pziPsi, startGpBscf (0),
 *   startDay (0), stepDays (30), fthpPsi, plateauMMscfd?, minRateMMscfd
 *   (0.5), maxSteps (60) }.
 * Each step: Pr from the p/Z line -> IPR at Pr -> operating point at the
 * forecast FTHP -> q = min(op, plateau) -> Gp += q*dt.
 */
/**
 * Flowing wellhead state at a produced rate. Returns { fthpPsi, fthtF }.
 *
 * unconstrained: the rate IS the intersection at the running THP, so the
 *   wellhead pressure is that THP and one march gives the temperature.
 * on plateau: the well is choked back, so solve the THP whose march lands
 *   on the IPR Pwf at this rate. Bracketed between the running THP (which
 *   under-shoots, being the unconstrained case) and a ceiling at the
 *   reservoir pressure -- a wellhead pressure above Pres cannot flow.
 */
export function forecastWellhead(cfg, { qMMscfd, pwfPsi, fthpPsi, onPlateau, presPsi }) {
  const at = (thp) => gasMarch({ ...cfg, thpPsi: thp, qGasMMscfd: qMMscfd });
  if (!onPlateau) {
    return { fthpPsi, fthtF: at(fthpPsi).whtF, fthpSource: 'input' };
  }
  const resid = (thp) => at(thp).pwfPsi - pwfPsi;
  const lo = fthpPsi;
  const hi = Math.max(presPsi ?? fthpPsi * 4, fthpPsi * 1.05);
  const rLo = resid(lo);
  const rHi = resid(hi);
  // no sign change means the choked Pwf is not reachable from any THP in
  // the bracket -- report the input rather than a fabricated number
  if (!(rLo * rHi <= 0)) {
    return { fthpPsi, fthtF: at(fthpPsi).whtF, fthpSource: 'unbracketed' };
  }
  const { root } = brent(resid, lo, hi, { tol: 1e-6 });
  return { fthpPsi: root, fthtF: at(root).whtF, fthpSource: 'solved' };
}
export function gasForecast({
  marchCfg,
  ipr,
  giipBscf,
  pziPsi,
  startGpBscf = 0,
  startDay = 0,
  startPresPsi = null,
  stepDays = 30,
  fthpPsi,
  plateauMMscfd,
  minRateMMscfd = 0.5,
  maxSteps = 60,
}) {
  const cfg = { ...marchCfg, thpPsi: fthpPsi };
  const rows = [];
  let gp = startGpBscf;
  let status = 'max-steps';
  for (let i = 0; i < maxSteps; i++) {
    const pzT = pziPsi * (1 - gp / giipBscf);
    if (pzT <= 10) {
      status = 'depleted';
      break;
    }
    // first step anchors on the given current Pres (workbook AH8 = last
    // solved Pres); later steps come off the p/Z line
    const presPsi = i === 0 && startPresPsi != null ? startPresPsi : presFromPz(cfg, pzT);
    const iprNow = withCurrentPr(ipr, presPsi);
    const op = gasOperatingPoint(cfg, iprNow, { samples: 15 });
    if (op.status !== 'ok') {
      status = 'died';
      break;
    }
    const onPlateau = plateauMMscfd != null && op.qOp > plateauMMscfd;
    const q = onPlateau ? plateauMMscfd : op.qOp;
    if (q < minRateMMscfd) {
      status = 'abandoned';
      break;
    }
    const pwfPsi =
      iprNow.c != null ? pwfAtQGasCn(q, iprNow) : pwfAtQGasJ(q, iprNow);
    // flowing wellhead state: the input FTHP off plateau, back-solved when
    // the well is choked (see forecastWellhead above)
    const wh = forecastWellhead(cfg, { qMMscfd: q, pwfPsi, fthpPsi, onPlateau, presPsi });
    rows.push({
      tDays: startDay + i * stepDays,
      dtDays: i * stepDays,
      presPsi,
      pOverZ: presPsi / zAtRes(cfg, presPsi),
      qMMscfd: q,
      pwfPsi,
      fthpPsi: wh.fthpPsi,
      fthtF: wh.fthtF,
      fthpSource: wh.fthpSource,
      gpBscf: gp,
      onPlateau,
    });
    gp += (q * stepDays) / 1000;
  }
  return { rows, eurBscf: gp, status, recoveryPct: (gp / giipBscf) * 100 };
}
