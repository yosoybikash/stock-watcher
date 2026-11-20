import { buildPushRequest } from "./webpush.js";

/**
 * Send one notification to every subscription.
 * Returns endpoints that the push service says are gone (404/410) so they can be removed.
 */
export async function sendToAll(subscriptions, payload, { privateJwk, contact }, fetchFn = fetch) {
  const gone = [];
  let delivered = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      const { endpoint, headers, body } = await buildPushRequest(subscription, payload, {
        privateJwk,
        contact: contact || "mailto:admin@example.com",
        topic: (payload.tag || "alert").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
      });
      const res = await fetchFn(endpoint, { method: "POST", headers, body });
      if (res.status === 404 || res.status === 410) gone.push(subscription.endpoint);
      else if (res.ok) delivered++;
      else console.warn(`Push failed: HTTP ${res.status} ${await res.text()}`);
    } catch (err) {
      console.warn("Push failed:", err.message);
    }
  }));
  return { delivered, gone };
}
