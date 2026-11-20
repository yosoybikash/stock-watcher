// Price change over recent windows, from one day of [unixSecs, price] points.

export const WINDOWS = [
  { key: "5m", label: "5 min", seconds: 5 * 60 },
  { key: "1h", label: "1 hr", seconds: 60 * 60 },
  { key: "3h", label: "3 hr", seconds: 3 * 60 * 60 },
];

/**
 * @param {Array<[number, number]>} points  oldest first, one trading day
 * @param {number|null} previousClose
 * @returns {Array<{key, label, change: number|null, from: number|null, partial: boolean}>}
 *   change is a percent (negative = decline). partial = the window reaches back before the
 *   first point of the day, so the change is measured from the open instead.
 */
export function recentChanges(points, previousClose) {
  const out = [];
  const last = points?.[points.length - 1];
  for (const w of WINDOWS) {
    if (!last || points.length < 2) { out.push({ ...w, change: null, from: null, partial: false }); continue; }
    const target = last[0] - w.seconds;
    let ref = null;
    for (let i = points.length - 2; i >= 0; i--) {
      if (points[i][0] <= target) { ref = points[i]; break; }
    }
    const partial = !ref;
    if (!ref) ref = points[0];
    out.push({ ...w, change: ((last[1] - ref[1]) / ref[1]) * 100, from: ref[1], partial });
  }
  out.push({
    key: "day", label: "Today", seconds: null,
    change: last && previousClose ? ((last[1] - previousClose) / previousClose) * 100 : null,
    from: previousClose ?? null, partial: false,
  });
  return out;
}
