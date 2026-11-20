import { describe, it, expect } from "vitest";
import { parseYahooChart, appendIntraday, fetchYahooHistory } from "../src/history.js";

const sample = { chart: { result: [{
  meta: { chartPreviousClose: 130.5 },
  timestamp: [1, 2, 3, 4],
  indicators: { quote: [{ close: [129.111, null, 127.5, 125.53] }] },
}], error: null } };

describe("history", () => {
  it("parses Yahoo chart data and skips gaps", () => {
    expect(parseYahooChart(sample)).toEqual({ points: [[1, 129.11], [3, 127.5], [4, 125.53]], previousClose: 130.5 });
  });
  it("throws on errors or empty data", () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { description: "No data found" } } })).toThrow("No data found");
    expect(() => parseYahooChart({ chart: { result: [{ timestamp: [1], indicators: { quote: [{ close: [1] }] } }] } })).toThrow();
  });
  it("builds the right request", async () => {
    let seen;
    await fetchYahooHistory("NVDA", "5D", async (url) => { seen = url; return new Response(JSON.stringify(sample)); });
    expect(seen).toContain("/chart/NVDA?range=5d&interval=30m");
    await expect(fetchYahooHistory("NVDA", "10Y")).rejects.toThrow();
  });
  it("appends readings without duplicates", () => {
    let s = appendIntraday(null, [{ symbol: "AAPL", t: 10, price: 1 }]);
    s = appendIntraday(s, [{ symbol: "AAPL", t: 10, price: 1 }, { symbol: "NVDA", t: 10, price: 2 }]);
    s = appendIntraday(s, [{ symbol: "AAPL", t: 20, price: 3 }]);
    expect(s).toEqual({ AAPL: [[10, 1], [20, 3]], NVDA: [[10, 2]] });
  });
});

import { parseTwelveData, fetchHistory } from "../src/history.js";

describe("twelve data", () => {
  const td = { status: "ok", values: [
    { datetime: "2026-11-20 20:55:00", close: "125.53" },
    { datetime: "2026-11-20 14:30:00", close: "127.10" },
    { datetime: "2026-11-19 20:55:00", close: "127.80" },
  ] };
  it("parses newest-first UTC values, keeping only the latest day for 1D", () => {
    const r = parseTwelveData(td, "1D");
    expect(r.points).toEqual([[Date.UTC(2026, 10, 20, 14, 30) / 1000, 127.1], [Date.UTC(2026, 10, 20, 20, 55) / 1000, 125.53]]);
    expect(parseTwelveData(td, "5D").points).toHaveLength(3);
  });
  it("parses daily dates", () => {
    const r = parseTwelveData({ status: "ok", values: [{ datetime: "2026-11-20", close: "1" }, { datetime: "2026-11-19", close: "2" }] }, "1M");
    expect(r.points[0]).toEqual([Date.UTC(2026, 10, 19) / 1000, 2]);
  });
  it("reports API errors", () => {
    expect(() => parseTwelveData({ status: "error", code: 401, message: "Invalid API key" }, "1D")).toThrow("Invalid API key");
  });
  it("uses Twelve Data first and falls back to Yahoo", async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(new URL(url).host);
      if (url.includes("twelvedata")) return new Response(JSON.stringify({ status: "error", message: "limit" }));
      return new Response(JSON.stringify({ chart: { result: [{ meta: {}, timestamp: [1, 2], indicators: { quote: [{ close: [1, 2] }] } }] } }));
    };
    const r = await fetchHistory("NVDA", "1M", { TWELVEDATA_API_KEY: "k" }, fetchFn);
    expect(r.source).toBe("yahoo");
    expect(calls).toEqual(["api.twelvedata.com", "query1.finance.yahoo.com"]);
    await expect(fetchHistory("NVDA", "1M", {}, async () => new Response("", { status: 429 }))).rejects.toMatchObject({ needsKey: true });
  });
});
