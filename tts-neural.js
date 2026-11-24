/* Voci naturali eseguite nel browser (senza server, offline dopo il download):
   - Paola (Piper): veloce, genera ogni frase al momento;
   - Sara (Kokoro): più espressiva ma più lenta: prepara l'audio in anticipo e lo conserva. */
(function () {
  'use strict';

  // Alcuni hosting servono solo certi tipi di file: lì i file binari hanno un suffisso in più.
  const SFX = window.LIBRO_BIN_SUFFIX || '';
  const abs = (u) => new URL(u, location.href).href;
  const PHON_WASM = 'lib/piper/piper_phonemize.wasm';
  const PHON_DATA = 'lib/piper/piper_phonemize.data' + SFX;
  const PHON_BYTES = 635212 + 1064825;
  const CANCELED = { canceled: true };
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';

  const store = {
    get(k, d) { try { const v = localStorage.getItem('libro:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('libro:' + k, JSON.stringify(v)); } catch (e) { /* ignora */ } },
  };

  // Impronta breve di un testo (per dare un nome ai file audio preparati).
  function hash(s) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822507);
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
  }

  // Pausa dopo una frase, in base a come finisce.
  function pauseFor(text, base) {
    const t = text.trim();
    if (/(\.\.\.|…)["»”’)]*$/.test(t)) return base * 1.4;
    if (/[?!]["»”’)]*$/.test(t)) return base * 1.15;
    if (/[:;]["»”’)]*$/.test(t)) return base * 0.8;
    if (!/[.!?]["»”’)]*$/.test(t)) return base * 0.55; // pezzo di una frase lunga
    return base;
  }

  // Float32 -> WAV 16 bit, togliendo i silenzi in testa e in coda e aggiungendo la pausa voluta.
  function encodeWav(pcm, sampleRate, pauseMs) {
    const thr = 0.008;
    const margin = Math.round(sampleRate * 0.03);
    let a = 0, b = pcm.length;
    while (a < b && Math.abs(pcm[a]) < thr) a++;
    while (b > a && Math.abs(pcm[b - 1]) < thr) b--;
    a = Math.max(0, a - margin);
    b = Math.min(pcm.length, b + margin);
    const body = pcm.subarray(a, b);
    const pad = Math.round(sampleRate * pauseMs / 1000);
    const n = body.length + pad;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    let peak = 0;
    for (let i = 0; i < body.length; i++) peak = Math.max(peak, Math.abs(body[i]));
    const gain = peak > 0 ? Math.min(3, 0.92 / peak) : 1;
    let o = 44;
    for (let i = 0; i < body.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, body[i] * gain));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return { blob: new Blob([buf], { type: 'audio/wav' }), dur: n / sampleRate };
  }

  // ---------- Riproduzione (un solo elemento audio per tutte le voci) ----------
  const Player = {
    audio: null,
    unlocked: false,
    token: 0,
    current: null,
    // Va chiamata dentro il tocco dell'utente (Leggi): sblocca l'audio su iPhone.
    unlock() {
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.audio.setAttribute('playsinline', '');
      }
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignora */ }
      if (this.unlocked) return;
      this.unlocked = true;
      this.audio.src = SILENT;
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => { this.unlocked = false; });
    },
    play(url, rate, token) {
      return new Promise((resolve, reject) => {
        if (token !== this.token) { reject(CANCELED); return; }
        const a = this.audio;
        this.current = { token, reject };
        const done = (fn) => () => { if (this.current && this.current.token === token) { this.current = null; fn(); } };
        a.onended = done(resolve);
        a.onerror = done(() => reject(new Error('Riproduzione non riuscita')));
        a.src = url;
        a.preservesPitch = true;
        a.playbackRate = rate || 1;
        const p = a.play();
        if (p && p.catch) p.catch((err) => { if (this.current && this.current.token === token) { this.current = null; reject(err); } });
      });
    },
    stop() {
      this.token++;
      if (this.audio) { try { this.audio.pause(); } catch (e) { /* ignora */ } }
      if (this.current) { const c = this.current; this.current = null; c.reject(CANCELED); }
    },
  };

  // ---------- Archivio dell'audio preparato (voci lente) ----------
  const Clips = {
    CACHE: 'libro-audio-v1',
    MAX_BYTES: 350e6,
    mem: new Map(),  // chiave -> { url, dur }
    index: store.get('audioIndex', {}),
    url: (key) => abs('__audio/' + key + '.wav'),
    saveIndex() { store.set('audioIndex', this.index); },
    async get(key) {
      if (this.mem.has(key)) { this.touch(key); return this.mem.get(key); }
      try {
        const cache = await caches.open(this.CACHE);
        const res = await cache.match(this.url(key));
        if (!res) { if (this.index[key]) { delete this.index[key]; this.saveIndex(); } return null; }
        const dur = Number(res.headers.get('x-dur')) || 0;
        const clip = { url: URL.createObjectURL(await res.blob()), dur };
        this.remember(key, clip);
        this.touch(key);
        return clip;
      } catch (e) { return null; }
    },
    has(key) { return this.mem.has(key) || !!this.index[key]; },
    async put(key, blob, dur) {
      const clip = { url: URL.createObjectURL(blob), dur };
      this.remember(key, clip);
      try {
        const cache = await caches.open(this.CACHE);
        await cache.put(this.url(key), new Response(blob, { headers: { 'content-type': 'audio/wav', 'x-dur': String(dur) } }));
        this.index[key] = [Date.now(), blob.size, dur];
        this.saveIndex();
        this.prune(cache);
      } catch (e) { /* senza cache resta solo in memoria */ }
      return clip;
    },
    remember(key, clip) {
      this.mem.set(key, clip);
      while (this.mem.size > 40) {
        const [k, c] = this.mem.entries().next().value;
        this.mem.delete(k);
        setTimeout(() => URL.revokeObjectURL(c.url), 60000);
      }
    },
    touch(key) { if (this.index[key]) { this.index[key][0] = Date.now(); this.saveIndex(); } },
    durOf(key) { return this.index[key] ? (this.index[key][2] || 0) : (this.mem.has(key) ? this.mem.get(key).dur : 0); },
    prune(cache) {
      let total = 0;
      const entries = Object.entries(this.index);
      for (const [, v] of entries) total += v[1];
      if (total <= this.MAX_BYTES) return;
      entries.sort((a, b) => a[1][0] - b[1][0]);
      for (const [k, v] of entries) {
        if (total <= this.MAX_BYTES * 0.8) break;
        cache.delete(this.url(k));
        delete this.index[k];
        total -= v[1];
      }
      this.saveIndex();
    },
    bytes() { return Object.values(this.index).reduce((a, v) => a + v[1], 0); },
    async clear() {
      try { await caches.delete(this.CACHE); } catch (e) { /* ignora */ }
      this.index = {};
      this.saveIndex();
      this.mem.clear();
    },
  };

  // ---------- Motore di una voce ----------
  function createEngine(cfg) {
    const savedStyle = cfg.styles ? store.get('style:' + cfg.id, cfg.defaultStyle) : null;
    const E = {
      id: cfg.id,
      name: cfg.name,
      engine: cfg.engine,
      sizeMB: Math.round(cfg.totalBytes / 1e6),
      slow: !!cfg.slow,
      styles: cfg.styles || null,
      style: cfg.styles ? (cfg.styles[savedStyle] ? savedStyle : cfg.defaultStyle) : null,
      state: 'idle',        // idle | loading | ready | error
      error: '',
      progress: 0,
      preparing: false,
      threads: 1,
      worker: null,
      pending: new Map(),
      seq: 0,
      sampleRate: cfg.sampleRate,
      listeners: new Set(),
      readyPromise: null,
      memClips: new Map(),  // voci veloci: frasi recenti in memoria
      inflight: new Map(),  // voci lente: chiave -> Promise
      want: [],             // voci lente: frasi da preparare, in ordine di lettura
      pumping: false,
      msPerChar: 0,         // velocità di generazione misurata

      onChange(fn) { this.listeners.add(fn); },
      emit() { this.listeners.forEach((fn) => { try { fn(this); } catch (e) { /* ignora */ } }); },
      allUrls() { return cfg.modelParts.concat(cfg.extraFiles || []).map(abs).concat([abs(PHON_DATA)]); },

      ensureWorker() {
        if (this.worker) return this.worker;
        this.worker = new Worker('lib/voice-worker.js');
        this.worker.onmessage = (e) => this.onMessage(e.data);
        this.worker.onerror = (e) => this.fail('Il motore della voce non si è avviato' + (e && e.message ? ': ' + e.message : '.'));
        return this.worker;
      },
      onMessage(m) {
        if (m.type === 'progress') { this.progress = Math.min(1, m.loaded / m.total); this.emit(); }
        else if (m.type === 'status') { this.progress = 1; this.preparing = true; this.emit(); }
        else if (m.type === 'ready') {
          this.state = 'ready';
          this.preparing = false;
          this.threads = m.threads || 1;
          if (this.resolveReady) this.resolveReady();
          this.emit();
        } else {
          const p = this.pending.get(m.id);
          if (m.type === 'error' && !p) { this.fail(m.message); return; }
          if (!p) return;
          this.pending.delete(m.id);
          if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
        }
      },
      fail(msg) {
        this.state = 'error';
        this.error = msg || 'Errore sconosciuto';
        if (this.rejectReady) this.rejectReady(new Error(this.error));
        this.readyPromise = null;
        this.release(true);
        this.emit();
      },
      // Libera la memoria (quando si passa a un'altra voce).
      release(keepState) {
        if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignora */ } this.worker = null; }
        this.pending.forEach((p) => p.reject(CANCELED));
        this.pending.clear();
        this.inflight.clear();
        this.memClips.clear();
        this.want = [];
        if (!keepState) {
          if (this.rejectReady && this.state !== 'ready') this.rejectReady(CANCELED);
          this.state = 'idle';
          this.readyPromise = null;
          this.emit();
        }
      },
      call(msg) {
        const id = ++this.seq;
        return new Promise((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          this.ensureWorker().postMessage(Object.assign({ id }, msg));
        });
      },
      isDownloaded() {
        return this.call({ type: 'check', urls: this.allUrls() }).then((m) => !!m.ok).catch(() => false);
      },
      load() {
        if (this.state === 'ready') return Promise.resolve();
        if (this.readyPromise) return this.readyPromise;
        this.state = 'loading';
        this.error = '';
        this.progress = 0;
        this.emit();
        this.readyPromise = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
        this.readyPromise.catch(() => {});
        this.ensureWorker().postMessage(Object.assign({
          type: 'init',
          engine: cfg.engine,
          phonWasmUrl: abs(PHON_WASM),
          phonDataUrl: abs(PHON_DATA),
          modelUrls: cfg.modelParts.map(abs),
          totalBytes: cfg.totalBytes,
        }, cfg.initExtra()));
        return this.readyPromise;
      },
      setStyle(name) {
        if (!this.styles || !this.styles[name]) return;
        this.style = name;
        store.set('style:' + this.id, name);
        this.memClips.clear();
      },

      // Genera l'audio di una frase.
      async synth(text, rate) {
        await this.load();
        const st = this.styles ? this.styles[this.style] : cfg.voice;
        const msg = cfg.engine === 'piper'
          ? { type: 'synth', text, lengthScale: st.length / rate, noiseScale: st.noiseScale, noiseW: st.noiseW }
          : { type: 'synth', text, speed: st.speed };
        const m = await this.call(msg);
        if (text.length) this.msPerChar = this.msPerChar ? this.msPerChar * 0.7 + (m.ms / text.length) * 0.3 : m.ms / text.length;
        if (!m.pcm || !m.pcm.length) return { blob: null, dur: 0 };
        const pause = pauseFor(text, st.pause) / (cfg.engine === 'piper' ? rate : 1);
        return encodeWav(m.pcm, this.sampleRate, pause);
      },

      keyOf(text) { return cfg.id.replace(/\W/g, '') + '-' + hash(text); },

      // Audio di una frase: dalla memoria, dall'archivio o generato ora.
      clip(text, rate) {
        if (!this.slow) {
          const key = this.style + '|' + rate.toFixed(2) + '|' + text;
          if (this.memClips.has(key)) return this.memClips.get(key);
          const p = this.synth(text, rate).then((c) => ({ url: c.blob ? URL.createObjectURL(c.blob) : null, dur: c.dur }));
          p.catch(() => this.memClips.delete(key));
          this.memClips.set(key, p);
          while (this.memClips.size > 8) {
            const [k, old] = this.memClips.entries().next().value;
            this.memClips.delete(k);
            old.then((c) => { if (c && c.url) setTimeout(() => URL.revokeObjectURL(c.url), 30000); }).catch(() => {});
          }
          return p;
        }
        const key = this.keyOf(text);
        if (this.inflight.has(key)) return this.inflight.get(key);
        const p = (async () => {
          const have = await Clips.get(key);
          if (have) return have;
          const c = await this.synth(text, 1);
          if (!c.blob) return { url: null, dur: 0 };
          return Clips.put(key, c.blob, c.dur);
        })();
        this.inflight.set(key, p);
        p.then(() => this.inflight.delete(key), () => this.inflight.delete(key));
        return p;
      },
      isReady(text) { return this.slow && Clips.has(this.keyOf(text)); },
      readySeconds(texts) {
        let s = 0;
        for (const t of texts) { if (!this.isReady(t)) break; s += Clips.durOf(this.keyOf(t)); }
        return s;
      },

      // Voci lente: le prossime frasi da preparare, in ordine di lettura.
      setQueue(texts) {
        this.want = texts.filter(Boolean);
        this.pump();
      },
      async pump() {
        if (this.pumping || !this.slow) return;
        this.pumping = true;
        try {
          for (;;) {
            if (this.state === 'error') break;
            const next = this.want.find((t) => !this.isReady(t));
            if (!next) break;
            try { await this.clip(next, 1); } catch (e) {
              if (e === CANCELED || this.state === 'error' || this.state === 'idle') break;
              this.want = this.want.filter((t) => t !== next);
            }
            this.emit();
          }
        } finally { this.pumping = false; }
      },
      prefetch(text, rate) { if (!this.slow && text && this.state !== 'error') this.clip(text, rate).catch(() => {}); },

      // Legge una frase; si risolve quando l'audio è finito. onWait: la frase non è ancora pronta.
      async speak(text, rate, onWait, onStart) {
        const token = ++Player.token;
        Player.unlock();
        const timer = setTimeout(() => { if (onWait) onWait(); }, 350);
        let c;
        try { c = await this.clip(text, rate); } finally { clearTimeout(timer); }
        if (token !== Player.token) throw CANCELED;
        if (!c || !c.url) return;
        if (onStart) onStart();
        await Player.play(c.url, this.slow ? rate : 1, token);
      },
      stop() { Player.stop(); },
    };
    return E;
  }

  const paola = createEngine({
    id: 'neural:paola',
    name: 'Paola',
    engine: 'piper',
    sampleRate: 22050,
    totalBytes: 63511038 + PHON_BYTES,
    modelParts: [0, 1, 2, 3, 4].map((i) => 'voices/paola/it_IT-paola-medium.onnx.part' + i + SFX),
    initExtra: () => ({ configUrl: abs('voices/paola/it_IT-paola-medium.onnx.json') }),
    defaultStyle: 'calma',
    // Espressività (noiseScale), variabilità del ritmo (noiseW), lentezza (length), pausa tra frasi (ms).
    styles: {
      calma: { label: 'Calma', noiseScale: 0.62, noiseW: 0.85, length: 1.12, pause: 420 },
      naturale: { label: 'Naturale', noiseScale: 0.7, noiseW: 0.95, length: 1.07, pause: 320 },
      espressiva: { label: 'Espressiva', noiseScale: 0.85, noiseW: 1.1, length: 1.0, pause: 260 },
      originale: { label: 'Originale', noiseScale: 0.8, noiseW: 0.8, length: 1.0, pause: 160 },
    },
  });

  const sara = createEngine({
    id: 'neural:sara',
    name: 'Sara',
    engine: 'kokoro',
    slow: true,
    sampleRate: 24000,
    totalBytes: 92361116 + 522240 + PHON_BYTES,
    modelParts: [0, 1, 2, 3, 4, 5, 6].map((i) => 'voices/sara/kokoro-it.onnx.part' + i + SFX),
    extraFiles: ['voices/sara/if_sara.bin' + SFX],
    initExtra: () => ({ vocabUrl: abs('voices/sara/vocab.json'), styleUrl: abs('voices/sara/if_sara.bin' + SFX) }),
    // Un filo più lenta del normale e con pause ampie: lettura più distesa.
    voice: { speed: 0.93, pause: 380 },
  });

  window.NeuralVoices = {
    list: [paola, sara],
    get(id) { return this.list.find((v) => v.id === id) || null; },
    available() { return !!(window.Worker && window.WebAssembly && typeof BigInt64Array !== 'undefined' && window.Blob); },
    unlock() { Player.unlock(); },
    stopAll() { Player.stop(); },
    clips: Clips,
  };
})();
