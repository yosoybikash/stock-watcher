import { describe, it, expect } from "vitest";
import { recentChanges } from "../public/changes.js";

const open = Date.UTC(2026, 10, 20, 14, 30) / 1000;
// 5-minute points from 9:30 to 13:30 New York time, price falls 0.1 each step from 100.
const points = Array.from({ length: 49 }, (_, i) => [open + i * 300, 100 - i * 0.1]);

describe("recentChanges", () => {
  it("measures 5 min, 1 hr, 3 hr and day changes", () => {
    const [m5, h1, h3, day] = recentChanges(points, 101);
    const last = 100 - 48 * 0.1;
    expect(m5.change).toBeCloseTo(((last - (100 - 47 * 0.1)) / (100 - 47 * 0.1)) * 100);
    expect(h1.from).toBeCloseTo(100 - 36 * 0.1);
    expect(h3.from).toBeCloseTo(100 - 12 * 0.1);
    expect(h3.partial).toBe(false);
    expect(day.change).toBeCloseTo(((last - 101) / 101) * 100);
  });
  it("falls back to the open when the window is longer than the day so far", () => {
    const early = points.slice(0, 13); // 9:30 to 10:30
    const [, h1, h3] = recentChanges(early, 101);
    expect(h1.partial).toBe(false);
    expect(h3.partial).toBe(true);
    expect(h3.from).toBe(100);
  });
  it("handles missing data", () => {
    const r = recentChanges([], null);
    expect(r.every((c) => c.change === null)).toBe(true);
  });
});
