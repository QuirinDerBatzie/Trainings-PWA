const CACHE = "training-log-cache-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e)=>{
  e.waitUntil(caches.open(CACHE).then(cache=> cache.addAll(ASSETS)));
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    ))
  );
});

self.addEventListener("fetch", (e)=>{
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
