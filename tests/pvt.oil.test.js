// PVT oil regression tests — every expected value is pinned to a solved cell
// of "Oil well model Natural_V3.1.7.xls" (gg=0.842, API=46, Tres=201 F,
// Rsi=700 scf/stb, Pr=3550 psi). Cell references in comments.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  oilSpecificGravity,
  oilDensityScKgm3,
  fahrenheitToCelsius,
  bubblePointPsi,
  solutionGorScfStb,
  oilFvfSaturated,
  oilFvf,
  oilDensityLbft3,
  deadOilViscosityCp,
  beggsRobinsonA,
  beggsRobinsonB,
  vasquezBeggsM,
  oilViscosityCp,
} from '../src/core/pvt/oil.js';
import { scfStbToM3M3, LBFT3_PER_KGM3 } from '../src/core/pvt/constants.js';

const REL = 1e-9;
function close(actual, expected, rel = REL) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual} (rel err ${Math.abs(actual - expected) / Math.abs(expected)})`
  );
}

const CASE = { rsiScfStb: 700, gasSg: 0.842, api: 46, tempF: 201 };
const PB = 1920.00761413201; // 'VLP-IPR'!B2
const P = { ...CASE, pbPsi: PB };

test('oil specific gravity and density ("VLP-IPR"!E11:E12)', () => {
  close(oilSpecificGravity(46), 0.797183098591549);
  close(oilDensityScKgm3(46), 796.380093505352);
});

test('temperature and Rsi conversions ("VLP-IPR"!E13, E8)', () => {
  close(fahrenheitToCelsius(201), 93.8888888888889);
  close(scfStbToM3M3(700), 124.675316671827);
});

test('bubble point pressure ("VLP-IPR"!B2)', () => {
  close(bubblePointPsi(CASE), 1920.00761413201);
});

test('solution GOR below Pb (BHP!AF22 at 700 psi)', () => {
  close(solutionGorScfStb(700, P), 213.440464457472);
});

test('solution GOR at/above Pb returns Rsi (BHP!AF50 at 6685 psi)', () => {
  assert.equal(solutionGorScfStb(6684.57466648165, P), 700);
});

test('saturated Bo at Rsi — Bob (BHP!AJ19)', () => {
  close(oilFvfSaturated(700, CASE), 1.43579629831069);
});

test('Bo below Pb (BHP!AJ22 at 700 psi)', () => {
  close(oilFvf(700, P), 1.16898275999153);
});

test('Bo above Pb (BHP!AJ51 at 6897.5 psi)', () => {
  close(oilFvf(6897.525558667, P), 1.41451547673272);
});

// rhoGscKgm3 passed as the workbook's stored `rouhgsc` value so the chain is
// verified bit-for-bit (the stored value itself carries a GoalSeek artifact;
// gasDensityScKgm3() supplies the converged one in production use).
const RHO_GSC_EXCEL = 0.938693049598781; // BHP!AA18

test('live oil density below Pb (BHP!AK22 at 700 psi)', () => {
  close(oilDensityLbft3(700, { ...P, rhoGscKgm3: RHO_GSC_EXCEL }), 44.4353237677132);
});

test('oil density at Pb in kg/m3 (BHP!AK19)', () => {
  const lbft3 = oilDensityLbft3(PB, { ...P, rhoGscKgm3: RHO_GSC_EXCEL });
  close(lbft3 / LBFT3_PER_KGM3, 636.17098595143);
});

test('Glaso dead oil viscosity ("VLP-IPR"!B9)', () => {
  close(deadOilViscosityCp(CASE), 0.577599294400085);
});

test('Beggs-Robinson live multipliers ("VLP-IPR"!B11, B13)', () => {
  close(beggsRobinsonA(700), 0.342689527000648);
  close(beggsRobinsonB(700), 0.55648735813792);
});

test('Vasquez-Beggs undersaturated exponent at Pr ("VLP-IPR"!B14)', () => {
  close(vasquezBeggsM(3550), 0.309488419432605);
});

test('oil viscosity is near-continuous across Pb', () => {
  // The Excel Pb<->Rs pair does not round-trip exactly (the Pb calibration
  // factor makes Rs(Pb-) ~ 699.4 vs Rsi=700), so the correlations carry an
  // inherent ~0.03% viscosity step at Pb. Ported faithfully; assert the step
  // stays that small.
  const below = oilViscosityCp(PB - 1e-6, P);
  const above = oilViscosityCp(PB + 1e-6, P);
  close(below, above, 1e-3);
});
