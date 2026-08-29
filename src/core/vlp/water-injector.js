// Water injection well — the water column marched DOWNWARD: pressure gains
// the hydrostatic head but LOSES friction along the flow direction, so
// BHIP = THP + head - friction. Temperatures relax TOP-DOWN from the
// injection-water temperature toward the geothermal shelf (the same
// K10/K11 relaxation the producer marches use, mirrored — the bottomhole
// injection temperature is the calculated output). Single-phase water:
// density from the water SG (incompressible), viscosity the sheets'
// hardcoded 0.5 cp. The head is pure rho/144 (no Ashry factor — that is a
// production-flow correction); matchHead stays as the tuning knob.
//
// Injectivity IPR (linear, water): q = J_inj * (Pwf - Pr) for Pwf > Pr.

import { buildGrid } from './wellpath.js';
import { chenFanning, frictionGradient, requireInputs, LIQ_LB_PER_FT3 } from './common.js';
import { WATER_VISCOSITY_CP, waterDensityLbft3 } from '../pvt/water.js';
import { brent } from '../solvers/brent.js';

const INJ_REQUIRED = [
  'thpPsi', 'qOilStbD', 'waterSg', 'tubingIdIn', 'roughness', 'perfTvdM',
  'tresF', 'soilTempF', 'htcBtu', 'tubingOdIn',
];

/**
 * March the injection column surface -> perfs. cfg mirrors the water-well
 * march config (qOilStbD = injection rate, bbl/d; thpPsi = injection THP);
 * injTempF is the surface injection-water temperature (default soilTempF).
 * Returns { pwfPsi (BHIP), bhtF, k10, k11, stations }.
 */
export function waterInjectorMarch(cfg) {
  requireInputs(cfg, INJ_REQUIRED, 'water injector march');
  if (cfg.qOilStbD <= 0) throw new Error('water injector march: injection rate must be > 0');
  const path = { devStartM: cfg.devStartM ?? 0, devAngleDeg: cfg.devAngleDeg ?? 0 };
  const totTvdFt = cfg.perfTvdM * 3.281;
  const grid = buildGrid([{ toTvdFt: totTvdFt, steps: 29, zone: 'formation' }], path);

  const rho = waterDensityLbft3(cfg.waterSg);
  const massLbDay = cfg.waterSg * LIQ_LB_PER_FT3 * cfg.qOilStbD * 5.615;
  const injTempF = cfg.injTempF ?? cfg.soilTempF;

  // top-down relaxation toward the geothermal shelf (mirrored Ramey chain,
  // same first-station-spacing quirk as the producers)
  const k10 = ((cfg.tubingOdIn / 12) * 3.14 * cfg.htcBtu) / ((massLbDay / 24) * (cfg.cpBtu ?? 0.51));
  const k11 = Math.exp(-k10 * grid[1].ahFt);
  const shelf = grid.map((g) => cfg.soilTempF + ((cfg.tresF - cfg.soilTempF) / totTvdFt) * g.tvdFt);
  const tF = new Array(grid.length);
  tF[0] = injTempF;
  for (let i = 1; i < grid.length; i++) tF[i] = shelf[i] + (tF[i - 1] - shelf[i]) * k11;

  const gradHead = (rho / 144) * (cfg.matchHead ?? 1);
  const nre = (0.022 * massLbDay) / (cfg.tubingIdIn * WATER_VISCOSITY_CP);
  // Chen's explicit correlation is turbulent-only (its log argument goes
  // negative at laminar Re, which the low-rate operating-point probe hits);
  // laminar Fanning below the transition
  const f = nre < 2100 ? 16 / nre : chenFanning(cfg.roughness, nre);
  const gradFric = frictionGradient(f, massLbDay, cfg.tubingIdIn / 12, rho, cfg.matchFriction ?? 1);

  const stations = [];
  let p = cfg.thpPsi;
  for (let i = 0; i < grid.length; i++) {
    stations.push({ tvdFt: grid[i].tvdFt, ahFt: grid[i].ahFt, pPsi: p, tF: tF[i] });
    if (i === grid.length - 1) break;
    const dTvd = grid[i + 1].tvdFt - grid[i].tvdFt;
    const dAh = grid[i + 1].ahFt - grid[i].ahFt;
    p += gradHead * dTvd - gradFric * dAh; // downward flow: friction subtracts
  }
  return { pwfPsi: p, bhtF: tF[tF.length - 1], k10, k11, gradFricPsiFt: gradFric, stations };
}

/** Injectivity line: q [bbl/d] at a bottomhole pressure. */
export function qInjAtPwf(pwfPsi, { j, prPsi }) {
  return Math.max(0, j * (pwfPsi - prPsi));
}

/** Bottomhole pressure required to inject q. */
export function pwfAtQInj(qBpd, { j, prPsi }) {
  return prPsi + qBpd / j;
}

/**
 * Operating point: available BHIP from the march (falls with rate through
 * friction) crossing the required Pr + q/J (rises with rate). Unique root
 * when the well takes water at all at this THP: available(0) > Pr.
 */
/**
 * Formation parting (fracture) pressure at the perfs, from a fracture
 * GRADIENT in psi/ft — the field's own number, measured by a step-rate or
 * leak-off test. Typical range 0.6-0.8 psi/ft; 0.7 is a common default but is
 * a placeholder, not a prediction: it is an input because it belongs to the
 * rock, and no correlation here can know it.
 *
 * Injecting above this parts the formation. The model does not stop you — a
 * fracture-injection scheme is a legitimate design — but an injectivity that
 * silently sits above the parting pressure is a rate the matrix cannot take,
 * and it must be visible rather than implied.
 */
export function fracturePressurePsi(cfg) {
  const grad = cfg.fracGradPsiFt;
  if (!(grad > 0)) return null;
  return grad * cfg.perfTvdM * 3.281;
}

export function injectorOperatingPoint(cfg, { j, prPsi }, { qMaxBpd = 50000 } = {}) {
  const avail = (q) => waterInjectorMarch({ ...cfg, qOilStbD: q }).pwfPsi;
  const R = (q) => avail(q) - pwfAtQInj(q, { j, prPsi });
  const r0 = R(1);
  if (r0 <= 0) {
    return {
      status: 'no-injection',
      deficitPsi: -r0,
      note: 'THP + water head does not reach Pr — raise the injection THP (or a pump) by the deficit',
    };
  }
  let hi = 1000;
  while (R(hi) > 0 && hi < qMaxBpd) hi *= 2;
  const frac = fracturePressurePsi(cfg);
  // the rate at which the BHIP would reach the parting pressure, when the
  // solved point is already above it — the matrix-injection ceiling
  // The control for over-parting is the SURFACE pressure, not the rate.
  // Available BHIP = THP + head - friction, so it is HIGHEST at low rate:
  // injecting less raises the bottomhole pressure, it does not lower it. The
  // useful answer is therefore the injection THP whose own operating point
  // lands exactly on the parting pressure, solved by re-running the nodal
  // solve at trial THPs.
  const fracInfo = (pwfPsi) => {
    if (frac == null) return {};
    const over = pwfPsi - frac;
    if (over <= 0) return { fracPsi: frac, aboveFracPsi: null };
    let thpAtFrac = null;
    const bhipAtThp = (thp) => {
      const o = injectorOperatingPoint({ ...cfg, thpPsi: thp, fracGradPsiFt: undefined }, { j, prPsi }, { qMaxBpd });
      return o.status === 'ok' || o.status === 'grid-cap' ? o.pwfPsi : null;
    };
    const lo = Math.max(cfg.thpPsi - over * 2, 0);
    const a = bhipAtThp(lo);
    if (a != null && a < frac) {
      thpAtFrac = brent((t) => {
        const p = bhipAtThp(t);
        return p == null ? 1e6 : p - frac;
      }, lo, cfg.thpPsi, { tol: 1e-4 }).root;
    }
    // no THP both injects AND stays below parting: the well cannot take water
    // into the matrix at this reservoir pressure — every feasible THP fractures
    return {
      fracPsi: frac,
      aboveFracPsi: over,
      thpAtFracPsi: thpAtFrac,
      fracUnavoidable: thpAtFrac == null,
    };
  };
  if (R(hi) > 0) {
    const p = avail(hi);
    return { status: 'grid-cap', qOp: hi, pwfPsi: p, ...fracInfo(p) };
  }
  const { root } = brent(R, 1, hi, { tol: 1e-7 });
  const m = waterInjectorMarch({ ...cfg, qOilStbD: root });
  return { status: 'ok', qOp: root, pwfPsi: m.pwfPsi, bhtF: m.bhtF, ...fracInfo(m.pwfPsi) };
}
