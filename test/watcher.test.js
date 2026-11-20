import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { runCheck } from "../src/watcher.js";
import { createStore } from "../src/store.js";

// In-memory stand-in for Cloudflare KV.
function memoryKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
  };
}

async function makeEnv() {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", kp.privateKey);
  return { FINNHUB_API_KEY: "test", VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_CONTACT: "mailto:test@example.com" };
}

async function fakeSubscription() {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
  const b64 = (u) => Buffer.from(u).toString("base64url");
  return { endpoint: "https://push.example.com/abc", keys: { p256dh: b64(raw), auth: b64(webcrypto.getRandomValues(new Uint8Array(16))) } };
}

const NOW = new Date(Date.UTC(2026, 10, 20, 15, 0));
const T = NOW.getTime() / 1000;

describe("runCheck", () => {
  it("pushes once for a stock that dropped 3%+, and not again on the next run", async () => {
    const env = await makeEnv();
    const kv = memoryKV();
    const store = createStore(kv, { watchlist: [{ symbol: "AAPL", dropPercent: 3 }, { symbol: "NVDA", dropPercent: 3 }] });
    await store.addSubscription(await fakeSubscription());

    const pushes = [];
    const fetchFn = async (url, init) => {
      if (url.startsWith("https://finnhub.io/")) {
        const sym = new URL(url).searchParams.get("symbol");
        const q = sym === "AAPL" ? { c: 95, pc: 100, t: T } : { c: 101, pc: 100, t: T };
        return new Response(JSON.stringify(q));
      }
      pushes.push({ url, headers: Object.fromEntries(new Headers(init.headers)) });
      return new Response("", { status: 201 });
    };

    const first = await runCheck(env, store, { fetchFn, now: NOW });
    expect(first.find((r) => r.symbol === "AAPL").alerted).toBe(true);
    expect(first.find((r) => r.symbol === "NVDA").alerted).toBe(false);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].url).toBe("https://push.example.com/abc");
    expect(pushes[0].headers["content-encoding"]).toBe("aes128gcm");
    expect(pushes[0].headers.authorization).toMatch(/^vapid t=/);

    await runCheck(env, store, { fetchFn, now: NOW });
    expect(pushes).toHaveLength(1); // deduped
  });

  it("generates push keys once and reuses them when no VAPID secrets are set", async () => {
    const kv = memoryKV();
    const store = createStore(kv, { watchlist: [] });
    const a = await store.getVapidKeys({});
    const b = await store.getVapidKeys({});
    expect(a.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(b).toEqual(a);
  });

  it("removes subscriptions the push service reports as gone", async () => {
    const env = await makeEnv();
    const store = createStore(memoryKV(), { watchlist: [{ symbol: "TSLA", dropPercent: 3 }] });
    await store.addSubscription(await fakeSubscription());
    const fetchFn = async (url) => url.startsWith("https://finnhub.io/")
      ? new Response(JSON.stringify({ c: 90, pc: 100, t: T }))
      : new Response("", { status: 410 });
    await runCheck(env, store, { fetchFn, now: NOW });
    expect(await store.getSubscriptions()).toEqual([]);
  });
});
