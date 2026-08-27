// Water/blend pins from "Oil well model Natural_V3.1.7.xls" BHP sheet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waterDensityLbft3,
  liquidViscosityCp,
  waterCutBlend,
} from '../src/core/pvt/water.js';

const REL = 1e-9;
function close(actual, expected, rel = REL) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ${expected}, got ${actual}`
  );
}

test('water density (BHP!AB12: sg=1.05)', () => {
  close(waterDensityLbft3(1.05), 65.483350002);
});

test('liquid viscosity blend (BHP!R18: mu_o=6 cp, WC=50%)', () => {
  close(liquidViscosityCp(6, 12738.7421396532, 6369.37106982661), 3.25);
});

test('water-cut density blend (BHP!AE12: Yw=0.5)', () => {
  close(waterCutBlend(49.7163998673803, 65.483350002, 0.5), 57.5998749346901);
});
