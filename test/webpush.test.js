import { describe, it, expect } from "vitest";
import ece from "http_ece"; // reference implementation used by the web-push library
import { createECDH, createPublicKey, verify, randomBytes } from "node:crypto";
import { encryptPayload, vapidAuthorization, generateVapidKeys, b64url } from "../src/webpush.js";

describe("web push encryption (RFC 8291)", () => {
  it("decrypts correctly with the reference implementation", async () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const sub = { endpoint: "https://x", keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(auth) } };
    const message = JSON.stringify({ title: "AAPL is down 3.4%", body: "test ✓" });
    const body = await encryptPayload(sub, message);
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth });
    expect(plain.toString()).toBe(message);
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a valid ES256 JWT for the endpoint origin", async () => {
    const { publicKey, privateJwk } = await generateVapidKeys();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", privateJwk, "mailto:a@b.c");
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(k).toBe(publicKey);
    const [h, c, s] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url"));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:a@b.c");
    const jwk = JSON.parse(privateJwk);
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
    const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});
