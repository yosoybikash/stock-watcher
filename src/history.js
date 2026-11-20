// Price history for charts.
// 1. Twelve Data (official API, free tier: 800 requests/day), used when TWELVEDATA_API_KEY is set.
// 2. Yahoo Finance's public chart endpoint (no key, unofficial; often blocks cloud servers).
// 3. For the 1-day chart only: prices this app records itself every 5 minutes during market hours.
import { nyDate } from "./alerts.js";

export const RANGES = {
  "1D": { range: "1d", interval: "5m", td: { interval: "5min", outputsize: 78 }, cacheSeconds: 300 },
  "5D": { range: "5d", interval: "30m", td: { interval: "30min", outputsize: 65 }, cacheSeconds: 900 },
  "1M": { range: "1mo", interval: "1d", td: { interval: "1day", outputsize: 22 }, cacheSeconds: 3600 },
  "6M": { range: "6mo", interval: "1d", td: { interval: "1day", outputsize: 126 }, cacheSeconds: 3600 },
  "1Y": { range: "1y", interval: "1d", td: { interval: "1day", outputsize: 252 }, cacheSeconds: 3600 },
};

/** Parse Twelve Data time_series JSON (newest first, UTC datetimes) into { points, previousClose }. */
export function parseTwelveData(json, rangeKey) {
  if (json?.status !== "ok" || !Array.isArray(json.values)) {
    throw new Error(json?.message ? `Twelve Data: ${json.message}` : "Twelve Data: no data");
  }
  let points = json.values
    .map((v) => [Math.floor(Date.parse(v.datetime.replace(" ", "T") + (v.datetime.length > 10 ? "Z" : "T00:00:00Z")) / 1000), Math.round(parseFloat(v.close) * 100) / 100])
    .filter(([t, p]) => Number.isFinite(t) && Number.isFinite(p))
    .reverse();
  if (rangeKey === "1D" && points.length) {
    // Keep only the most recent trading day.
    const day = nyDate(points[points.length - 1][0]);
    points = points.filter(([t]) => nyDate(t) === day);
  }
  if (points.length < 2) throw new Error("Not enough chart data");
  return { points, previousClose: null };
}

export async function fetchTwelveDataHistory(symbol, rangeKey, apiKey, fetchFn = fetch) {
  const r = RANGES[rangeKey];
  if (!r) throw new Error(`Unknown range ${rangeKey}`);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${r.td.interval}&outputsize=${r.td.outputsize}&timezone=UTC&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  return parseTwelveData(await res.json(), rangeKey);
}

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
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  return parseYahooChart(await res.json());
}

/** Try each configured source in order; collect reasons if all fail. */
export async function fetchHistory(symbol, rangeKey, env, fetchFn = fetch) {
  const errors = [];
  if (env.TWELVEDATA_API_KEY) {
    try {
      return { source: "twelvedata", ...(await fetchTwelveDataHistory(symbol, rangeKey, env.TWELVEDATA_API_KEY, fetchFn)) };
    } catch (err) { errors.push(err.message); }
  }
  try {
    return { source: "yahoo", ...(await fetchYahooHistory(symbol, rangeKey, fetchFn)) };
  } catch (err) { errors.push(err.message); }
  const e = new Error(errors.join("; "));
  e.needsKey = !env.TWELVEDATA_API_KEY;
  throw e;
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
