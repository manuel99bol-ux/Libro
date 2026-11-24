/* Service worker: rende l'app disponibile anche senza connessione. */
const CACHE = 'libro-v4';
const FILES = [
  './',
  'index.html',
  'style.css',
  'editor.css',
  'app.js',
  'viewer.js',
  'tts-neural.js',
  'lib/piper/piper-worker.js',
  'lib/piper/piper_phonemize.js',
  'manifest.webmanifest',
  'lib/pdf.min.js',
  'lib/pdf.worker.min.js',
  'lib/pdf-lib.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^libro-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rete prima (così gli aggiornamenti arrivano subito), cache se offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Il modello della voce ha già una cache sua (gestita dal worker della voce).
  if (url.pathname.includes('/voices/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
