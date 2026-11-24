/* Lettore di Libri — nucleo: apertura PDF, lettura vocale, salvataggi, schede.
   Tutto avviene in locale nel browser. */
(function () {
  'use strict';

  // ---------- Riferimenti DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    fileInputs: [$('fileInput'), $('fileInput2')],
    appTitle: $('appTitle'),
    welcome: $('welcome'),
    tabbar: $('tabbar'),
    status: $('status'),
    btnPlay: $('btnPlay'),
    btnPause: $('btnPause'),
    btnResume: $('btnResume'),
    btnStop: $('btnStop'),
    btnPrev: $('btnPrev'),
    btnNext: $('btnNext'),
    btnSettings: $('btnSettings'),
    settings: $('settings'),
    pageInput: $('pageInput'),
    pageCount: $('pageCount'),
    voiceSelect: $('voiceSelect'),
    voiceTip: $('voiceTip'),
    neuralBox: $('neuralBox'),
    neuralBtn: $('neuralBtn'),
    neuralProg: $('neuralProg'),
    neuralMsg: $('neuralMsg'),
    neuralStyle: $('neuralStyle'),
    rateInput: $('rateInput'),
    rateValue: $('rateValue'),
    fontInput: $('fontInput'),
    pageText: $('pageText'),
    deletedNote: $('deletedNote'),
    loading: $('loading'),
    loadingText: $('loadingText'),
    toast: $('toast'),
    installHint: $('installHint'),
  };

  const synth = window.speechSynthesis;

  // ---------- Stato condiviso ----------
  const state = {
    pdf: null,
    bytes: null,     // copia dei byte originali (serve per salvare il PDF modificato)
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
    errors: 0,       // errori consecutivi della sintesi vocale
    view: null,
  };

  // Modifiche al PDF: annotazioni, rotazioni ed eliminazioni per numero di pagina.
  // order: ordine delle pagine (chiavi), extra: pagine vuote o duplicate.
  const emptyEdits = () => ({ ann: {}, rot: {}, del: {}, order: null, extra: {} });

  const events = new EventTarget();
  const emit = (name, detail) => events.dispatchEvent(new CustomEvent(name, { detail }));

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

  // IndexedDB: conserva l'ultimo PDF aperto e le modifiche di ogni libro.
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

  let editsTimer = null;
  function saveEdits() {
    if (!state.bookKey) return;
    clearTimeout(editsTimer);
    const key = 'edits:' + state.bookKey;
    editsTimer = setTimeout(() => { idb.put(key, App.edits).catch(() => {}); }, 300);
  }

  function setStatus(text) { el.status.textContent = text || ''; }

  function showLoading(text) {
    el.loadingText.textContent = text || 'Caricamento…';
    el.loading.classList.remove('hidden');
  }
  function hideLoading() { el.loading.classList.add('hidden'); }

  let toastTimer = null;
  function toast(text, ms) {
    el.toast.textContent = text;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms || 2500);
  }

  // ---------- Schede ----------
  function showView(id) {
    if (!state.pdf && id !== 'welcome') id = 'welcome';
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === id;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    const prev = state.view;
    state.view = id;
    if (id !== 'welcome') store.set('view', id);
    emit('viewchange', { view: id, prev });
    if (id === 'viewListen') highlight(true);
  }

  // ---------- pdf.js ----------
  // Se la pagina è aperta da file:// i Web Worker non funzionano: in quel caso
  // carichiamo il worker nel thread principale (più lento ma funziona ovunque).
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossibile caricare ' + src));
      document.head.appendChild(s);
    });
  }
  function setupPdfJs() {
    if (!window.pdfjsLib) return Promise.reject(new Error('pdf.js non caricato'));
    const workerUrl = 'lib/pdf.worker.min.js';
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    if (location.protocol === 'file:') return loadScript(workerUrl).catch(() => {});
    return Promise.resolve();
  }
  const pdfReady = setupPdfJs();

  async function openFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      alert('Il file scelto non sembra un PDF.');
      return;
    }
    showLoading('Apro il libro…');
    const buffer = await file.arrayBuffer();
    const key = file.name + '|' + file.size;
    idb.put('last', { key, name: file.name, data: buffer.slice(0) }).catch(() => {});
    await loadPdf(new Uint8Array(buffer), file.name, key);
  }

  async function loadPdf(data, name, key) {
    stop(false);
    showLoading('Apro il libro…');
    let pdf;
    try {
      await pdfReady;
      // pdf.js può trasferire il buffer al worker: gli passiamo una copia.
      pdf = await pdfjsLib.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
    } catch (err) {
      hideLoading();
      console.error(err);
      alert('Impossibile aprire il PDF. Il file potrebbe essere danneggiato o protetto da password.');
      return;
    }
    if (state.pdf) { try { state.pdf.destroy(); } catch (e) { /* ignora */ } }
    state.pdf = pdf;
    state.bytes = data;
    state.bookKey = key;
    state.bookName = name;
    state.pageCache.clear();

    App.edits = emptyEdits();
    try {
      const saved = await idb.get('edits:' + key);
      if (saved && saved.ann) App.edits = Object.assign(emptyEdits(), saved);
    } catch (e) { /* nessuna modifica salvata */ }

    const title = name.replace(/\.pdf$/i, '');
    el.appTitle.textContent = title;
    document.title = title + ' – Lettore di Libri';
    el.pageCount.textContent = pdf.numPages;
    el.pageInput.max = pdf.numPages;

    const pos = store.get('pos:' + key, { page: 1, sentence: 0 });
    const page = Math.min(Math.max(1, pos.page | 0), pdf.numPages);

    el.tabbar.classList.remove('hidden');
    await showPage(page, pos.sentence | 0);
    hideLoading();
    store.set('last', key);
    if (page > 1 || pos.sentence > 0) setStatus('Ripreso da pagina ' + page);
    emit('bookloaded');
    showView(store.get('view', 'viewListen') === 'viewPages' ? 'viewPages' : 'viewListen');
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
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && text && !/\s$/.test(text)) {
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

  // ---------- Visualizzazione del testo ----------
  async function showPage(n, sentenceIndex) {
    state.page = n;
    state.sentences = await getPageText(n);
    state.sentence = Math.min(Math.max(0, sentenceIndex || 0), Math.max(0, state.sentences.length - 1));
    el.pageInput.value = n;
    el.btnPrev.disabled = n <= 1;
    el.btnNext.disabled = n >= state.pdf.numPages;
    el.deletedNote.classList.toggle('hidden', !(App.edits && App.edits.del[n]));

    el.pageText.innerHTML = '';
    if (!state.sentences.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Questa pagina non contiene testo leggibile (potrebbe essere vuota o un\'immagine scansionata). Puoi vederla nella scheda Pagine.';
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
    emit('pagechange', { page: n });
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
      if (scroll && state.view === 'viewListen') cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    emit('modechange', { mode: m });
  }

  // ---------- Sintesi vocale ----------
  // Punteggio di qualità: le voci "Premium", "Avanzate", "Naturali" o di Google
  // suonano molto meno robotiche di quelle compatte o di sistema.
  const NOVELTY = /\b(eddy|flo|reed|rocko|sandy|shelley|grandma|grandpa|nonna|nonno|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph)\b/;
  function voiceInfo(v) {
    const id = (v.name + ' ' + (v.voiceURI || '')).toLowerCase();
    let score = 0;
    let tag = '';
    if (/^it/i.test(v.lang)) score += 1000;
    if (/^it[-_]it/i.test(v.lang)) score += 5;
    if (/premium/.test(id)) { score += 60; tag = 'Premium'; }
    else if (/enhanced|avanzat|migliorat/.test(id)) { score += 45; tag = 'Avanzata'; }
    if (/natural|neural/.test(id)) { score += 60; tag = tag || 'Naturale'; }
    if (/google/.test(id)) { score += 35; tag = tag || 'Naturale'; }
    if (/online/.test(id)) score += 10;
    if (/eloquence|novelty|speech\.synthesis\.voice/.test(id) || NOVELTY.test(id)) score -= 60;
    if (/compact/.test(id)) score -= 10;
    if (v.localService === false) score += 5;
    return { score, tag };
  }

  function voiceTip() {
    const ua = navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
      return 'Per una voce più naturale: Impostazioni → Accessibilità → Contenuti letti ad alta voce → Voci → Italiano, ' +
        'scarica una voce «Premium» o «Avanzata» (es. Federica, Alice, Luca), poi chiudi e riapri l\'app.';
    }
    if (/android/i.test(ua)) {
      return 'Per una voce più naturale: Impostazioni → Sistema → Lingue → Output sintesi vocale → Servizi di sintesi vocale di Google ⚙️ → ' +
        'Installa dati vocali → Italiano, scegli una voce e scarica la versione di alta qualità; poi riapri l\'app.';
    }
    if (/macintosh/i.test(ua)) {
      return 'Per una voce più naturale: Impostazioni di Sistema → Accessibilità → Contenuti letti → Voce di sistema → Gestisci voci → Italiano, ' +
        'scarica una voce «Premium» o «Avanzata». In Chrome c\'è anche «Google italiano».';
    }
    return 'Le voci più naturali sono in Microsoft Edge (voci «Online (Natural)», es. Isabella o Diego) e in Chrome («Google italiano»).';
  }

  const Neural = window.NeuralTTS;
  const neuralOk = !!(Neural && Neural.available());
  const isNeural = () => neuralOk && el.voiceSelect.value === Neural.id;

  function loadVoices() {
    const all = synth ? synth.getVoices() : [];
    if (!all.length && !neuralOk) return;
    const info = new Map(all.map((v) => [v, voiceInfo(v)]));
    const it = all.filter((v) => /^it/i.test(v.lang))
      .sort((a, b) => info.get(b).score - info.get(a).score || a.name.localeCompare(b.name));
    const others = all.filter((v) => !/^it/i.test(v.lang))
      .sort((a, b) => a.lang.localeCompare(b.lang) || info.get(b).score - info.get(a).score || a.name.localeCompare(b.name));
    state.voices = it.concat(others);

    const saved = store.get('voice', null);
    el.voiceSelect.innerHTML = '';
    const addGroup = (label, list) => {
      if (!list.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      list.forEach((v) => {
        const o = document.createElement('option');
        const tag = info.get(v).tag;
        o.value = v.voiceURI || v.name;
        o.textContent = (tag ? '★ ' : '') + v.name + ' (' + v.lang + ')' + (tag ? ' — ' + tag : '');
        g.appendChild(o);
      });
      el.voiceSelect.appendChild(g);
    };
    if (neuralOk) {
      const g = document.createElement('optgroup');
      g.label = 'Voce naturale (neurale, funziona offline)';
      const o = document.createElement('option');
      o.value = Neural.id;
      o.textContent = '✨ Paola — la più naturale';
      g.appendChild(o);
      el.voiceSelect.appendChild(g);
    }
    addGroup('Voci italiane del telefono (le migliori in alto)', it);
    addGroup('Altre lingue', others);

    // Scelta automatica: la voce italiana di qualità più alta, se non ne hai scelta una tu.
    let chosen = state.voices.find((v) => (v.voiceURI || v.name) === saved);
    if (!chosen) chosen = it[0] || all.find((v) => v.default) || all[0];
    if (neuralOk && (saved === Neural.id || (!saved && !it.length))) el.voiceSelect.value = Neural.id;
    else if (chosen) el.voiceSelect.value = chosen.voiceURI || chosen.name;

    const bestTag = it.length ? info.get(it[0]).tag : '';
    el.voiceTip.textContent = bestTag ? '' : voiceTip() + (neuralOk ? ' Oppure usa la voce naturale Paola qui sopra.' : '');
    el.voiceTip.classList.toggle('hidden', !!bestTag || isNeural());
    updateNeuralUi();

    if (!it.length && !neuralOk) setStatus('Nessuna voce italiana installata: apri ⚙️ Voce per sapere come aggiungerla.');
  }

  // ---------- Voce naturale (Paola) ----------
  function updateNeuralUi() {
    if (!el.neuralBox) return;
    el.neuralBox.classList.toggle('hidden', !neuralOk);
    if (!neuralOk) { el.btnSettings.textContent = '⚙️ Voce'; return; }
    const st = Neural.state;
    const active = isNeural();
    el.neuralProg.classList.toggle('hidden', st !== 'loading');
    el.neuralProg.value = Math.round(Neural.progress * 100);
    let msg = '';
    let btn = '';
    if (st === 'loading') msg = Neural.preparing ? 'Preparo la voce…' : 'Scarico la voce: ' + Math.round(Neural.progress * 100) + '% di ' + Neural.sizeMB + ' MB';
    else if (st === 'error') { msg = 'Non è stato possibile avviare la voce naturale: ' + Neural.error; btn = 'Riprova'; }
    else if (active && st === 'ready') msg = 'Voce naturale attiva ✓ Funziona anche senza internet.';
    else if (active) msg = 'Selezionata: si avvia quando premi Leggi.';
    else btn = neuralDownloaded ? 'Usa Paola' : 'Scarica e usa Paola (' + Neural.sizeMB + ' MB)';
    el.neuralStyle.closest('label').classList.toggle('hidden', !active);
    el.neuralMsg.textContent = msg;
    el.neuralBtn.textContent = btn;
    el.neuralBtn.classList.toggle('hidden', !btn);
    el.btnSettings.textContent = active ? '⚙️ Voce' : '⚙️ Voce ✨';
    if (state.mode === 'playing' && isNeural() && st === 'loading') setStatus(msg);
  }

  let neuralDownloaded = false;
  function useNeural() {
    el.voiceSelect.value = Neural.id;
    store.set('voice', Neural.id);
    el.voiceTip.classList.add('hidden');
    Neural.load().catch(() => {});
    updateNeuralUi();
  }

  function currentVoice() {
    const id = el.voiceSelect.value;
    return state.voices.find((v) => (v.voiceURI || v.name) === id) || null;
  }

  function nextReadablePage(from) {
    for (let n = from + 1; n <= state.pdf.numPages; n++) {
      if (!App.edits.del[n]) return n;
    }
    return 0;
  }

  function speakCurrent() {
    if (state.mode !== 'playing') return;
    const myToken = ++state.token;

    if (state.sentence >= state.sentences.length) {
      // Fine pagina: passa alla successiva (saltando quelle eliminate).
      const next = nextReadablePage(state.page);
      if (next) {
        showPage(next, 0).then(() => {
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

    if (isNeural()) { speakNeural(myToken); return; }

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

  function speakNeural(myToken) {
    const rate = parseFloat(el.rateInput.value) || 1;
    const text = state.sentences[state.sentence];
    if (Neural.state !== 'ready') {
      setStatus('Preparo la voce naturale…');
      Neural.load().then(() => { if (myToken === state.token && state.mode === 'playing') updateButtons(); }).catch(() => {});
    }
    Neural.speak(text, rate).then(() => {
      if (myToken !== state.token || state.mode !== 'playing') return;
      state.errors = 0;
      state.sentence++;
      speakCurrent();
    }).catch((err) => {
      if (myToken !== state.token || (err && err.canceled)) return;
      console.warn('Voce naturale:', err);
      if (err && err.name === 'NotAllowedError') { pause(); setStatus('Premi Riprendi per continuare'); return; }
      if (Neural.state === 'error' || ++state.errors >= 3) {
        pause();
        setStatus('La voce naturale non funziona su questo dispositivo: scegli un\'altra voce in ⚙️ Voce.');
        return;
      }
      state.sentence++;
      setTimeout(speakCurrent, 50);
    });
    // Prepara in anticipo la frase successiva (anche della pagina dopo), così non ci sono pause.
    const nextText = state.sentences[state.sentence + 1];
    if (nextText) Neural.prefetch(nextText, rate);
    else {
      const np = nextReadablePage(state.page);
      if (np) getPageText(np).then((ss) => { if (ss[0]) Neural.prefetch(ss[0], rate); }).catch(() => {});
    }
  }

  function cancelSpeech() {
    state.token++;
    if (synth) synth.cancel();
    if (neuralOk) Neural.stop();
  }

  function play() {
    if (!synth && !isNeural()) { alert('Questo browser non supporta la sintesi vocale.'); return; }
    if (!state.pdf) return;
    if (isNeural()) Neural.unlock(); // va fatto subito, dentro il tocco
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

  function togglePlay() {
    if (state.mode === 'playing') pause();
    else if (state.mode === 'paused') resume();
    else play();
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

  async function goToPage(n, sentence) {
    if (!state.pdf) return;
    n = Math.min(Math.max(1, n | 0), state.pdf.numPages);
    const wasPlaying = state.mode === 'playing';
    cancelSpeech();
    if (state.mode === 'paused') state.mode = 'stopped';
    await showPage(n, sentence || 0);
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

  // ---------- API condivisa con viewer.js ----------
  const App = window.App = {
    state, el, events, store, idb, edits: emptyEdits(), emptyEdits,
    play, pause, resume, stop, togglePlay, goToPage, showView,
    saveEdits, showLoading, hideLoading, toast, loadScript,
  };

  // ---------- Eventi ----------
  el.fileInputs.forEach((input) => input.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    openFile(f).catch((err) => { hideLoading(); console.error(err); alert('Errore durante l\'apertura del file.'); });
  }));

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

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
  el.btnSettings.addEventListener('click', () => {
    const open = el.settings.classList.toggle('hidden') === false;
    el.btnSettings.setAttribute('aria-expanded', String(open));
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
    if (isNeural()) useNeural();
    else { updateNeuralUi(); el.voiceTip.classList.toggle('hidden', !el.voiceTip.textContent); }
    if (state.mode === 'playing') play(); // riparte la frase con la nuova voce
  });
  if (neuralOk) {
    el.neuralBtn.addEventListener('click', () => { Neural.unlock(); useNeural(); });
    el.neuralStyle.value = Neural.style;
    el.neuralStyle.addEventListener('change', () => {
      Neural.setStyle(el.neuralStyle.value);
      if (state.mode === 'playing') play(); // riparte la frase con il nuovo stile
    });
    Neural.onChange(updateNeuralUi);
    Neural.isDownloaded().then((ok) => {
      neuralDownloaded = ok;
      updateNeuralUi();
      if (ok && isNeural()) Neural.load().catch(() => {}); // prepara subito la voce già scaricata
    });
  }

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
    if (e.target.matches('input, select, textarea') || document.querySelector('dialog[open]')) return;
    if (document.body.classList.contains('editor-mode')) return;
    if (e.code === 'Space' && state.pdf) { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' && e.altKey) goToPage(state.page + 1);
    else if (e.key === 'ArrowLeft' && e.altKey) goToPage(state.page - 1);
  });

  window.addEventListener('pagehide', () => { savePosition(); if (synth) synth.cancel(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode === 'playing') requestWakeLock();
  });

  // ---------- Installazione come app ----------
  function setupInstall() {
    if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      el.installHint.textContent = 'Per installarla: tocca Condividi ⬆️ e poi «Aggiungi alla schermata Home».';
      el.installHint.classList.remove('hidden');
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      el.installHint.innerHTML = '';
      const b = document.createElement('button');
      b.className = 'btn';
      b.style.flexDirection = 'row';
      b.style.fontSize = '1rem';
      b.textContent = '📲 Installa come app';
      b.addEventListener('click', () => { e.prompt(); el.installHint.classList.add('hidden'); });
      el.installHint.appendChild(b);
      el.installHint.classList.remove('hidden');
    });
  }

  // ---------- Avvio ----------
  function init() {
    const rate = store.get('rate', '1');
    el.rateInput.value = rate;
    el.rateValue.textContent = parseFloat(rate).toFixed(1) + '×';
    const font = store.get('font', '22');
    el.fontInput.value = font;
    document.documentElement.style.setProperty('--font-size', font + 'px');

    loadVoices();
    if (synth) {
      if ('onvoiceschanged' in synth) synth.addEventListener('voiceschanged', loadVoices);
      setTimeout(loadVoices, 500); // alcuni browser caricano le voci in ritardo
    } else {
      setStatus('Sintesi vocale non supportata da questo browser.');
    }
    updateButtons();
    setupInstall();
    showView('welcome');

    // Riapre automaticamente l'ultimo libro.
    if (store.get('last', null)) {
      showLoading('Riapro l\'ultimo libro…');
      idb.get('last').then((rec) => {
        if (rec && rec.data && !state.pdf) return loadPdf(new Uint8Array(rec.data), rec.name, rec.key);
        hideLoading();
      }).catch(() => hideLoading());
    }
  }

  // viewer.js si aggancia agli eventi: avviamo dopo che tutti gli script sono caricati.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
