// Skin guidance by drilling / completion / perforation method — REFERENCE
// ranges to support the user's judgment when calibrating Darcy (the user
// sets skin from what they know about the completion; the program then
// recovers the ACTUAL matched K from the test J). These are typical
// industry ranges, not calculations: pick within (or outside) them based on
// well knowledge. A single test J cannot resolve K and skin together, which
// is exactly why skin is the human input here.

export const SKIN_GUIDANCE = [
  { method: 'Open hole, undamaged', min: 0, max: 0 },
  { method: 'Open hole with drilling damage', min: 1, max: 5 },
  { method: 'Cased & perforated, clean/high shot density', min: 0, max: 2 },
  { method: 'Cased & perforated, standard practice', min: 2, max: 5 },
  { method: 'Cased & perforated, limited entry / partial penetration', min: 5, max: 20 },
  { method: 'Gravel pack', min: 5, max: 15 },
  { method: 'Heavy mud-filtrate damage', min: 5, max: 20 },
  { method: 'Acidized (matrix, sandstone)', min: -3, max: -1 },
  { method: 'Acidized (carbonate)', min: -4, max: -1 },
  { method: 'Hydraulically fractured', min: -6, max: -3 },
  { method: 'Horizontal / multilateral (geometric pseudo-skin)', min: -5, max: -2 },
];

/** Guidance rows whose range contains the given skin — handy for showing
 *  the user which completion behaviors their chosen value implies. */
export function skinMethodsFor(skin) {
  return SKIN_GUIDANCE.filter((g) => skin >= g.min && skin <= g.max).map((g) => g.method);
}
