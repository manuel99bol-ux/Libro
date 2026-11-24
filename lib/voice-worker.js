/* Worker delle voci naturali: fonetizzazione con espeak-ng e modello neurale con onnxruntime-web.
   Gestisce due motori:
   - "piper"  (Paola):  veloce, 22 kHz;
   - "kokoro" (Sara):   più espressiva ma più lenta, 24 kHz.
   Gira in background così la pagina resta fluida. */
/* global ort, createPiperPhonemize */
'use strict';

importScripts('ort/ort.wasm.min.js', 'piper/piper_phonemize.js');

const here = (p) => new URL(p, self.location.href).href;
ort.env.wasm.wasmPaths = here('ort/');
// Più core se il browser lo permette (pagina "isolata"), altrimenti uno solo: funziona ovunque.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 2) - 1)) : 1;

const CACHE = 'libro-voci-v1';
let engine = null;   // 'piper' | 'kokoro'
let session = null;
let config = null;   // piper: file .onnx.json
let vocab = null;    // kokoro: simbolo -> id
let styleVec = null; // kokoro: vettori di stile della voce
let phonWasm = null;
let phonData = null;

// Scarica un file usando la Cache del browser: il download avviene una volta sola.
async function getFile(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) { const b = await hit.arrayBuffer(); onBytes && onBytes(b.byteLength); return b; }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download non riuscito (' + res.status + ')');
  let buf;
  if (res.body && res.body.getReader && onBytes) {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      onBytes(value.byteLength);
    }
    const out = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
    onBytes && onBytes(buf.byteLength);
  }
  if (cache) { try { await cache.put(url, new Response(buf.slice(0))); } catch (e) { /* spazio pieno */ } }
  return buf;
}

async function isCached(urls) {
  try {
    const cache = await caches.open(CACHE);
    for (const u of urls) if (!(await cache.match(u))) return false;
    return true;
  } catch (e) { return false; }
}

async function removeCached(urls) {
  try {
    const cache = await caches.open(CACHE);
    for (const u of urls) await cache.delete(u);
  } catch (e) { /* ignora */ }
}

async function init(msg) {
  engine = msg.engine;
  let loaded = 0;
  const progress = (n) => { loaded += n; postMessage({ type: 'progress', loaded, total: msg.totalBytes || 1 }); };
  phonWasm = await getFile(msg.phonWasmUrl, progress);
  phonData = await getFile(msg.phonDataUrl, progress);
  if (engine === 'piper') {
    config = JSON.parse(new TextDecoder().decode(await getFile(msg.configUrl)));
  } else {
    vocab = JSON.parse(new TextDecoder().decode(await getFile(msg.vocabUrl)));
    styleVec = new Float32Array(await getFile(msg.styleUrl, progress));
  }
  const parts = [];
  for (const u of msg.modelUrls) parts.push(new Uint8Array(await getFile(u, progress)));
  const model = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0));
  let off = 0;
  for (const p of parts) { model.set(p, off); off += p.byteLength; }
  postMessage({ type: 'status', text: 'preparing' });
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  postMessage({ type: 'ready', sampleRate: engine === 'piper' ? config.audio.sample_rate : 24000, threads: ort.env.wasm.numThreads });
}

async function phonemize(text) {
  const lines = [];
  const mod = await createPiperPhonemize({
    print: (d) => lines.push(d),
    printErr: () => {},
    wasmBinary: phonWasm,
    getPreloadedPackage: () => phonData.slice(0),
    locateFile: (u) => u,
  });
  mod.callMain(['-l', engine === 'piper' ? config.espeak.voice : 'it', '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  for (const l of lines) {
    try { const j = JSON.parse(l); if (j.phoneme_ids) return j; } catch (e) { /* riga non JSON */ }
  }
  return { phoneme_ids: [], phonemes: [] };
}

async function synthPiper(msg) {
  const ids = (await phonemize(msg.text)).phoneme_ids;
  if (!ids.length) return new Float32Array(0);
  const inf = config.inference;
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    // noise_scale: espressività; length_scale: lentezza; noise_w: variabilità del ritmo.
    scales: new ort.Tensor('float32', Float32Array.from([
      msg.noiseScale != null ? msg.noiseScale : inf.noise_scale,
      (inf.length_scale || 1) * (msg.lengthScale || 1),
      msg.noiseW != null ? msg.noiseW : inf.noise_w,
    ]), [3]),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  return new Float32Array(out.output.data);
}

async function synthKokoro(msg) {
  const ph = (await phonemize(msg.text)).phonemes;
  const ipa = (Array.isArray(ph) ? ph.join('') : String(ph || '')).replace(/([.!?…])(?=\S)/g, '$1 ').trim();
  const ids = [];
  for (const ch of ipa) { const id = vocab[ch]; if (id != null) ids.push(id); }
  if (!ids.length) return new Float32Array(0);
  const n = Math.min(ids.length, 509);
  const out = await session.run({
    input_ids: new ort.Tensor('int64', BigInt64Array.from([0, ...ids.slice(0, n), 0].map(BigInt)), [1, n + 2]),
    // Il vettore di stile dipende dalla lunghezza della frase (così è stato addestrato il modello).
    style: new ort.Tensor('float32', styleVec.slice(n * 256, n * 256 + 256), [1, 256]),
    speed: new ort.Tensor('float32', Float32Array.from([msg.speed || 1]), [1]),
  });
  return new Float32Array(out.waveform.data);
}

let queue = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'check') {
    isCached(msg.urls).then((ok) => postMessage({ type: 'checked', id: msg.id, ok }));
    return;
  }
  if (msg.type === 'remove') {
    removeCached(msg.urls).then(() => postMessage({ type: 'checked', id: msg.id, ok: true }));
    return;
  }
  queue = queue.then(async () => {
    try {
      if (msg.type === 'init') await init(msg);
      else if (msg.type === 'synth') {
        const t0 = Date.now();
        const pcm = engine === 'piper' ? await synthPiper(msg) : await synthKokoro(msg);
        postMessage({ type: 'audio', id: msg.id, pcm, ms: Date.now() - t0 }, [pcm.buffer]);
      }
    } catch (err) {
      postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
    }
  });
};
