import { evaluate, alertKey, formatAlert, nyDate } from "./alerts.js";
import { getQuote } from "./finnhub.js";
import { sendToAll } from "./push.js";

/** One watcher pass: fetch quotes, decide alerts, push them. */
export async function runCheck(env, store, { fetchFn = fetch, now = new Date() } = {}) {
  const watchlist = await store.getWatchlist();
  const today = nyDate(Math.floor(now.getTime() / 1000));
  const sent = await store.sentAlertKeys(watchlist.map((r) => alertKey(r.symbol, today)));

  const results = [];
  for (const rule of watchlist) {
    try {
      const quote = await getQuote(rule.symbol, env.FINNHUB_API_KEY, fetchFn);
      const alert = evaluate(rule, quote, sent);
      results.push({ symbol: rule.symbol, price: quote.c, change: quote.pc ? ((quote.c - quote.pc) / quote.pc) * 100 : 0, alerted: !!alert });
      if (!alert) continue;
      const subs = await store.getSubscriptions();
      const { privateJwk } = await store.getVapidKeys(env);
      const { gone } = await sendToAll(subs, formatAlert(alert), { privateJwk, contact: env.VAPID_CONTACT }, fetchFn);
      if (gone.length) await store.removeSubscriptions(gone);
      await store.markAlertSent(alert.key);
    } catch (err) {
      console.warn(err.message);
      results.push({ symbol: rule.symbol, error: err.message });
    }
  }
  return results;
}
