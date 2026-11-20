import { describe, it, expect } from "vitest";
import { evaluate, isMarketOpen, nyDate, parseWatchlist, formatAlert, percentChange } from "../src/alerts.js";

// 2026-11-20 15:00 UTC = 10:00 New York (Friday)
const T = Date.UTC(2026, 10, 20, 15, 0) / 1000;
const rule = { symbol: "AAPL", dropPercent: 3 };

describe("evaluate", () => {
  it("alerts at exactly the threshold", () => {
    const a = evaluate(rule, { c: 97, pc: 100, t: T }, []);
    expect(a).toMatchObject({ symbol: "AAPL", key: "alerted:2026-11-20:AAPL" });
    expect(a.change).toBeCloseTo(-3);
  });
  it("does not alert for a smaller drop or a rise", () => {
    expect(evaluate(rule, { c: 97.5, pc: 100, t: T }, [])).toBeNull();
    expect(evaluate(rule, { c: 105, pc: 100, t: T }, [])).toBeNull();
  });
  it("alerts only once per trading day", () => {
    expect(evaluate(rule, { c: 90, pc: 100, t: T }, ["alerted:2026-11-20:AAPL"])).toBeNull();
    expect(evaluate(rule, { c: 90, pc: 100, t: T + 86400 * 3 }, ["alerted:2026-11-20:AAPL"])).not.toBeNull();
  });
  it("ignores empty quotes", () => {
    expect(evaluate(rule, { c: 0, pc: 0, t: 0 }, [])).toBeNull();
  });
});

describe("market hours", () => {
  it("is open at 10:00 New York on a weekday", () => {
    expect(isMarketOpen(new Date(T * 1000))).toBe(true);
  });
  it("is closed before 9:30, after 16:00, and on weekends", () => {
    expect(isMarketOpen(new Date(Date.UTC(2026, 10, 20, 14, 29)))).toBe(false); // 9:29
    expect(isMarketOpen(new Date(Date.UTC(2026, 10, 20, 21, 0)))).toBe(false);  // 16:00
    expect(isMarketOpen(new Date(Date.UTC(2026, 10, 21, 15, 0)))).toBe(false);  // Saturday
  });
  it("handles daylight saving time (July, UTC-4)", () => {
    expect(isMarketOpen(new Date(Date.UTC(2026, 6, 15, 13, 30)))).toBe(true);   // 9:30 EDT
  });
  it("uses the New York date", () => {
    expect(nyDate(Date.UTC(2026, 10, 21, 2, 0) / 1000)).toBe("2026-11-20"); // 21:00 NY on the 20th
  });
});

describe("watchlist + formatting", () => {
  it("normalises and validates", () => {
    expect(parseWatchlist([{ symbol: " nvda ", dropPercent: "2.5" }])).toEqual([{ symbol: "NVDA", dropPercent: 2.5 }]);
    expect(() => parseWatchlist([{ symbol: "AAPL", dropPercent: 0 }])).toThrow();
    expect(() => parseWatchlist([{ symbol: "AAPL", dropPercent: 3 }, { symbol: "aapl", dropPercent: 3 }])).toThrow();
    expect(() => parseWatchlist([])).toThrow();
  });
  it("formats an alert", () => {
    const a = evaluate(rule, { c: 96.1, pc: 100, t: T }, []);
    expect(formatAlert(a).title).toBe("AAPL is down 3.9%");
    expect(percentChange(50, 0)).toBe(0);
  });
});
