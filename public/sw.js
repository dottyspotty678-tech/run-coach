// Run Coach service worker — read-only offline recency (REQUIREMENTS §5.2):
// network-first with cache fallback for navigations and same-origin GETs, so
// the last-seen plan, meals and shopping list render on a train with no
// signal. The PIN screen and all API routes are never runtime-cached, so
// cached content can never bypass the PIN gate (§3.1).

const CACHE_NAME = "run-coach-v2";
const PRECACHE_URLS = ["/manifest.json", "/icon-192.png", "/icon-512.png"];

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname === "/pin" || url.pathname.startsWith("/pin/")) return false;
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isCacheable(url)) return; // network only — never cached, never served from cache

  // Network-first: fresh data when online, last-seen content when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && (response.type === "basic" || response.type === "default")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const home = await caches.match("/");
          if (home) return home;
        }
        return Response.error();
      })
  );
});
