// Finnhub free tier: 60 requests/minute, live US quotes. https://finnhub.io/docs/api/quote
export async function getQuote(symbol, apiKey, fetchFn = fetch) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Finnhub ${symbol}: HTTP ${res.status}`);
  const q = await res.json();
  // Finnhub returns zeros for unknown symbols.
  if (!q || !q.c) throw new Error(`Finnhub ${symbol}: no quote (unknown symbol?)`);
  return q; // { c, d, dp, h, l, o, pc, t }
}
