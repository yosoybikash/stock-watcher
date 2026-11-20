// Minimal Web Push sender using only the Web Crypto API (works in Cloudflare Workers).
// Encryption: RFC 8291 (aes128gcm). Auth: RFC 8292 (VAPID, ES256 JWT).

const enc = new TextEncoder();

export const b64url = {
  encode(bytes) {
    let s = "";
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  },
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** Encrypt a payload for one subscription (RFC 8291). Returns the request body. */
export async function encryptPayload(subscription, plaintext, { salt, localKeys } = {}) {
  const uaPublic = b64url.decode(subscription.keys.p256dh);
  const authSecret = b64url.decode(subscription.keys.auth);
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  localKeys ??= await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", localKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, localKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const data = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  const padded = concat(data, new Uint8Array([2])); // 0x02 = last (and only) record
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));

  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** Build the VAPID Authorization header value (RFC 8292). */
export async function vapidAuthorization(endpoint, privateJwk, contact) {
  const jwk = typeof privateJwk === "string" ? JSON.parse(privateJwk) : privateJwk;
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url.encode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: contact,
  })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  const publicKey = b64url.encode(concat(new Uint8Array([4]), b64url.decode(jwk.x), b64url.decode(jwk.y)));
  return `vapid t=${header}.${claims}.${b64url.encode(signature)}, k=${publicKey}`;
}

/** Build a ready-to-send push request. */
export async function buildPushRequest(subscription, payload, { privateJwk, contact, ttl = 3600, urgency = "high", topic }) {
  const body = await encryptPayload(subscription, JSON.stringify(payload));
  const headers = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(ttl),
    Urgency: urgency,
    Authorization: await vapidAuthorization(subscription.endpoint, privateJwk, contact),
  };
  if (topic) headers.Topic = topic;
  return { endpoint: subscription.endpoint, headers, body };
}

/** Generate a VAPID key pair: public key (base64url, for the browser) + private JWK (for the server). */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const publicKey = b64url.encode(concat(new Uint8Array([4]), b64url.decode(jwk.x), b64url.decode(jwk.y)));
  return { publicKey, privateJwk: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }) };
}
