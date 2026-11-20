// Thin wrapper over a Cloudflare KV namespace.
import { generateVapidKeys } from "./webpush.js";

const SUBS = "subscriptions";
const WATCHLIST = "watchlist";
const VAPID = "vapid-keys";

export function createStore(kv, defaults) {
  return {
    async getWatchlist() {
      return (await kv.get(WATCHLIST, "json")) || defaults.watchlist;
    },
    async setWatchlist(list) {
      await kv.put(WATCHLIST, JSON.stringify(list));
    },
    async getSubscriptions() {
      return (await kv.get(SUBS, "json")) || [];
    },
    async addSubscription(sub) {
      const subs = await this.getSubscriptions();
      if (!subs.some((s) => s.endpoint === sub.endpoint)) subs.push(sub);
      await kv.put(SUBS, JSON.stringify(subs));
      return subs.length;
    },
    async removeSubscriptions(endpoints) {
      const drop = new Set(endpoints);
      const subs = (await this.getSubscriptions()).filter((s) => !drop.has(s.endpoint));
      await kv.put(SUBS, JSON.stringify(subs));
    },
    async sentAlertKeys(keys) {
      const values = await Promise.all(keys.map((k) => kv.get(k)));
      return new Set(keys.filter((_, i) => values[i] !== null));
    },
    /**
     * Push (VAPID) keys. Uses VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK secrets if set;
     * otherwise generates a pair on first use and keeps it in KV, so no manual setup is needed.
     */
    async getVapidKeys(env = {}) {
      if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK) {
        return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK };
      }
      let keys = await kv.get(VAPID, "json");
      if (!keys) {
        keys = await generateVapidKeys();
        await kv.put(VAPID, JSON.stringify(keys));
      }
      return keys;
    },
    async markAlertSent(key) {
      // Keep for 3 days; it only needs to outlive the trading day.
      await kv.put(key, "1", { expirationTtl: 3 * 24 * 3600 });
    },
  };
}
