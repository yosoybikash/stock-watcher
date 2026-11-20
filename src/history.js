// Price history for charts.
// Primary: Yahoo Finance's public chart endpoint (no key needed, but unofficial and may change).
// Fallback for the 1-day chart: prices this app records itself every 5 minutes during market hours.

export const RANGES = {
  "1D": { range: "1d", interval: "5m", cacheSeconds: 300 },
  "5D": { range: "5d", interval: "30m", cacheSeconds: 900 },
  "1M": { range: "1mo", interval: "1d", cacheSeconds: 3600 },
  "6M": { range: "6mo", interval: "1d", cacheSeconds: 3600 },
  "1Y": { range: "1y", interval: "1d", cacheSeconds: 3600 },
};

/** Parse Yahoo's chart JSON into { points: [[unixSecs, price]], previousClose }. */
export function parseYahooChart(json) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || "No chart data");
  const times = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < times.length; i++) {
    if (typeof closes[i] === "number") points.push([times[i], Math.round(closes[i] * 100) / 100]);
  }
  if (points.length < 2) throw new Error("Not enough chart data");
  const meta = result.meta || {};
  return { points, previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null };
}

export async function fetchYahooHistory(symbol, rangeKey, fetchFn = fetch) {
  const r = RANGES[rangeKey];
  if (!r) throw new Error(`Unknown range ${rangeKey}`);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r.range}&interval=${r.interval}&includePrePost=false`;
  const res = await fetchFn(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; StockWatcher/1.0)" } });
  if (!res.ok) throw new Error(`History source HTTP ${res.status}`);
  return parseYahooChart(await res.json());
}

/** Add one reading per symbol to today's recorded series (one KV write per run). */
export function appendIntraday(existing, readings) {
  const series = existing ? { ...existing } : {};
  for (const { symbol, t, price } of readings) {
    const list = series[symbol] ? [...series[symbol]] : [];
    if (!list.length || list[list.length - 1][0] !== t) list.push([t, price]);
    series[symbol] = list;
  }
  return series;
}
