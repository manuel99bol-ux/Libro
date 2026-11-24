/* Voce naturale "Paola": sintesi vocale neurale (Piper) eseguita nel browser.
   Il modello si scarica una volta e resta nel telefono: poi funziona anche offline. */
(function () {
  'use strict';

  const BASE = 'voices/paola/';
  // Alcuni hosting servono solo certi tipi di file: lì i file binari hanno un suffisso in più.
  const SFX = window.LIBRO_BIN_SUFFIX || '';
  const MODEL_PARTS = [0, 1, 2, 3, 4].map((i) => BASE + 'it_IT-paola-medium.onnx.part' + i + SFX);
  const CONFIG_URL = BASE + 'it_IT-paola-medium.onnx.json';
  const PHON_WASM = 'lib/piper/piper_phonemize.wasm';
  const PHON_DATA = 'lib/piper/piper_phonemize.data' + SFX;
  const TOTAL_BYTES = 63511038 + 635212 + 1064825;
  const PAUSE_MS = 140; // breve pausa dopo ogni frase
  const abs = (u) => new URL(u, location.href).href;

  const CANCELED = { canceled: true };
  // Mezzo secondo di silenzio: serve a "sbloccare" l'audio su iPhone al primo tocco.
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';

  function encodeWav(pcm, sampleRate) {
    const pad = Math.round(sampleRate * PAUSE_MS / 1000);
    const n = pcm.length + pad;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    // Normalizza leggermente il volume senza saturare.
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const gain = peak > 0 ? Math.min(3, 0.95 / peak) : 1;
    let o = 44;
    for (let i = 0; i < pcm.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, pcm[i] * gain));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  const N = {
    id: 'neural:paola',
    name: 'Paola',
    sizeMB: Math.round(TOTAL_BYTES / 1e6),
    state: 'idle',          // idle | loading | ready | error
    error: '',
    progress: 0,
    worker: null,
    sampleRate: 22050,
    listeners: new Set(),
    pending: new Map(),
    clips: new Map(),       // testo|velocità -> Promise<{url, ms}>
    audio: null,
    unlocked: false,
    playToken: 0,
    current: null,
    seq: 0,
    readyPromise: null,

    available() {
      return !!(window.Worker && window.WebAssembly && typeof BigInt64Array !== 'undefined' && window.Blob);
    },
    onChange(fn) { this.listeners.add(fn); },
    emit() { this.listeners.forEach((fn) => { try { fn(this); } catch (e) { /* ignora */ } }); },

    ensureWorker() {
      if (this.worker) return this.worker;
      this.worker = new Worker('lib/piper/piper-worker.js');
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => {
        this.fail('Il motore della voce non si è avviato' + (e && e.message ? ': ' + e.message : '.'));
      };
      return this.worker;
    },

    onMessage(m) {
      if (m.type === 'progress') {
        this.progress = Math.min(1, m.loaded / m.total);
        this.emit();
      } else if (m.type === 'status') {
        this.progress = 1;
        this.preparing = true;
        this.emit();
      } else if (m.type === 'ready') {
        this.sampleRate = m.sampleRate || 22050;
        this.state = 'ready';
        this.preparing = false;
        this.progress = 1;
        if (this.resolveReady) this.resolveReady();
        this.emit();
      } else if (m.type === 'checked' || m.type === 'audio' || m.type === 'error') {
        const p = this.pending.get(m.id);
        if (m.type === 'error' && !p) { this.fail(m.message); return; }
        if (!p) return;
        this.pending.delete(m.id);
        if (m.type === 'error') p.reject(new Error(m.message));
        else p.resolve(m);
      }
    },

    fail(msg) {
      this.state = 'error';
      this.error = msg || 'Errore sconosciuto';
      if (this.rejectReady) this.rejectReady(new Error(this.error));
      this.readyPromise = null;
      if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignora */ } this.worker = null; }
      this.emit();
    },

    call(msg, transfer) {
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ensureWorker().postMessage(Object.assign({ id }, msg), transfer || []);
      });
    },

    // Il modello è già nel telefono?
    isDownloaded() {
      if (!this.available()) return Promise.resolve(false);
      return this.call({ type: 'check', urls: MODEL_PARTS.map(abs).concat([abs(PHON_DATA)]) })
        .then((m) => !!m.ok).catch(() => false);
    },

    load() {
      if (this.state === 'ready') return Promise.resolve();
      if (this.readyPromise) return this.readyPromise;
      this.state = 'loading';
      this.error = '';
      this.progress = 0;
      this.emit();
      this.readyPromise = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
      this.ensureWorker().postMessage({
        type: 'init',
        configUrl: abs(CONFIG_URL),
        phonWasmUrl: abs(PHON_WASM),
        phonDataUrl: abs(PHON_DATA),
        modelUrls: MODEL_PARTS.map(abs),
        totalBytes: TOTAL_BYTES,
      });
      return this.readyPromise;
    },

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

    clip(text, rate) {
      const key = rate.toFixed(2) + '|' + text;
      if (this.clips.has(key)) {
        const c = this.clips.get(key);
        this.clips.delete(key);
        this.clips.set(key, c); // più recente
        return c;
      }
      const p = this.load()
        .then(() => this.call({ type: 'synth', text, lengthScale: 1 / rate }))
        .then((m) => {
          if (!m.pcm || !m.pcm.length) return { url: null, ms: m.ms };
          return { url: URL.createObjectURL(encodeWav(m.pcm, this.sampleRate)), ms: m.ms };
        });
      p.catch(() => this.clips.delete(key));
      this.clips.set(key, p);
      while (this.clips.size > 8) {
        const [k, old] = this.clips.entries().next().value;
        this.clips.delete(k);
        old.then((c) => { if (c && c.url) setTimeout(() => URL.revokeObjectURL(c.url), 30000); }).catch(() => {});
      }
      return p;
    },

    prefetch(text, rate) {
      if (text && this.state !== 'error') this.clip(text, rate).catch(() => {});
    },

    // Legge una frase; la promessa si risolve quando l'audio è finito.
    speak(text, rate) {
      const token = ++this.playToken;
      this.unlock();
      return this.clip(text, rate).then((c) => new Promise((resolve, reject) => {
        if (token !== this.playToken) { reject(CANCELED); return; }
        if (!c.url) { resolve(); return; }
        const a = this.audio;
        this.current = { token, reject };
        a.onended = () => { if (this.current && this.current.token === token) { this.current = null; resolve(); } };
        a.onerror = () => { if (this.current && this.current.token === token) { this.current = null; reject(new Error('Riproduzione non riuscita')); } };
        a.src = c.url;
        a.playbackRate = 1;
        const p = a.play();
        if (p && p.catch) p.catch((err) => { if (this.current && this.current.token === token) { this.current = null; reject(err); } });
      }));
    },

    stop() {
      this.playToken++;
      if (this.audio) { try { this.audio.pause(); } catch (e) { /* ignora */ } }
      if (this.current) { const c = this.current; this.current = null; c.reject(CANCELED); }
    },
  };

  window.NeuralTTS = N;
})();
