import { NextResponse, type NextRequest } from "next/server";
import { isValidPinCookie, PIN_COOKIE_NAME } from "@/lib/pin";

// PIN gate (REQUIREMENTS §3.1): every page and API route requires the signed
// cookie, with exactly the exemptions listed below. Runs on the Edge runtime,
// so lib/pin.ts uses Web Crypto only.

// Path prefixes that authenticate some other way, or must be reachable pre-auth.
const EXEMPT_PREFIXES = [
  "/api/cron/", // authenticated by the CRON_SECRET header in each route
  "/_next/",
];

const EXEMPT_PATHS = new Set([
  "/pin",
  "/api/pin/verify",
  "/api/strava/callback", // OAuth redirect targets — arrive without our cookie
  "/api/microsoft/callback",
  "/manifest.json",
  "/sw.js",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
]);

// Static assets required pre-auth (icons referenced from the manifest, etc.).
const STATIC_FILE_EXTENSIONS =
  /\.(png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|otf|css|js|map|txt|xml|webmanifest)$/i;

// Expects an already-lowercased pathname.
function isExempt(pathname: string): boolean {
  if (EXEMPT_PATHS.has(pathname)) return true;
  if (EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // File-extension exemption applies to static files, never to API routes.
  if (!pathname.startsWith("/api/") && STATIC_FILE_EXTENSIONS.test(pathname)) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Route matching in Next is case-sensitive (a mis-cased path 404s anyway),
  // but classify case-insensitively so /Api/* clients get JSON 401 rather
  // than an HTML redirect (tester finding m-3).
  const lower = pathname.toLowerCase();

  if (isExempt(lower)) return NextResponse.next();

  const cookie = request.cookies.get(PIN_COOKIE_NAME)?.value;
  if (await isValidPinCookie(cookie)) return NextResponse.next();

  // API requests get JSON, never a redirect.
  if (lower.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Page requests render the PIN screen, remembering where they were headed.
  const pinUrl = request.nextUrl.clone();
  pinUrl.pathname = "/pin";
  pinUrl.search = "";
  if (pathname !== "/") pinUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(pinUrl);
}

export const config = {
  // Skip Next internals entirely; everything else goes through the gate above.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
