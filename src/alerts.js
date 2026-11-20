// Pure alert logic: no network, no storage. Easy to unit test.

const NY_TZ = "America/New_York";

/** Percent change from previous close, e.g. -3.2 for a 3.2% drop. */
export function percentChange(current, previousClose) {
  if (!previousClose) return 0;
  return ((current - previousClose) / previousClose) * 100;
}

/** Date (YYYY-MM-DD) in New York for a Unix timestamp in seconds. */
export function nyDate(unixSeconds) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

/**
 * True during regular US market hours (Mon–Fri, 9:30–16:00 New York time).
 * Holidays are not tracked here; on a holiday the quote doesn't change and
 * the per-trading-day dedupe in evaluate() stops repeat alerts.
 */
export function isMarketOpen(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * Decide whether a quote should trigger an alert.
 * @param {{symbol:string, dropPercent:number}} rule
 * @param {{c:number, pc:number, t:number}} quote  Finnhub quote (c=current, pc=previous close, t=unix secs)
 * @param {Set<string>|string[]} alreadyAlerted  keys of alerts already sent
 * @returns {null | {key:string, symbol:string, price:number, previousClose:number, change:number, tradingDay:string}}
 */
export function evaluate(rule, quote, alreadyAlerted) {
  if (!quote || !quote.c || !quote.pc || !quote.t) return null;
  const change = percentChange(quote.c, quote.pc);
  if (change > -Math.abs(rule.dropPercent)) return null;
  const tradingDay = nyDate(quote.t);
  const key = alertKey(rule.symbol, tradingDay);
  const sent = alreadyAlerted instanceof Set ? alreadyAlerted : new Set(alreadyAlerted);
  if (sent.has(key)) return null;
  return { key, symbol: rule.symbol, price: quote.c, previousClose: quote.pc, change, tradingDay };
}

export function alertKey(symbol, tradingDay) {
  return `alerted:${tradingDay}:${symbol}`;
}

export function formatAlert(a) {
  return {
    title: `${a.symbol} is down ${Math.abs(a.change).toFixed(1)}%`,
    body: `$${a.price.toFixed(2)}, down from $${a.previousClose.toFixed(2)} at yesterday's close.`,
    tag: a.key,
    url: "/",
  };
}

/** Normalise a user-supplied watchlist. Throws on bad input. */
export function parseWatchlist(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Watchlist must be a non-empty list");
  if (input.length > 50) throw new Error("Watchlist is limited to 50 stocks");
  const seen = new Set();
  return input.map((item) => {
    const symbol = String(item.symbol || "").trim().toUpperCase();
    const dropPercent = Number(item.dropPercent);
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw new Error(`Invalid symbol: ${item.symbol}`);
    if (!(dropPercent > 0 && dropPercent <= 50)) throw new Error(`Drop % for ${symbol} must be between 0 and 50`);
    if (seen.has(symbol)) throw new Error(`Duplicate symbol: ${symbol}`);
    seen.add(symbol);
    return { symbol, dropPercent };
  });
}
