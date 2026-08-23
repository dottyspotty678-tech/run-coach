import { NextResponse } from "next/server";
import { PIN_COOKIE_MAX_AGE, PIN_COOKIE_NAME, pinCookieValue, timingSafeEqual } from "@/lib/pin";

// POST /api/pin/verify with { pin: string } (REQUIREMENTS §3.1, DESIGN §6):
// 200 → signed cookie set (the client redirects itself, honouring ?next=),
// 401 → wrong PIN, 429 + { retryAfterSeconds } → locked out.
//
// Lockout state is in-memory per serverless instance. Caveat: on Vercel each
// warm lambda keeps its own map, and a cold start resets it — so a determined
// attacker spread across instances gets more than 5 tries per 30 s. For a
// 4-digit PIN on a single-user app this is an accepted trade-off (the spec
// asks for a per-session brake, not bank-grade throttling).
const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;

type Attempts = { failures: number; lockedUntil: number };
const attemptsByClient = new Map<string, Attempts>();

function clientKey(request: Request): string {
  // Best-available session identity: the client IP.
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const appPin = process.env.APP_PIN;
  const secret = process.env.APP_PIN_SECRET;
  if (!appPin || !secret) {
    return NextResponse.json({ error: "PIN is not configured" }, { status: 500 });
  }

  const key = clientKey(request);
  const state = attemptsByClient.get(key) ?? { failures: 0, lockedUntil: 0 };

  const now = Date.now();
  if (state.lockedUntil > now) {
    return NextResponse.json(
      { retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) },
      { status: 429 }
    );
  }

  let pin = "";
  try {
    const body = (await request.json()) as { pin?: unknown };
    if (typeof body.pin === "string") pin = body.pin;
  } catch {
    // Malformed body — treated as a wrong PIN below.
  }

  // Length is public knowledge (4 digits), so a length pre-check leaks nothing.
  const ok = pin.length === appPin.length && timingSafeEqual(pin, appPin);

  if (!ok) {
    state.failures += 1;
    if (state.failures >= MAX_FAILURES) {
      state.lockedUntil = now + LOCKOUT_MS;
      state.failures = 0;
      attemptsByClient.set(key, state);
      return NextResponse.json(
        { retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) },
        { status: 429 }
      );
    }
    attemptsByClient.set(key, state);
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }

  attemptsByClient.delete(key);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PIN_COOKIE_NAME, await pinCookieValue(appPin, secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: PIN_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}
