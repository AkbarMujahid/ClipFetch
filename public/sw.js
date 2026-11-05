// ClipFetch service worker: makes the app installable and loads its shell offline.
// API calls and downloads always go to the network.

const CACHE = "clipfetch-v1";

const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/logo-200.png",
  "/icons/icon-192.png",
  "/icons/favicon-48.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // never cache the API, downloads or the health check
  if (url.origin === location.origin &&
      (url.pathname.startsWith("/api/") || url.pathname === "/health")) {
    return;
  }

  // pages: network first so updates show immediately, cached copy when offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // icons, fonts and other static files: cache first
  const cacheable =
    url.origin === location.origin ||
    url.hostname === "cdnjs.cloudflare.com";

  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
