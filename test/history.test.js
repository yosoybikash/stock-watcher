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
