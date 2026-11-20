import { isMarketOpen, parseWatchlist, percentChange } from "./alerts.js";
import { getQuote } from "./finnhub.js";
import { createStore } from "./store.js";
import { sendToAll } from "./push.js";
import { runCheck } from "./watcher.js";

const DEFAULT_WATCHLIST = [
  { symbol: "AAPL", dropPercent: 3 },
  { symbol: "NVDA", dropPercent: 3 },
  { symbol: "TSLA", dropPercent: 3 },
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function authorized(request, env) {
  const header = request.headers.get("authorization") || "";
  return env.APP_TOKEN && header === `Bearer ${env.APP_TOKEN}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const store = createStore(env.KV, { watchlist: DEFAULT_WATCHLIST });

    if (url.pathname === "/api/config" && request.method === "GET") {
      return json({ vapidPublicKey: (await store.getVapidKeys(env)).publicKey });
    }

    // Everything below needs the app token, so strangers can't read or change your data.
    if (!env.APP_TOKEN || !env.FINNHUB_API_KEY) {
      return json({ error: "Setup incomplete: add the APP_TOKEN and FINNHUB_API_KEY secrets in Cloudflare" }, 500);
    }
    if (!authorized(request, env)) return json({ error: "Wrong or missing access token" }, 401);

    try {
      switch (`${request.method} ${url.pathname}`) {
        case "GET /api/watchlist":
          return json(await store.getWatchlist());
        case "PUT /api/watchlist": {
          const list = parseWatchlist(await request.json());
          await store.setWatchlist(list);
          return json(list);
        }
        case "GET /api/quotes": {
          const list = await store.getWatchlist();
          const quotes = await Promise.all(list.map(async (r) => {
            try {
              const q = await getQuote(r.symbol, env.FINNHUB_API_KEY);
              return { ...r, price: q.c, previousClose: q.pc, change: percentChange(q.c, q.pc), time: q.t };
            } catch (err) {
              return { ...r, error: err.message };
            }
          }));
          return json({ marketOpen: isMarketOpen(), quotes });
        }
        case "POST /api/subscribe": {
          const sub = await request.json();
          if (!sub?.endpoint?.startsWith("https://") || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return json({ error: "Invalid push subscription" }, 400);
          }
          return json({ devices: await store.addSubscription(sub) });
        }
        case "POST /api/unsubscribe": {
          const { endpoint } = await request.json();
          await store.removeSubscriptions([endpoint]);
          return json({ ok: true });
        }
        case "POST /api/test-alert": {
          const subs = await store.getSubscriptions();
          const { privateJwk } = await store.getVapidKeys(env);
          const result = await sendToAll(subs, {
            title: "Stock Watcher test",
            body: "Push notifications are working.",
            tag: "test",
            url: "/",
          }, { privateJwk, contact: env.VAPID_CONTACT });
          if (result.gone.length) await store.removeSubscriptions(result.gone);
          return json(result);
        }
        case "POST /api/check-now":
          return json(await runCheck(env, store));
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      return json({ error: err.message }, 400);
    }
  },

  async scheduled(event, env, ctx) {
    if (!isMarketOpen(new Date(event.scheduledTime))) return;
    const store = createStore(env.KV, { watchlist: DEFAULT_WATCHLIST });
    ctx.waitUntil(runCheck(env, store));
  },
};
