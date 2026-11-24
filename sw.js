/* Service worker: rende l'app disponibile anche senza connessione e abilita
   l'"isolamento" della pagina, che permette alle voci naturali di usare più core. */
const CACHE = 'libro-v5';
const FILES = [
  './',
  'index.html',
  'style.css',
  'editor.css',
  'app.js',
  'viewer.js',
  'tts-neural.js',
  'lib/voice-worker.js',
  'lib/piper/piper_phonemize.js',
  'lib/ort/ort.wasm.min.js',
  'lib/ort/ort-wasm-simd-threaded.mjs',
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

// Aggiunge le intestazioni che rendono la pagina "isolata" (necessario per usare più core).
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Rete prima (così gli aggiornamenti arrivano subito), cache se offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // I modelli delle voci e l'audio preparato hanno una cache loro: qui non li duplichiamo.
  const own = url.pathname.includes('/voices/') || url.pathname.includes('/__audio/');
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && !own) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return isolate(res);
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(isolate))
  );
});
