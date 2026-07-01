const PRECACHE_URLS = self.__SITCON_PHOTO_FINDER_PRECACHE_URLS__ || ["./"];
const FINDER_DATA_URLS = self.__SITCON_PHOTO_FINDER_DATA_URLS__ || [];
const CACHE_VERSION = self.__SITCON_PHOTO_FINDER_CACHE_VERSION__ || "dev";
const APP_CACHE = `sitcon-photo-finder-app-${CACHE_VERSION}`;
const DATA_CACHE = `sitcon-photo-finder-data-${CACHE_VERSION}`;
const DETAIL_CACHE = `sitcon-photo-finder-detail-${CACHE_VERSION}`;
const CACHE_NAMES = new Set([APP_CACHE, DATA_CACHE, DETAIL_CACHE]);

function sameOriginUrl(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin ? url : null;
}

function normalizedPath(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  const relative = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname.replace(/^\/+/, "");
  return relative || "index.html";
}

const FINDER_DATA_PATHS = new Set(FINDER_DATA_URLS.map((url) => normalizedPath(new URL(url, self.registration.scope))));

function isFinderDataPath(url) {
  return FINDER_DATA_PATHS.has(normalizedPath(url));
}

function isDetailShardPath(url) {
  return /^data\/finder-data\/shards\/photos-\d+\.json$/.test(normalizedPath(url));
}

async function putCache(cacheName, request, response) {
  if (!response || !response.ok) {
    return response;
  }
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function notifyCacheFallback(event, request) {
  if (!event.clientId) {
    return;
  }
  const client = await self.clients.get(event.clientId);
  client?.postMessage({
    type: "sitcon-photo-finder-cache-fallback",
    url: request.url,
  });
}

async function cacheFirstWithBackgroundUpdate(event, cacheName) {
  const cached = await caches.match(event.request);
  const networkPromise = fetch(event.request)
    .then((response) => putCache(cacheName, event.request, response))
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }

  const response = await networkPromise;
  if (response) {
    return response;
  }
  throw new Error(`No cached response for ${event.request.url}`);
}

async function networkFirst(event, cacheName, fallbackUrl = "") {
  try {
    const response = await fetch(event.request);
    return putCache(cacheName, event.request, response);
  } catch (error) {
    const cached = await caches.match(event.request);
    if (cached) {
      event.waitUntil(notifyCacheFallback(event, event.request));
      return cached;
    }
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) {
        event.waitUntil(notifyCacheFallback(event, event.request));
        return fallback;
      }
    }
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("sitcon-photo-finder-") && !CACHE_NAMES.has(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = sameOriginUrl(event.request);
  if (!url) {
    return;
  }

  if (normalizedPath(url) === "service-worker.js") {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event, APP_CACHE, "./index.html"));
    return;
  }

  if (isDetailShardPath(url)) {
    event.respondWith(networkFirst(event, DETAIL_CACHE));
    return;
  }

  if (isFinderDataPath(url)) {
    event.respondWith(networkFirst(event, DATA_CACHE));
    return;
  }

  event.respondWith(cacheFirstWithBackgroundUpdate(event, APP_CACHE));
});
