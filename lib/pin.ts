// PIN-gate crypto shared by the middleware (Edge runtime) and the verify
// route. Uses Web Crypto (crypto.subtle) only — Node's crypto module is not
// available on the Edge runtime, and Web Crypto works in both.
//
// Cookie value = HMAC-SHA256 over a stable payload derived from APP_PIN,
// keyed by APP_PIN_SECRET (REQUIREMENTS §3.1): the cookie never contains the
// PIN, cannot be forged without the secret, and changing APP_PIN invalidates
// every device at once.

export const PIN_COOKIE_NAME = "rc_auth";
export const PIN_COOKIE_MAX_AGE = 180 * 24 * 60 * 60; // 180 days, in seconds

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC-SHA256 hex signature of the stable cookie payload. */
export async function pinCookieValue(pin: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`run-coach-pin-v1:${pin}`)
  );
  return toHex(signature);
}

/** Constant-time string comparison (both sides are hex of equal length in the valid case). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** True when the presented cookie value matches the current APP_PIN/APP_PIN_SECRET pair. */
export async function isValidPinCookie(cookieValue: string | undefined): Promise<boolean> {
  const pin = process.env.APP_PIN;
  const secret = process.env.APP_PIN_SECRET;
  if (!pin || !secret || !cookieValue) return false;
  const expected = await pinCookieValue(pin, secret);
  return timingSafeEqual(cookieValue, expected);
}
