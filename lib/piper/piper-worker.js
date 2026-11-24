/* Worker della voce neurale: fonetizzazione (espeak-ng) + modello Piper (ONNX).
   Gira in background così la pagina resta fluida mentre la voce viene generata. */
/* global ort, createPiperPhonemize */
'use strict';

importScripts('../ort/ort.wasm.min.js', 'piper_phonemize.js');

ort.env.wasm.numThreads = 1;          // niente SharedArrayBuffer: funziona su qualsiasi hosting
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = new URL('../ort/', self.location.href).href;

const CACHE = 'libro-voci-v1';
let session = null;
let config = null;
let phonWasm = null;
let phonData = null;

// Scarica un file usando (se disponibile) la Cache del browser, così il download avviene una volta sola.
async function getFile(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) { const b = await hit.arrayBuffer(); onBytes && onBytes(b.byteLength); return b; }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download non riuscito (' + res.status + '): ' + url);
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
      onBytes(value.byteLength, true);
    }
    const out = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
    onBytes && onBytes(buf.byteLength);
  }
  if (cache) { try { await cache.put(url, new Response(buf.slice(0))); } catch (e) { /* spazio pieno: pazienza */ } }
  return buf;
}

async function isCached(urls) {
  try {
    const cache = await caches.open(CACHE);
    for (const u of urls) if (!(await cache.match(u))) return false;
    return true;
  } catch (e) { return false; }
}

async function init(msg) {
  const total = msg.totalBytes || 1;
  let loaded = 0;
  const progress = (n) => { loaded += n; postMessage({ type: 'progress', loaded, total }); };
  config = JSON.parse(new TextDecoder().decode(await getFile(msg.configUrl)));
  phonWasm = await getFile(msg.phonWasmUrl, progress);
  phonData = await getFile(msg.phonDataUrl, progress);
  const parts = [];
  for (const u of msg.modelUrls) parts.push(new Uint8Array(await getFile(u, progress)));
  const size = parts.reduce((a, p) => a + p.byteLength, 0);
  const model = new Uint8Array(size);
  let off = 0;
  for (const p of parts) { model.set(p, off); off += p.byteLength; }
  postMessage({ type: 'status', text: 'preparing' });
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  postMessage({ type: 'ready', sampleRate: config.audio.sample_rate });
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
  mod.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  for (const l of lines) {
    try { const j = JSON.parse(l); if (j.phoneme_ids) return j.phoneme_ids; } catch (e) { /* riga non JSON */ }
  }
  return [];
}

async function synth(msg) {
  const ids = await phonemize(msg.text);
  if (!ids.length) return new Float32Array(0);
  const inf = config.inference;
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    // noise_scale: espressività della voce; noise_w: variabilità del ritmo; length_scale: lentezza.
    scales: new ort.Tensor('float32', Float32Array.from([
      msg.noiseScale != null ? msg.noiseScale : inf.noise_scale,
      (inf.length_scale || 1) * (msg.lengthScale || 1),
      msg.noiseW != null ? msg.noiseW : inf.noise_w,
    ]), [3]),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  return new Float32Array(out.output.data); // copia indipendente, trasferibile alla pagina
}

// Le richieste vengono eseguite una alla volta, nell'ordine di arrivo.
let queue = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'check') {
    isCached(msg.urls).then((ok) => postMessage({ type: 'checked', id: msg.id, ok }));
    return;
  }
  queue = queue.then(async () => {
    try {
      if (msg.type === 'init') await init(msg);
      else if (msg.type === 'synth') {
        const t0 = Date.now();
        const pcm = await synth(msg);
        postMessage({ type: 'audio', id: msg.id, pcm, ms: Date.now() - t0 }, [pcm.buffer]);
      }
    } catch (err) {
      postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
    }
  });
};
