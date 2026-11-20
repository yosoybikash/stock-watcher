// Usage: node scripts/vapid.mjs   (prints keys to paste into `wrangler secret put`)
import { generateVapidKeys } from "../src/webpush.js";
const { publicKey, privateJwk } = await generateVapidKeys();
console.log("VAPID_PUBLIC_KEY:\n" + publicKey + "\n\nVAPID_PRIVATE_JWK:\n" + privateJwk);
