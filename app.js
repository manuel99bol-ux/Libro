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
    settingsBackdrop: $('settingsBackdrop'),
    settingsClose: $('settingsClose'),
    settingsBody: document.querySelector('#settings .sheet-body'),
    pageInput: $('pageInput'),
    pageCount: $('pageCount'),
    voiceSelect: $('voiceSelect'),
    voiceTip: $('voiceTip'),
    neuralBox: $('neuralBox'),
    neuralProg: $('neuralProg'),
    neuralMsg: $('neuralMsg'),
    neuralStyle: $('neuralStyle'),
    paolaStyleRow: $('paolaStyleRow'),
    saraPrep: $('saraPrep'),
    saraPrepBtn: $('saraPrepBtn'),
    saraPrepInfo: $('saraPrepInfo'),
    saraPages: $('saraPages'),
    azureBox: $('azureBox'),
    azForm: $('azForm'),
    azConnected: $('azConnected'),
    azKey: $('azKey'),
    azRegion: $('azRegion'),
    azConnect: $('azConnect'),
    azVoice: $('azVoice'),
    azTry: $('azTry'),
    azUse: $('azUse'),
    azDisconnect: $('azDisconnect'),
    azMsg: $('azMsg'),
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
    state.pageCache.clear();
    state.editsDirty = true;
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
    document.body.classList.toggle('view-pages', id === 'viewPages');
    if (id !== 'welcome') store.set('view', id);
    emit('viewchange', { view: id, prev });
    if (id === 'viewListen' && state.editsDirty && state.pdf) {
      state.editsDirty = false;
      showPage(state.page, state.sentence); // il testo della pagina potrebbe essere cambiato nell'editor
    } else if (id === 'viewListen') highlight(true);
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

  // Apre un PDF già in memoria (per esempio la versione appena modificata) come libro corrente.
  async function openPdfBytes(buffer, name) {
    const key = name + '|' + buffer.byteLength;
    const page = state.page || 1;
    if (!store.get('pos:' + key, null)) store.set('pos:' + key, { page, sentence: 0 });
    idb.put('last', { key, name, data: buffer.slice(0) }).catch(() => {});
    await loadPdf(new Uint8Array(buffer), name, key);
    toast('Ora stai usando «' + name + '»');
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
    el.appTitle.textContent = name;
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
    // Righe modificate nell'editor: il testo coperto non si legge, al suo posto si legge quello nuovo.
    const repl = editedLines(String(n), page);
    // Righe con la loro dimensione di carattere (serve a riconoscere il titolo della pagina).
    const lines = [];
    let cur = null;
    let lastY = null;
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const t = item.transform || [1, 0, 0, 1, 0, 0];
      const hit = repl.find((r) => t[4] >= r.x0 && t[4] <= r.x1 && t[5] >= r.y0 && t[5] <= r.y1);
      if (hit) {
        if (!hit.used && hit.text) {
          hit.used = true;
          lines.push({ text: hit.text, size: hit.size, chars: hit.text.length });
        }
        cur = null;
        lastY = null;
        continue;
      }
      const y = t[5];
      const size = Math.hypot(t[2], t[3]) || item.height || 0;
      if (!cur || (lastY !== null && Math.abs(y - lastY) > 2)) {
        cur = { text: '', size: 0, chars: 0 };
        lines.push(cur);
      }
      cur.text += item.str;
      if (item.str.trim()) { cur.size = Math.max(cur.size, size); cur.chars += item.str.length; }
      if (item.hasEOL) { cur = null; lastY = null; } else lastY = y;
    }
    const clean = (s) => s
      .replace(/([\p{L}])[-­]\s*\n\s*([\p{Ll}])/gu, '$1$2') // parole spezzate a fine riga
      .replace(/\s*\n\s*/g, ' ')
      .replace(/[ \t ]+/g, ' ')
      .trim();
    const real = lines.filter((l) => l.text.trim());
    // Dimensione del testo normale: quella che copre più caratteri.
    const bySize = new Map();
    for (const l of real) { const k = Math.round(l.size * 2) / 2; bySize.set(k, (bySize.get(k) || 0) + l.chars); }
    let body = 0, most = -1;
    bySize.forEach((c, k) => { if (c > most) { most = c; body = k; } });
    // Titolo: le prime righe scritte più in grande del testo normale.
    let h = 0;
    while (h < real.length && h < 4 && body && real[h].size >= body * 1.18 && real[h].text.trim().length <= 120) h++;
    if (h === real.length) h = 0; // tutta la pagina in grande: nessun titolo
    const heading = clean(real.slice(0, h).map((l) => l.text).join('\n'));
    const rest = clean(real.slice(h).map((l) => l.text).join('\n'));
    const sentences = (heading ? [heading] : []).concat(splitSentences(rest));
    sentences.head = heading ? 1 : 0;
    state.pageCache.set(n, sentences);
    return sentences;
  }

  // Righe del PDF modificate (copertura + testo nuovo), con il riquadro nello spazio della pagina PDF.
  function editedLines(key, page) {
    const list = (App.edits && App.edits.ann[key]) || [];
    if (!list.length) return [];
    const view = page.view;
    const W = view[2] - view[0], H = view[3] - view[1];
    const fromDisp = (x, y, r) => (r === 90 ? [y, 1 - x] : r === 180 ? [1 - x, 1 - y] : r === 270 ? [1 - y, x] : [x, y]);
    const toUser = (R, X, Y) => {
      const d = R % 180 ? { w: H, h: W } : { w: W, h: H };
      const uv = fromDisp(X / d.w, Y / d.h, R);
      return [view[0] + uv[0] * W, view[3] - uv[1] * H];
    };
    const out = [];
    list.forEach((o, i) => {
      if (!(o.type === 'shape' && o.whiteout)) return;
      const R = o.R || 0;
      const pts = [[o.x, o.y], [o.x + o.w, o.y], [o.x, o.y + o.h], [o.x + o.w, o.y + o.h]].map((q) => toUser(R, q[0], q[1]));
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const nx = list[i + 1];
      const tb = nx && nx.type === 'tbox' && (nx.R || 0) === R && nx.y < o.y + o.h && nx.y + nx.size * 1.6 > o.y ? nx : null;
      out.push({
        x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1,
        text: tb ? tb.text.replace(/\s+/g, ' ').trim() : '', size: tb ? tb.size : 0, used: false,
      });
    });
    return out;
  }

  // Testo da pronunciare per la frase i (al titolo aggiunge un punto, per una pausa naturale).
  function spoken(list, i) {
    const s = list[i] || '';
    const t = speechText(s);
    return i < (list.head || 0) && !/[.!?:;…]$/.test(t) ? t + '.' : t;
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
        span.className = i < (state.sentences.head || 0) ? 's h' : 's';
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
      // Niente salti mentre è aperto il pannello della voce.
      if (scroll && state.view === 'viewListen' && el.settings.classList.contains('hidden')) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  const NV = window.NeuralVoices;
  const neuralOk = !!(NV && NV.available());
  const activeNeural = () => (neuralOk ? NV.get(el.voiceSelect.value) : null);
  const isNeural = () => !!activeNeural();

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
      g.label = 'Voci naturali (funzionano offline)';
      [['neural:paola', '✨ Paola — calma e scorrevole'], ['neural:sara', '✨ Sara — la più espressiva']].forEach(([id, label]) => {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = label;
        g.appendChild(o);
      });
      el.voiceSelect.appendChild(g);
    }
    if (neuralOk && NV.azure.configured()) {
      const g = document.createElement('optgroup');
      g.label = 'Voce premium Azure (serve internet)';
      NV.azure.voices().forEach((v) => {
        const o = document.createElement('option');
        o.value = 'azure:' + v.name;
        o.textContent = '☁️ ' + v.label + ' — Azure';
        g.appendChild(o);
      });
      el.voiceSelect.appendChild(g);
    }
    if (claudeTts) {
      const g = document.createElement('optgroup');
      g.label = 'Voce di Claude (su computer, nell\'anteprima claude.ai)';
      CLAUDE_VOICES.forEach(([id, label]) => {
        const o = document.createElement('option');
        o.value = 'claude:' + id;
        o.textContent = '🎙 Claude — ' + label;
        g.appendChild(o);
      });
      el.voiceSelect.appendChild(g);
    }
    addGroup('Voci italiane del telefono (le migliori in alto)', it);
    addGroup('Altre lingue', others);

    // Scelta automatica: la voce italiana di qualità più alta, se non ne hai scelta una tu.
    let chosen = state.voices.find((v) => (v.voiceURI || v.name) === saved);
    if (!chosen) chosen = it[0] || all.find((v) => v.default) || all[0];
    if (saved && [...el.voiceSelect.options].some((o) => o.value === saved) && (saved.startsWith('claude:') || (neuralOk && NV.get(saved)))) el.voiceSelect.value = saved;
    else if (neuralOk && !saved && !it.length) el.voiceSelect.value = 'neural:paola';
    else if (chosen) el.voiceSelect.value = chosen.voiceURI || chosen.name;

    const bestTag = it.length ? info.get(it[0]).tag : '';
    el.voiceTip.textContent = bestTag ? '' : voiceTip() + (neuralOk ? ' Oppure usa una voce naturale qui sopra (Paola o Sara).' : '');
    el.voiceTip.classList.toggle('hidden', !!bestTag || isNeural());
    updateNeuralUi();

    if (!it.length && !neuralOk && !claudeTts) setStatus('Nessuna voce italiana installata: apri ⚙️ Voce per sapere come aggiungerla.');
  }

  // ---------- Voci naturali (Paola e Sara) ----------
  const downloaded = {};
  let prep = null;            // preparazione in anticipo di Sara: { texts, active }
  let upcomingTexts = [];     // prossime frasi da leggere (per sapere quanto audio è pronto)

  function fmtMin(sec) {
    if (sec < 60) return Math.max(1, Math.round(sec)) + ' s';
    return Math.round(sec / 60) + ' min';
  }

  function updateNeuralUi() {
    if (!el.neuralBox) return;
    el.neuralBox.classList.toggle('hidden', !neuralOk);
    if (!neuralOk) { el.btnSettings.classList.remove('has-tip'); return; }
    const act = activeNeural();
    el.neuralBox.querySelectorAll('.nv').forEach((row) => {
      const v = NV.get(row.dataset.voice);
      const btn = row.querySelector('.nv-btn');
      const on = act === v;
      row.classList.toggle('on', on);
      let t;
      if (on && v.state === 'loading') t = Math.round(v.progress * 100) + '%';
      else if (on && v.state === 'error') t = 'Riprova';
      else if (on && (v.state === 'ready' || downloaded[v.id])) t = 'In uso ✓';
      else t = downloaded[v.id] ? 'Usa' : 'Scarica · ' + v.sizeMB + ' MB';
      btn.textContent = t;
      btn.disabled = on && t !== 'Riprova' && !/^Scarica/.test(t);
    });
    let msg = '';
    if (act) {
      if (act.state === 'loading') msg = act.preparing ? 'Preparo la voce ' + act.name + '…' : 'Scarico ' + act.name + ': ' + Math.round(act.progress * 100) + '% di ' + act.sizeMB + ' MB (una volta sola).';
      else if (act.state === 'error' && !act.cloud) msg = act.name + ' non si è avviata su questo dispositivo: ' + act.error;
      else if (act.cloud) msg = '';
      else if (act.state === 'ready' && !act.slow) msg = act.name + ' è attiva ✓ Funziona anche senza internet.';
      else if (act.state === 'ready') {
        const ready = act.readySeconds(upcomingTexts);
        msg = 'Sara è attiva ✓ Audio già pronto davanti a te: ' + (ready ? fmtMin(ready) : 'ancora niente') + '.';
      } else msg = act.name + ' si avvia quando premi Leggi.';
    }
    el.neuralProg.classList.toggle('hidden', !(act && act.state === 'loading'));
    el.neuralProg.value = act ? Math.round(act.progress * 100) : 0;
    el.neuralMsg.textContent = msg;
    el.paolaStyleRow.classList.toggle('hidden', !(act && act.styles));
    el.saraPrep.classList.toggle('hidden', !(act && act.slow && !act.cloud && act.state !== 'error'));
    if (act && act.slow && !act.cloud) updatePrepUi(act);
    updateAzureUi();
    el.btnSettings.classList.toggle('has-tip', !act); // pallino: c'è una voce più naturale da provare
    if (state.mode === 'playing' && act && act.state === 'loading') setStatus(msg);
  }

  function updatePrepUi(v) {
    if (!prep || !prep.active) {
      el.saraPrepBtn.textContent = 'Prepara in anticipo';
      el.saraPrepInfo.textContent = 'Sara è più lenta a generare la voce: preparare qualche pagina prima di ascoltare evita le pause.';
      return;
    }
    const done = prep.texts.filter((t) => v.isReady(t)).length;
    const left = prep.texts.filter((t) => !v.isReady(t)).reduce((a, t) => a + t.length, 0);
    el.saraPrepBtn.textContent = 'Interrompi';
    if (done >= prep.texts.length) {
      prep.active = false;
      el.saraPrepBtn.textContent = 'Prepara in anticipo';
      el.saraPrepInfo.textContent = 'Fatto ✓ ' + prep.pages + (prep.pages === 1 ? ' pagina pronta.' : ' pagine pronte.');
      if (state.mode !== 'playing') releaseWakeLock();
      return;
    }
    const eta = v.msPerChar ? ' · circa ' + fmtMin(left * v.msPerChar / 1000) + ' rimasti' : '';
    el.saraPrepInfo.textContent = 'Preparo: ' + done + ' di ' + prep.texts.length + ' frasi' + eta + '. Tieni l\'app aperta.';
  }

  // Testi delle prossime frasi, a partire da quella corrente (anche nelle pagine successive).
  async function upcoming(maxSentences, maxPages) {
    const out = [];
    let page = state.page;
    let list = state.sentences;
    let from = state.sentence;
    let pages = 1;
    for (;;) {
      for (let i = from; i < list.length; i++) { out.push(spoken(list, i)); if (out.length >= maxSentences) return out; }
      from = 0;
      const np = nextReadablePage(page);
      if (!np || pages >= maxPages) return out;
      page = np;
      pages++;
      list = await getPageText(np);
    }
  }

  async function feedQueue(v) {
    const ahead = await upcoming(60, 6);
    upcomingTexts = ahead;
    const texts = prep && prep.active ? ahead.concat(prep.texts.filter((t) => !ahead.includes(t))) : ahead;
    v.setQueue(texts);
  }

  async function togglePrepare() {
    const v = activeNeural();
    if (!v || !v.slow || !state.pdf) return;
    if (prep && prep.active) {
      prep.active = false;
      v.setQueue(state.mode === 'playing' ? upcomingTexts : []);
      if (state.mode !== 'playing') releaseWakeLock();
      updateNeuralUi();
      return;
    }
    const pages = parseInt(el.saraPages.value, 10) || 10;
    const texts = await upcoming(100000, pages);
    upcomingTexts = texts.slice(0, 60);
    prep = { texts, pages, active: true };
    requestWakeLock();
    v.load().catch(() => {});
    v.setQueue(state.mode === 'playing' ? upcomingTexts.concat(texts.filter((t) => !upcomingTexts.includes(t))) : texts);
    updateNeuralUi();
  }

  // Voce di riserva quando Azure non è disponibile: Paola se è scaricata, altrimenti la migliore del telefono.
  function fallbackVoice() {
    if (neuralOk && downloaded['neural:paola']) return 'neural:paola';
    const opt = [...el.voiceSelect.options].find((o) => !o.value.startsWith('azure:') && !o.value.startsWith('neural:'));
    return opt ? opt.value : 'neural:paola';
  }

  function updateAzureUi() {
    if (!el.azureBox) return;
    const az = NV.azure;
    el.azureBox.classList.toggle('hidden', !neuralOk);
    const on = az.configured();
    el.azForm.classList.toggle('hidden', on);
    el.azConnected.classList.toggle('hidden', !on);
    if (on) {
      const cur = el.azVoice.value;
      el.azVoice.innerHTML = '';
      az.voices().forEach((v) => {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = v.label + (v.gender === 'Male' ? ' · voce maschile' : v.gender === 'Female' ? ' · voce femminile' : '');
        el.azVoice.appendChild(o);
      });
      el.azVoice.value = cur && az.voices().some((v) => v.name === cur) ? cur : az.settings.voice;
      const active = activeNeural() === az;
      el.azUse.textContent = active && el.voiceSelect.value === 'azure:' + el.azVoice.value ? 'In uso ✓' : 'Usa questa voce';
      if (!el.azMsg.dataset.sticky) {
        el.azMsg.textContent = active ? 'Voce premium attiva ✓ Le frasi già ascoltate restano sul telefono e non consumano di nuovo la quota.' : 'Azure è collegato ✓';
      }
    } else if (az.state === 'error') {
      el.azMsg.textContent = az.error;
    } else if (az.state === 'loading') {
      el.azMsg.textContent = 'Controllo la chiave…';
    } else if (!el.azMsg.dataset.sticky) {
      el.azMsg.textContent = '';
    }
  }

  function useVoice(id) {
    const v = NV.get(id);
    el.voiceSelect.value = id;
    store.set('voice', id);
    el.voiceTip.classList.add('hidden');
    NV.list.forEach((o) => { if (o !== v && o.state !== 'idle') o.release(); }); // libera la memoria dell'altra voce
    prep = null;
    v.load().then(() => { downloaded[id] = true; }).catch(() => {});
    if (v.slow && state.pdf) upcoming(60, 6).then((t) => { upcomingTexts = t; v.setQueue(t); updateNeuralUi(); });
    updateNeuralUi();
  }

  // Testo da pronunciare: abbreviazioni e simboli letti per esteso (il testo mostrato non cambia).
  const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  function roman(r) {
    let n = 0;
    for (let i = 0; i < r.length; i++) {
      const a = ROMAN[r[i]], b = ROMAN[r[i + 1]] || 0;
      n += a < b ? -a : a;
    }
    return n;
  }
  const ABBR = [
    [/\bpagg\.\s*/gi, 'pagine '], [/\bpag\.\s*/gi, 'pagina '], [/\bpp\.\s*(?=\d)/g, 'pagine '], [/\bp\.\s*(?=\d)/g, 'pagina '],
    [/\bcap\.\s*/gi, 'capitolo '], [/\bcapp\.\s*/gi, 'capitoli '], [/\bvol\.\s*/gi, 'volume '], [/\bfig\.\s*/gi, 'figura '],
    [/\becc\.(?=\s+[A-ZÀ-Ý«"“]|\s*$)/g, 'eccetera.'], [/\becc\.(?=\s|$)/gi, 'eccetera'], [/\betc\.(?=\s|$)/gi, 'eccetera'], [/\bp\.\s?es\./gi, 'per esempio'], [/\bad es\./gi, 'ad esempio'],
    [/\bes\.\s/gi, 'esempio '], [/\bcfr\.\s*/gi, 'confronta '], [/\bdott\.ssa\b/gi, 'dottoressa'], [/\bdott\.\s*/gi, 'dottor '],
    [/\bsig\.ra\b/gi, 'signora'], [/\bsigg\.\s*/gi, 'signori '], [/\bsig\.\s*/gi, 'signor '], [/\bprof\.ssa\b/gi, 'professoressa'],
    [/\bprof\.\s*/gi, 'professor '], [/\bavv\.\s*/gi, 'avvocato '], [/\bing\.\s*/gi, 'ingegner '], [/\bgeom\.\s*/gi, 'geometra '],
    [/\bn\.\s*(?=\d)/gi, 'numero '], [/\bnr\.\s*(?=\d)/gi, 'numero '], [/\btel\.\s*/gi, 'telefono '], [/\bart\.\s*(?=\d)/gi, 'articolo '],
    [/\ba\.\s?C\./g, 'avanti Cristo'], [/\bd\.\s?C\./g, 'dopo Cristo'], [/\bS\.\s?p\.\s?A\./g, 'Società per azioni'],
  ];
  function speechText(s) {
    let t = s;
    for (const [re, rep] of ABBR) t = t.replace(re, rep);
    t = t
      .replace(/\.{3,}/g, '…')
      .replace(/(\d)\s?%/g, '$1 percento')
      .replace(/€\s?(\d[\d.,]*)/g, '$1 euro').replace(/(\d)\s?€/g, '$1 euro')
      .replace(/(\d)\s?°\s?C\b/g, '$1 gradi').replace(/(\d)\s?°/g, '$1 gradi')
      .replace(/\s&\s/g, ' e ')
      .replace(/§\s?/g, 'paragrafo ')
      .replace(/\b(capitolo|parte|libro|atto|scena|volume|tomo|canto|sezione)\s+([IVXLCDM]{1,7})\b/gi, (m, w, r) => w + ' ' + roman(r.toUpperCase()))
      .replace(/^\s*([IVXLC]{1,6})\s*[.)]?\s*$/, (m, r) => 'Capitolo ' + roman(r))
      .replace(/[_*#~|<>{}\[\]]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return t;
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

  // ---------- Voce di Claude (solo nell'anteprima claude.ai, su computer) ----------
  // La piattaforma legge una pagina intera come elenco di righe (una per frase)
  // e ci dice quando inizia ogni riga: così l'evidenziazione segue la voce.
  const CLAUDE_VOICES = [['buttery', 'morbida'], ['airy', 'ariosa'], ['glassy', 'cristallina'], ['rounded', 'rotonda']];
  let claudeTts = null;
  let claudeLang = null;
  const C = { token: 0, page: 0, next: 0, queued: 0, adding: false, done: false };
  const isClaude = () => !!claudeTts && el.voiceSelect.value.startsWith('claude:');

  async function claudeBatch(n) {
    const out = [];
    while (out.length < n) {
      const list = C.page === state.page ? state.sentences : await getPageText(C.page);
      if (C.next < list.length) {
        const text = spoken(list, C.next).slice(0, 2000);
        if (text.trim()) out.push({ text, id: C.page + ':' + C.next });
        C.next++;
      } else {
        const np = nextReadablePage(C.page);
        if (!np) { C.done = true; break; }
        C.page = np;
        C.next = 0;
      }
    }
    C.queued += out.length;
    return out;
  }

  function claudeOpts() {
    const o = { voice: el.voiceSelect.value.slice(7), rate: Math.min(1.5, Math.max(0.7, parseFloat(el.rateInput.value) || 1)) };
    if (claudeLang) o.language = claudeLang;
    return o;
  }

  function claudeFail(err, myToken) {
    if (myToken !== state.token || !err || err.code === 'stopped') return;
    console.warn('Voce di Claude:', err);
    if (err.code === 'not_granted' || err.code === 'unavailable') {
      if (err.code === 'not_granted') { claudeTts = null; loadVoices(); }
      pause();
      setStatus('La voce di Claude non è disponibile qui: scegli un\'altra voce in Voce.');
    } else if (err.code === 'no_gesture') {
      pause();
      setStatus('Tocca Riprendi per far leggere Claude.');
    } else if (err.code === 'rate_limited') {
      pause();
      setStatus('Claude ha letto molto in poco tempo: riprova fra qualche minuto, o scegli un\'altra voce.');
    } else if (err.code === 'busy') {
      pause();
      setStatus('Il microfono è in uso: riprova fra poco.');
    } else {
      pause();
      setStatus('La voce di Claude si è interrotta. Tocca Riprendi.');
    }
  }

  function claudeStart(myToken) {
    C.token = myToken;
    C.page = state.page;
    C.next = state.sentence;
    C.queued = 0;
    C.done = false;
    highlight(true);
    savePosition();
    // Le righe vanno passate subito (siamo ancora dentro il tocco su «Leggi»).
    const first = [];
    const list = state.sentences;
    while (C.next < list.length && first.length < 40) {
      const text = spoken(list, C.next).slice(0, 2000);
      if (text.trim()) first.push({ text, id: C.page + ':' + C.next });
      C.next++;
    }
    C.queued = first.length;
    const go = (lines) => claudeTts.speak(lines, claudeOpts()).then(() => claudeMaybeEnd(myToken)).catch((e) => claudeFail(e, myToken));
    if (first.length) go(first);
    else claudeBatch(40).then((lines) => { if (myToken !== state.token) return; if (lines.length) go(lines); else claudeMaybeEnd(myToken); });
  }

  function claudeMaybeEnd(myToken) {
    if (myToken !== state.token || state.mode !== 'playing' || C.adding) return;
    if (!claudeTts.active() && C.done) {
      stop(false);
      state.sentence = 0;
      setStatus('Fine del libro 🎉');
    }
  }

  function claudeOnLine(e) {
    if (C.token !== state.token || state.mode !== 'playing' || !e.id) return;
    const [p, i] = e.id.split(':').map(Number);
    if (p !== state.page) showPage(p, i).then(updateButtons);
    else { state.sentence = i; highlight(true); savePosition(); }
    // Poco prima della fine, aggiunge le righe successive (anche della pagina dopo).
    if (!C.done && !C.adding && C.queued - e.line <= 5) {
      C.adding = true;
      const myToken = C.token;
      claudeBatch(30).then((lines) => {
        C.adding = false;
        if (myToken !== state.token || !lines.length) { claudeMaybeEnd(myToken); return; }
        claudeTts.add(lines, claudeOpts()).then(() => claudeMaybeEnd(myToken)).catch((err) => claudeFail(err, myToken));
      }, () => { C.adding = false; });
    }
  }

  async function setupClaudeVoice() {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      const t = await window.claude.use('tts');
      if (!t) return;
      claudeTts = t;
      try {
        const langs = t.languages ? await t.languages().catch(() => undefined) : undefined;
        claudeLang = !langs || langs.some((l) => /^it\b/i.test(l)) ? 'it' : null;
      } catch (e) { claudeLang = 'it'; }
      t.onLine(claudeOnLine);
      t.onState((ev) => {
        if (ev.state === 'idle' && ev.reason === 'viewer_stopped' && isClaude() && state.mode === 'playing') {
          state.token++;
          state.mode = 'paused';
          updateButtons();
          savePosition();
        }
      });
      loadVoices();
    } catch (e) { /* non disponibile */ }
  }

  function speakCurrent() {
    if (state.mode !== 'playing') return;
    const myToken = ++state.token;
    if (isClaude()) { claudeStart(myToken); return; }

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

    if (isNeural()) { speakNeural(activeNeural(), myToken); return; }

    const u = new SpeechSynthesisUtterance(spoken(state.sentences, state.sentence));
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

  function speakNeural(v, myToken) {
    const rate = parseFloat(el.rateInput.value) || 1;
    const text = spoken(state.sentences, state.sentence);
    if (v.state !== 'ready') {
      setStatus(v.state === 'loading' ? 'Preparo la voce ' + v.name + '…' : 'Avvio la voce ' + v.name + '…');
      v.load().catch(() => {});
    }
    if (v.slow) feedQueue(v).then(updateNeuralUi);
    const ok = () => myToken === state.token && state.mode === 'playing';
    v.speak(text, rate,
      () => { if (ok() && v.state === 'ready') setStatus(v.cloud ? 'Scarico la voce da Azure…' : v.slow ? 'Sara sta preparando la frase… (con «Prepara in anticipo» eviti queste attese)' : 'Preparo la frase…'); },
      () => { if (ok()) updateButtons(); },
    ).then(() => {
      if (!ok()) return;
      state.errors = 0;
      state.sentence++;
      speakCurrent();
    }).catch((err) => {
      if (myToken !== state.token || (err && err.canceled)) return;
      console.warn('Voce naturale:', err);
      if (err && err.name === 'NotAllowedError') { pause(); setStatus('Premi Riprendi per continuare'); return; }
      if (v.cloud && err && err.fallback) {
        // Quota gratuita finita o chiave non valida: si continua con un'altra voce, senza costi.
        const fb = fallbackVoice();
        el.voiceSelect.value = fb;
        el.voiceSelect.dispatchEvent(new Event('change'));
        toast(err.message + ' Continuo con un\'altra voce.', 5000);
        if (state.mode !== 'playing') play();
        return;
      }
      if (v.cloud && err && err.status === 0) { pause(); setStatus(err.message); return; }
      if (v.state === 'error' || ++state.errors >= 3) {
        pause();
        setStatus(v.name + ' non funziona su questo dispositivo: scegli un\'altra voce in ⚙️ Voce.');
        return;
      }
      state.sentence++;
      setTimeout(speakCurrent, 50);
    });
    if (!v.slow) {
      // Prepara la frase successiva (anche della pagina dopo), così non ci sono pause.
      const nextText = state.sentences[state.sentence + 1];
      if (nextText) v.prefetch(spoken(state.sentences, state.sentence + 1), rate);
      else {
        const np = nextReadablePage(state.page);
        if (np) getPageText(np).then((ss) => { if (ss[0]) v.prefetch(spoken(ss, 0), rate); }).catch(() => {});
      }
    }
  }

  function cancelSpeech() {
    state.token++;
    if (synth) synth.cancel();
    if (neuralOk) NV.stopAll();
    if (claudeTts && claudeTts.active()) claudeTts.stop().catch(() => {});
  }

  function play() {
    if (!synth && !isNeural() && !isClaude()) { alert('Questo browser non supporta la sintesi vocale.'); return; }
    if (!state.pdf) return;
    if (isNeural()) NV.unlock(); // va fatto subito, dentro il tocco
    cancelSpeech();
    state.errors = 0;
    state.mode = 'playing';
    updateButtons();
    requestWakeLock();
    if (isClaude()) { speakCurrent(); return; } // la voce di Claude parte dentro il tocco
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
    speechText, openPdfBytes,
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
  // Pannello «Voce e lettura»: sale dal basso, con uno scorrimento tutto suo.
  function setSettings(open) {
    el.settings.classList.toggle('hidden', !open);
    el.settingsBackdrop.classList.toggle('hidden', !open);
    document.body.classList.toggle('sheet-open', open);
    el.btnSettings.setAttribute('aria-expanded', String(open));
    if (open) { el.settingsBody.scrollTop = 0; el.settingsClose.focus({ preventScroll: true }); }
    else { el.btnSettings.focus({ preventScroll: true }); highlight(true); }
  }
  App.setSettings = setSettings;
  el.btnSettings.addEventListener('click', () => setSettings(el.settings.classList.contains('hidden')));
  el.settingsClose.addEventListener('click', () => setSettings(false));
  el.settingsBackdrop.addEventListener('click', () => setSettings(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.settings.classList.contains('hidden')) { e.preventDefault(); setSettings(false); }
  });

  // Scorrendo il testo l'intestazione si fa compatta, così resta più spazio per leggere.
  const listenView = document.getElementById('viewListen');
  listenView.addEventListener('scroll', () => {
    const was = document.body.classList.contains('hero-compact');
    const compact = was ? listenView.scrollTop > 4 : listenView.scrollTop > 48;
    if (compact !== was) document.body.classList.toggle('hero-compact', compact);
  }, { passive: true });

  el.pageText.addEventListener('click', (e) => {
    const span = e.target.closest('.s');
    if (!span) return;
    state.sentence = parseInt(span.dataset.i, 10) || 0;
    savePosition();
    play();
  });

  el.voiceSelect.addEventListener('change', () => {
    store.set('voice', el.voiceSelect.value);
    if (isNeural()) useVoice(el.voiceSelect.value);
    else {
      NV && NV.list.forEach((o) => { if (o.state !== 'idle') o.release(); });
      updateNeuralUi();
      el.voiceTip.classList.toggle('hidden', !el.voiceTip.textContent);
    }
    if (state.mode === 'playing') play(); // riparte la frase con la nuova voce
  });
  if (neuralOk) {
    el.neuralBox.querySelectorAll('.nv').forEach((row) => {
      row.querySelector('.nv-btn').addEventListener('click', () => {
        NV.unlock();
        const v = NV.get(row.dataset.voice);
        if (v.state === 'error') v.state = 'idle';
        useVoice(v.id);
        if (state.mode === 'playing') play();
      });
    });
    // Campioni: si ascoltano subito, senza scaricare la voce.
    const demo = new Audio();
    let demoBtn = null;
    const resetDemo = () => { if (demoBtn) demoBtn.textContent = '▶ Esempio'; demoBtn = null; };
    demo.addEventListener('ended', resetDemo);
    demo.addEventListener('error', () => { resetDemo(); toast('Esempio non disponibile'); });
    el.neuralBox.querySelectorAll('.nv-demo').forEach((b) => {
      b.addEventListener('click', () => {
        const same = demoBtn === b;
        demo.pause();
        resetDemo();
        if (same) return;
        if (state.mode === 'playing') pause();
        demo.src = b.dataset.sample;
        demo.currentTime = 0;
        const p = demo.play();
        if (p && p.catch) p.catch(() => resetDemo());
        demoBtn = b;
        b.textContent = '■ Stop';
      });
    });
    // --- Azure
    const az = NV.azure;
    el.azRegion.value = az.settings.region;
    el.azConnect.addEventListener('click', async () => {
      const key = el.azKey.value.trim();
      if (!key) { el.azMsg.textContent = 'Incolla prima la chiave (KEY 1).'; return; }
      el.azConnect.disabled = true;
      try {
        const list = await az.connect(key, el.azRegion.value);
        el.azKey.value = '';
        loadVoices();
        updateNeuralUi();
        el.azMsg.textContent = 'Collegato ✓ ' + list.length + (list.length === 1 ? ' voce italiana disponibile.' : ' voci italiane disponibili.') + ' Scegline una e premi «Usa questa voce».';
      } catch (e) {
        el.azMsg.textContent = e.message;
      } finally {
        el.azConnect.disabled = false;
      }
    });
    el.azVoice.addEventListener('change', updateAzureUi);
    el.azTry.addEventListener('click', async () => {
      el.azTry.disabled = true;
      el.azMsg.textContent = 'Preparo un esempio…';
      try {
        const url = await az.preview(el.azVoice.value, 'Ciao! Sono la voce che leggerà i tuoi libri. Spero che ti piaccia.');
        if (state.mode === 'playing') pause();
        demo.pause();
        demo.src = url;
        await demo.play();
        el.azMsg.textContent = '';
        updateAzureUi();
      } catch (e) {
        el.azMsg.textContent = e.message;
      } finally {
        el.azTry.disabled = false;
      }
    });
    el.azUse.addEventListener('click', () => {
      NV.unlock();
      el.voiceSelect.value = 'azure:' + el.azVoice.value;
      el.voiceSelect.dispatchEvent(new Event('change'));
    });
    el.azDisconnect.addEventListener('click', () => {
      const wasActive = activeNeural() === az;
      az.disconnect();
      if (wasActive) { el.voiceSelect.value = fallbackVoice(); store.set('voice', el.voiceSelect.value); }
      loadVoices();
      updateNeuralUi();
      el.azMsg.textContent = 'Azure scollegato: la chiave è stata cancellata da questo dispositivo.';
    });
    az.onChange(() => updateNeuralUi());

    const paola = NV.get('neural:paola');
    el.neuralStyle.value = paola.style;
    el.neuralStyle.addEventListener('change', () => {
      paola.setStyle(el.neuralStyle.value);
      if (state.mode === 'playing' && activeNeural() === paola) play(); // riparte con il nuovo stile
    });
    el.saraPrepBtn.addEventListener('click', togglePrepare);
    let uiRaf = false;
    NV.list.forEach((v) => {
      v.onChange(() => {
        if (uiRaf) return;
        uiRaf = true;
        requestAnimationFrame(() => { uiRaf = false; updateNeuralUi(); });
      });
      v.isDownloaded().then((ok) => {
        downloaded[v.id] = ok;
        if (activeNeural() !== v) v.release(); // il controllo ha avviato un worker: lo chiudiamo
        updateNeuralUi();
        if (ok && activeNeural() === v) v.load().catch(() => {}); // prepara subito la voce già scaricata
      });
    });
  }

  let rateTimer = null;
  el.rateInput.addEventListener('input', () => {
    el.rateValue.textContent = parseFloat(el.rateInput.value).toFixed(1) + '×';
    store.set('rate', el.rateInput.value);
    clearTimeout(rateTimer);
    if (state.mode === 'playing' && isClaude() && claudeTts.setRate) { claudeTts.setRate(Math.min(1.5, Math.max(0.7, parseFloat(el.rateInput.value) || 1))); return; }
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
    const font = store.get('font', '19');
    el.fontInput.value = font;
    document.documentElement.style.setProperty('--font-size', font + 'px');

    loadVoices();
    setupClaudeVoice();
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
