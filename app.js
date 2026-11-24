/* Lettore di Libri — legge ad alta voce i PDF, tutto in locale nel browser. */
(function () {
  'use strict';

  // ---------- Riferimenti DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    fileInputs: [$('fileInput'), $('fileInput2')],
    welcome: $('welcome'),
    reader: $('reader'),
    bookTitle: $('bookTitle'),
    status: $('status'),
    btnPlay: $('btnPlay'),
    btnPause: $('btnPause'),
    btnResume: $('btnResume'),
    btnStop: $('btnStop'),
    btnPrev: $('btnPrev'),
    btnNext: $('btnNext'),
    pageInput: $('pageInput'),
    pageCount: $('pageCount'),
    voiceSelect: $('voiceSelect'),
    rateInput: $('rateInput'),
    rateValue: $('rateValue'),
    fontInput: $('fontInput'),
    pageText: $('pageText'),
    loading: $('loading'),
  };

  const synth = window.speechSynthesis;

  // ---------- Stato ----------
  const state = {
    pdf: null,
    bookKey: null,
    bookName: '',
    page: 1,
    sentences: [],
    sentence: 0,
    mode: 'stopped', // 'stopped' | 'playing' | 'paused'
    token: 0,        // invalida i callback di frasi annullate
    voices: [],
    pageCache: new Map(),
    wakeLock: null,
    errors: 0,        // errori consecutivi della sintesi vocale
  };

  // ---------- Archiviazione locale ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('libro:' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('libro:' + key, JSON.stringify(value)); } catch (e) { /* ignora */ }
    },
  };

  // IndexedDB: conserva l'ultimo PDF aperto, così si riapre da solo.
  const idb = {
    open() {
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('IndexedDB non disponibile'));
        const req = indexedDB.open('libro-db', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('books');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async put(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction('books', 'readonly').objectStore('books').get(key);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    },
  };

  function savePosition() {
    if (!state.bookKey) return;
    store.set('pos:' + state.bookKey, { page: state.page, sentence: state.sentence });
    store.set('last', state.bookKey);
  }

  function setStatus(text) { el.status.textContent = text || ''; }

  // ---------- pdf.js ----------
  // Se la pagina è aperta da file:// i Web Worker non funzionano: in quel caso
  // carichiamo il worker nel thread principale (più lento ma funziona ovunque).
  function setupPdfJs() {
    if (!window.pdfjsLib) throw new Error('pdf.js non caricato');
    const workerUrl = 'lib/pdf.worker.min.js';
    if (location.protocol === 'file:') {
      return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = workerUrl;
        s.onload = resolve;
        s.onerror = resolve;
        document.head.appendChild(s);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      });
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    return Promise.resolve();
  }
  const pdfReady = setupPdfJs();

  async function openFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      alert('Il file scelto non sembra un PDF.');
      return;
    }
    const buffer = await file.arrayBuffer();
    const key = file.name + '|' + file.size;
    // Copia per IndexedDB: pdf.js può "consumare" il buffer originale.
    idb.put('last', { key, name: file.name, data: buffer.slice(0) }).catch(() => {});
    await loadPdf(new Uint8Array(buffer), file.name, key);
  }

  async function loadPdf(data, name, key) {
    stop(false);
    el.loading.classList.remove('hidden');
    try {
      await pdfReady;
      if (state.pdf) { try { state.pdf.destroy(); } catch (e) { /* ignora */ } }
      state.pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    } catch (err) {
      el.loading.classList.add('hidden');
      console.error(err);
      alert('Impossibile aprire il PDF. Il file potrebbe essere danneggiato o protetto da password.');
      return;
    }
    state.bookKey = key;
    state.bookName = name;
    state.pageCache.clear();
    el.bookTitle.textContent = name.replace(/\.pdf$/i, '');
    document.title = el.bookTitle.textContent + ' – Lettore di Libri';
    el.pageCount.textContent = state.pdf.numPages;
    el.pageInput.max = state.pdf.numPages;

    const pos = store.get('pos:' + key, { page: 1, sentence: 0 });
    const page = Math.min(Math.max(1, pos.page | 0), state.pdf.numPages);

    el.welcome.classList.add('hidden');
    el.reader.classList.remove('hidden');
    await showPage(page, pos.sentence | 0);
    el.loading.classList.add('hidden');
    store.set('last', key);
    if (page > 1 || pos.sentence > 0) setStatus('Ripreso da pagina ' + page);
  }

  // ---------- Estrazione testo ----------
  async function getPageText(n) {
    if (state.pageCache.has(n)) return state.pageCache.get(n);
    const page = await state.pdf.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    let lastY = null;
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 &&
          text && !/\s$/.test(text)) {
        text += '\n';
      }
      text += item.str;
      if (item.hasEOL) text += '\n';
      if (y !== null) lastY = y;
    }
    text = text
      .replace(/([\p{L}])[-­]\s*\n\s*([\p{Ll}])/gu, '$1$2') // parole spezzate a fine riga
      .replace(/\s*\n\s*/g, ' ')
      .replace(/[ \t ]+/g, ' ')
      .trim();
    const sentences = splitSentences(text);
    state.pageCache.set(n, sentences);
    return sentences;
  }

  const segmenter = (window.Intl && Intl.Segmenter)
    ? new Intl.Segmenter('it', { granularity: 'sentence' }) : null;

  function splitSentences(text) {
    if (!text) return [];
    let parts;
    if (segmenter) {
      parts = Array.from(segmenter.segment(text), (s) => s.segment);
    } else {
      parts = text.match(/[^.!?…]+(?:[.!?…]+["»”’)\]]*\s*|$)/g) || [text];
    }
    const out = [];
    for (let p of parts) {
      p = p.trim();
      if (!p) continue;
      // Frasi molto lunghe: spezza su virgole/punti e virgola per una lettura più fluida.
      if (p.length > 260) {
        let chunk = '';
        for (const piece of p.split(/(?<=[,;:])\s+/)) {
          if (chunk && (chunk + ' ' + piece).length > 220) { out.push(chunk); chunk = piece; }
          else chunk = chunk ? chunk + ' ' + piece : piece;
        }
        if (chunk) out.push(chunk);
      } else {
        out.push(p);
      }
    }
    return out;
  }

  // ---------- Visualizzazione ----------
  async function showPage(n, sentenceIndex) {
    state.page = n;
    state.sentences = await getPageText(n);
    state.sentence = Math.min(Math.max(0, sentenceIndex || 0), Math.max(0, state.sentences.length - 1));
    el.pageInput.value = n;
    el.btnPrev.disabled = n <= 1;
    el.btnNext.disabled = n >= state.pdf.numPages;

    el.pageText.innerHTML = '';
    if (!state.sentences.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Questa pagina non contiene testo leggibile (potrebbe essere vuota o un\'immagine scansionata).';
      el.pageText.appendChild(p);
    } else {
      const frag = document.createDocumentFragment();
      state.sentences.forEach((s, i) => {
        const span = document.createElement('span');
        span.className = 's';
        span.dataset.i = i;
        span.textContent = s;
        frag.appendChild(span);
        frag.appendChild(document.createTextNode(' '));
      });
      el.pageText.appendChild(frag);
    }
    highlight(state.mode !== 'stopped' || sentenceIndex > 0);
    savePosition();
    // Precarica la pagina successiva per un passaggio senza pause.
    if (n < state.pdf.numPages) getPageText(n + 1).catch(() => {});
  }

  function highlight(scroll) {
    const prev = el.pageText.querySelector('.s.current');
    if (prev) prev.classList.remove('current');
    if (state.mode === 'stopped' && state.sentence === 0) return;
    const cur = el.pageText.querySelector('.s[data-i="' + state.sentence + '"]');
    if (cur) {
      cur.classList.add('current');
      if (scroll) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function updateButtons() {
    const m = state.mode;
    el.btnPlay.classList.toggle('hidden', m !== 'stopped');
    el.btnPause.classList.toggle('hidden', m !== 'playing');
    el.btnResume.classList.toggle('hidden', m !== 'paused');
    el.btnStop.disabled = m === 'stopped';
    if (m === 'playing') setStatus('In lettura… pagina ' + state.page);
    else if (m === 'paused') setStatus('In pausa');
  }

  // ---------- Sintesi vocale ----------
  function loadVoices() {
    if (!synth) return;
    const all = synth.getVoices();
    if (!all.length) return;
    const it = all.filter((v) => /^it/i.test(v.lang));
    const others = all.filter((v) => !/^it/i.test(v.lang))
      .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    state.voices = it.concat(others);

    const saved = store.get('voice', null);
    el.voiceSelect.innerHTML = '';
    const addGroup = (label, list) => {
      if (!list.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      list.forEach((v) => {
        const o = document.createElement('option');
        o.value = v.voiceURI || v.name;
        o.textContent = v.name + ' (' + v.lang + ')';
        g.appendChild(o);
      });
      el.voiceSelect.appendChild(g);
    };
    addGroup('Voci italiane', it);
    addGroup('Altre lingue', others);

    let chosen = state.voices.find((v) => (v.voiceURI || v.name) === saved);
    if (!chosen) chosen = it.find((v) => v.default) || it.find((v) => v.lang === 'it-IT') || it[0] || all.find((v) => v.default) || all[0];
    if (chosen) el.voiceSelect.value = chosen.voiceURI || chosen.name;

    if (!it.length) setStatus('Nessuna voce italiana installata: scegline una nelle impostazioni.');
  }

  function currentVoice() {
    const id = el.voiceSelect.value;
    return state.voices.find((v) => (v.voiceURI || v.name) === id) || null;
  }

  function speakCurrent() {
    if (state.mode !== 'playing') return;
    const myToken = ++state.token;

    if (state.sentence >= state.sentences.length) {
      // Fine pagina: passa alla successiva (saltando quelle senza testo).
      if (state.page < state.pdf.numPages) {
        showPage(state.page + 1, 0).then(() => {
          if (state.mode === 'playing' && myToken === state.token) speakCurrent();
        });
      } else {
        stop(false);
        state.sentence = 0;
        setStatus('Fine del libro 🎉');
      }
      return;
    }

    highlight(true);
    savePosition();

    const u = new SpeechSynthesisUtterance(state.sentences[state.sentence]);
    const voice = currentVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'it-IT'; }
    u.rate = parseFloat(el.rateInput.value) || 1;
    u.onend = () => {
      if (myToken !== state.token || state.mode !== 'playing') return;
      state.errors = 0;
      state.sentence++;
      speakCurrent();
    };
    u.onerror = (e) => {
      if (myToken !== state.token) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('Errore sintesi vocale:', e.error);
      if (e.error === 'not-allowed') { pause(); setStatus('Premi Riprendi per continuare'); return; }
      if (++state.errors >= 3) {
        pause();
        setStatus('La voce non risponde: prova a sceglierne un\'altra.');
        return;
      }
      state.sentence++;
      setTimeout(speakCurrent, 50);
    };
    synth.speak(u);
  }

  function cancelSpeech() {
    state.token++;
    if (synth) synth.cancel();
  }

  function play() {
    if (!synth) { alert('Questo browser non supporta la sintesi vocale.'); return; }
    if (!state.pdf) return;
    cancelSpeech();
    state.errors = 0;
    state.mode = 'playing';
    updateButtons();
    requestWakeLock();
    // Piccolo ritardo: alcuni browser ignorano speak() subito dopo cancel().
    setTimeout(speakCurrent, 80);
  }

  function pause() {
    if (state.mode !== 'playing') return;
    cancelSpeech(); // più affidabile di synth.pause() (che su Android non funziona)
    state.mode = 'paused';
    updateButtons();
    highlight(false);
    savePosition();
    releaseWakeLock();
  }

  function resume() {
    if (state.mode !== 'paused') return;
    play(); // riprende dall'inizio della frase interrotta
  }

  function stop(resetToStart = true) {
    cancelSpeech();
    state.mode = 'stopped';
    if (resetToStart) state.sentence = 0;
    updateButtons();
    setStatus('');
    if (state.pdf) { highlight(false); savePosition(); }
    releaseWakeLock();
  }

  async function goToPage(n) {
    if (!state.pdf) return;
    n = Math.min(Math.max(1, n | 0), state.pdf.numPages);
    const wasPlaying = state.mode === 'playing';
    cancelSpeech();
    if (state.mode === 'paused') state.mode = 'stopped';
    await showPage(n, 0);
    updateButtons();
    if (wasPlaying) play();
  }

  // Mantiene lo schermo acceso durante la lettura (se supportato).
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !state.wakeLock) {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
      }
    } catch (e) { /* non disponibile */ }
  }
  function releaseWakeLock() {
    try { if (state.wakeLock) state.wakeLock.release(); } catch (e) { /* ignora */ }
    state.wakeLock = null;
  }

  // ---------- Eventi ----------
  el.fileInputs.forEach((input) => input.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    openFile(f);
  }));

  el.btnPlay.addEventListener('click', play);
  el.btnPause.addEventListener('click', pause);
  el.btnResume.addEventListener('click', resume);
  el.btnStop.addEventListener('click', () => stop(true));
  el.btnPrev.addEventListener('click', () => goToPage(state.page - 1));
  el.btnNext.addEventListener('click', () => goToPage(state.page + 1));
  el.pageInput.addEventListener('change', () => {
    const n = parseInt(el.pageInput.value, 10) || 1;
    if (n !== state.page) goToPage(n);
  });

  el.pageText.addEventListener('click', (e) => {
    const span = e.target.closest('.s');
    if (!span) return;
    state.sentence = parseInt(span.dataset.i, 10) || 0;
    savePosition();
    play();
  });

  el.voiceSelect.addEventListener('change', () => {
    store.set('voice', el.voiceSelect.value);
    if (state.mode === 'playing') play(); // riparte la frase con la nuova voce
  });

  let rateTimer = null;
  el.rateInput.addEventListener('input', () => {
    el.rateValue.textContent = parseFloat(el.rateInput.value).toFixed(1) + '×';
    store.set('rate', el.rateInput.value);
    clearTimeout(rateTimer);
    if (state.mode === 'playing') rateTimer = setTimeout(play, 400);
  });

  el.fontInput.addEventListener('input', () => {
    document.documentElement.style.setProperty('--font-size', el.fontInput.value + 'px');
    store.set('font', el.fontInput.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.mode === 'playing') pause();
      else if (state.mode === 'paused') resume();
      else play();
    } else if (e.key === 'ArrowRight' && e.altKey) goToPage(state.page + 1);
    else if (e.key === 'ArrowLeft' && e.altKey) goToPage(state.page - 1);
  });

  window.addEventListener('pagehide', () => { savePosition(); if (synth) synth.cancel(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode === 'playing') requestWakeLock();
  });

  // ---------- Avvio ----------
  function init() {
    const rate = store.get('rate', '1');
    el.rateInput.value = rate;
    el.rateValue.textContent = parseFloat(rate).toFixed(1) + '×';
    const font = store.get('font', '22');
    el.fontInput.value = font;
    document.documentElement.style.setProperty('--font-size', font + 'px');

    if (synth) {
      loadVoices();
      if ('onvoiceschanged' in synth) synth.addEventListener('voiceschanged', loadVoices);
      // Alcuni browser caricano le voci in ritardo senza evento.
      setTimeout(loadVoices, 500);
    } else {
      setStatus('Sintesi vocale non supportata da questo browser.');
    }
    updateButtons();

    // Riapre automaticamente l'ultimo libro.
    const lastKey = store.get('last', null);
    if (lastKey) {
      idb.get('last').then((rec) => {
        if (rec && rec.data && !state.pdf) loadPdf(new Uint8Array(rec.data), rec.name, rec.key);
      }).catch(() => {});
    }
  }

  init();
})();
