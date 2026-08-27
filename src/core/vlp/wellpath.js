// Well trajectory as the workbooks model it: vertical to a kick-off depth,
// then a constant deviation angle to TD. NOTE: the sheets use pi = 22/7 in
// the cosine (BHP!A-column and 'VLP-IPR'!I3) and pi = 3.14 for tubing area —
// both preserved verbatim for bit-parity.

export const EXCEL_PI = 22 / 7;

/** TVD (ft) -> along-hole depth (ft). BHP!A column. */
export function tvdToAhFt(tvdFt, { devStartM = 0, devAngleDeg = 0 }) {
  if (tvdFt / 3.281 <= devStartM) return tvdFt;
  return (
    (tvdFt - devStartM * 3.281) / Math.cos((devAngleDeg * EXCEL_PI) / 180) +
    devStartM * 3.281
  );
}

/** Top-perf TVD (m) from along-hole depth (m). 'VLP-IPR'!I3. */
export function perfTvdM({ topPerfAhM, devStartM = 0, devAngleDeg = 0 }) {
  return devStartM + (topPerfAhM - devStartM) * Math.cos((devAngleDeg * EXCEL_PI) / 180);
}

/**
 * Build a station grid from segment definitions.
 * segments: [{ toTvdFt, steps, zone }] starting from TVD 0. A segment with
 * steps === 0 duplicates the previous depth (used for the ESP intake node).
 * Returns [{ tvdFt, ahFt, zone }] where zone is the segment the station
 * STARTS (gradient at station i drives the step i -> i+1, matching the
 * sheets' explicit Euler convention).
 */
export function buildGrid(segments, path) {
  const stations = [{ tvdFt: 0, ahFt: 0, zone: segments[0].zone }];
  let fromTvd = 0;
  for (const seg of segments) {
    if (seg.steps === 0) {
      stations[stations.length - 1].zone = seg.zone; // re-zone boundary node
      stations.push({ tvdFt: fromTvd, ahFt: tvdToAhFt(fromTvd, path), zone: seg.zone, node: seg.node });
      continue;
    }
    const step = (seg.toTvdFt - fromTvd) / seg.steps;
    for (let i = 1; i <= seg.steps; i++) {
      const tvd = fromTvd + step * i;
      stations.push({ tvdFt: tvd, ahFt: tvdToAhFt(tvd, path), zone: seg.zone });
    }
    fromTvd = seg.toTvdFt;
  }
  return stations;
}
