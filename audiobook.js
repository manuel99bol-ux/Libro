/* Lettore di Libri — scheda «Audiolibro»: crea la registrazione del libro con una voce naturale
   (Paola, Sara) o con Azure, la conserva sul telefono per ascoltarla offline e la scarica in MP3. */
(function () {
  'use strict';

  const App = window.App;
  const NV = window.NeuralVoices;
  const S = App.state;
  const $ = (id) => document.getElementById(id);
  const ui = {
    book: $('abBookName'),
    voice: $('abVoice'),
    from: $('abFrom'),
    to: $('abTo'),
    all: $('abAll'),
    thisPage: $('abThis'),
    toEnd: $('abToEnd'),
    quota: $('abQuota'),
    quotaText: $('abQuotaText'),
    quotaBar: $('abQuotaBar'),
    fit: $('abFit'),
    estimate: $('abEstimate'),
    start: $('abStart'),
    createBox: $('abCreate'),
    progress: $('abProgress'),
    bar: $('abBar'),
    progText: $('abProgText'),
    pauseBtn: $('abPauseGen'),
    cancelBtn: $('abCancelGen'),
    list: $('abList'),
    storage: $('abStorage'),
    player: $('abPlayer'),
    pTitle: $('abPTitle'),
    pSub: $('abPSub'),
    pText: $('abPText'),
    pSeek: $('abPSeek'),
    pTime: $('abPTime'),
    pTotal: $('abPTotal'),
    pPlay: $('abPPlay'),
    pBack: $('abPBack'),
    pFwd: $('abPFwd'),
    pPrev: $('abPPrevPage'),
    pNext: $('abPNextPage'),
    pRate: $('abPRate'),
    pClose: $('abPClose'),
  };
  if (!ui.list) return;

  const KBPS = 48;
  const idb = App.idb;
  const store = App.store;
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  const fmtLong = (s) => (s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min' : Math.max(1, Math.round(s / 60)) + ' min');
  const fmtMB = (b) => (b / 1048576 < 10 ? (b / 1048576).toFixed(1) : Math.round(b / 1048576)) + ' MB';

  // ---------- Archivio (IndexedDB) ----------
  let books = [];
  async function loadList() {
    try { books = (await idb.get('abooks')) || []; } catch (e) { books = []; }
    return books;
  }
  async function saveList() { try { await idb.put('abooks', books); } catch (e) { /* ignora */ } }
  const segKey = (id, k) => 'abseg:' + id + ':' + k;

  // ---------- Voci disponibili per registrare ----------
  function voiceOptions() {
    const out = [];
    if (NV && NV.available()) {
      out.push({ id: 'neural:paola', label: '✨ Paola (offline, veloce)' });
      out.push({ id: 'neural:sara', label: '✨ Sara (offline, più lenta da creare)' });
      if (NV.azure.configured()) NV.azure.voices().forEach((v) => out.push({ id: 'azure:' + v.name, label: '☁️ ' + v.label + ' (Azure, serve internet)' }));
    }
    return out;
  }
  function fillVoices() {
    const cur = ui.voice.value || store.get('abVoice', '') || (S.bookKey && document.getElementById('voiceSelect').value);
    ui.voice.innerHTML = '';
    for (const v of voiceOptions()) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.label;
      ui.voice.appendChild(o);
    }
    if ([...ui.voice.options].some((o) => o.value === cur)) ui.voice.value = cur;
    ui.start.disabled = !ui.voice.options.length;
  }

  // ---------- Stima ----------
  function pagesInRange() {
    const n = S.pdf ? S.pdf.numPages : 0;
    let a = Math.max(1, parseInt(ui.from.value, 10) || 1);
    let b = Math.min(n, parseInt(ui.to.value, 10) || n);
    if (b < a) [a, b] = [b, a];
    const out = [];
    for (let p = a; p <= b; p++) if (!(App.edits.del && App.edits.del[p])) out.push(p);
    return out;
  }
  let estTimer = null;
  function updateEstimate() {
    clearTimeout(estTimer);
    estTimer = setTimeout(async () => {
      if (!S.pdf) { ui.estimate.textContent = ''; return; }
      const pages = pagesInRange();
      if (!pages.length) { ui.estimate.textContent = 'Nessuna pagina nell\'intervallo scelto.'; return; }
      // Media dei caratteri su alcune pagine di esempio.
      const sample = pages.filter((_, i) => i % Math.max(1, Math.floor(pages.length / 6)) === 0).slice(0, 6);
      let chars = 0;
      for (const p of sample) { const ss = await App.pageSentences(p); chars += ss.join(' ').length; }
      const total = (chars / sample.length) * pages.length;
      const dur = total / 14; // secondi di parlato
      const v = ui.voice.value;
      const speed = v.startsWith('azure:') ? 0.15 : v === 'neural:sara' ? 2.2 : 0.35; // tempo di creazione rispetto al parlato (stima)
      let t = pages.length + (pages.length === 1 ? ' pagina' : ' pagine') + ' · circa ' + fmtLong(dur) + ' di ascolto · circa ' + fmtMB(dur * KBPS * 125) +
        '. Tempo di creazione stimato: ' + fmtLong(dur * speed) + ' (dipende dal telefono).';
      ui.estimate.textContent = t;
      if (v.startsWith('azure:')) azurePlan(pages, v.slice(6));
      else ui.quota.classList.add('hidden');
    }, 250);
  }

  // Quante pagine si possono registrare con la quota Azure rimasta questo mese.
  // Le frasi già scaricate (per la stessa voce) restano sul telefono e non consumano quota.
  let planToken = 0;
  async function azurePlan(pages, voice) {
    const my = ++planToken;
    const az = NV.azure;
    const fmt = (n) => Math.round(n).toLocaleString('it-IT');
    ui.quota.classList.remove('hidden', 'warn', 'bad');
    ui.fit.classList.add('hidden');
    ui.quotaBar.value = 0;
    ui.quotaText.textContent = 'Calcolo la quota Azure necessaria…';
    const remaining = az.remaining();
    let need = 0, lastFit = 0, fitDur = 0;
    for (let k = 0; k < pages.length; k++) {
      const list = await App.pageSentences(pages[k]);
      if (my !== planToken) return;
      for (let i = 0; i < list.length; i++) {
        const text = App.spoken(list, i);
        if (text.trim() && !NV.clips.has(az.keyForVoice(text, voice))) need += text.length;
      }
      if (need <= remaining) { lastFit = k + 1; fitDur = need / 14; }
      if (k % 10 === 9) { ui.quotaText.textContent = 'Calcolo la quota Azure necessaria… (' + (k + 1) + ' di ' + pages.length + ' pagine)'; await new Promise((r) => setTimeout(r, 0)); }
    }
    if (my !== planToken) return;
    ui.quotaBar.value = need ? Math.round(Math.min(1, remaining / need) * 1000) : 1000;
    const head = 'Quota Azure rimasta questo mese: circa ' + fmt(remaining) + ' caratteri. Per le pagine scelte ne servono circa ' + fmt(need) + '. ';
    if (need <= remaining) {
      ui.quotaText.textContent = head + '✓ Bastano per tutte le pagine: dopo te ne resteranno circa ' + fmt(remaining - need) + '.';
    } else if (lastFit > 0) {
      const lastPage = pages[lastFit - 1];
      ui.quota.classList.add('warn');
      ui.quotaText.textContent = head + 'Bastano fino a pagina ' + lastPage + ' (' + lastFit + ' di ' + pages.length + ' pagine, circa ' + fmtLong(fitDur) + ' di ascolto). ' +
        'Le altre ' + (pages.length - lastFit) + ' pagine si possono creare il mese prossimo con «Continua creazione», oppure con Paola o Sara.';
      ui.fit.textContent = 'Crea solo fino a pagina ' + lastPage;
      ui.fit.dataset.page = lastPage;
      ui.fit.classList.remove('hidden');
    } else {
      ui.quota.classList.add('bad');
      ui.quotaText.textContent = head + 'La quota non basta nemmeno per la prima pagina: scegli Paola o Sara, oppure aspetta il mese prossimo.';
    }
  }

  // ---------- Creazione ----------
  let job = null; // { meta, paused, cancelled }
  const mp3Worker = { w: null, seq: 0, pending: new Map() };
  function encodeMp3(pcm, sampleRate) {
    if (!mp3Worker.w) {
      mp3Worker.w = new Worker('lib/lame/mp3-worker.js');
      mp3Worker.w.onmessage = (e) => {
        const p = mp3Worker.pending.get(e.data.id);
        if (!p) return;
        mp3Worker.pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.mp3);
      };
    }
    const id = ++mp3Worker.seq;
    return new Promise((resolve, reject) => {
      mp3Worker.pending.set(id, { resolve, reject });
      mp3Worker.w.postMessage({ id, pcm, sampleRate, kbps: KBPS }, [pcm.buffer]);
    });
  }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) { /* non disponibile */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && job && !job.paused) keepAwake(true); });

  function engineFor(voiceId) {
    if (voiceId.startsWith('azure:')) return { e: NV.azure, azure: voiceId.slice(6) };
    return { e: NV.get(voiceId) };
  }

  async function startJob(meta) {
    if (job) return;
    job = { meta, paused: false, cancelled: false };
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignora */ }
    keepAwake(true);
    showProgress();
    const { e: eng, azure } = engineFor(meta.voiceId);
    try {
      await eng.load();
    } catch (err) {
      return endJob('La voce non si è avviata: ' + (err && err.message ? err.message : err));
    }
    const sr = azure ? 24000 : eng.engine === 'piper' ? 22050 : 24000;
    meta.sampleRate = sr;
    const t0 = Date.now();
    let doneChars = 0;
    while (meta.next < meta.pageList.length) {
      if (job.cancelled) break;
      while (job.paused && !job.cancelled) await new Promise((r) => setTimeout(r, 300));
      if (job.cancelled) break;
      const p = meta.pageList[meta.next];
      const list = await App.pageSentences(p);
      const marks = [];
      const pcm = [];
      const mp3 = [];
      let t = 0;
      try {
        for (let i = 0; i < list.length; i++) {
          if (job.cancelled) break;
          while (job.paused && !job.cancelled) await new Promise((r) => setTimeout(r, 300));
          const text = App.spoken(list, i);
          if (!text.trim()) continue;
          marks.push({ t: meta.dur + t, p, i, text: list[i] });
          if (azure) {
            const key = eng.keyForVoice(text, azure);
            let blob = null;
            const have = await NV.clips.get(key);
            if (have && have.url) { try { blob = await (await fetch(have.url)).blob(); } catch (e) { blob = null; } }
            if (!blob) {
              if (eng.remaining() < text.length) {
                marks.length = Math.max(0, marks.length - 1);
                throw new Error('Limite gratuito di Azure di questo mese raggiunto (stima) a pagina ' + p + '.');
              }
              const c = await eng.synthVoice(text, azure);
              blob = c.blob;
              NV.clips.put(key, blob, blob.size * 8 / (KBPS * 1000)).catch(() => {});
            }
            const frames = await stripId3(blob);
            mp3.push(frames);
            t += frames.size * 8 / (KBPS * 1000);
          } else {
            const c = await eng.synth(text, 1);
            if (!c.blob) continue;
            const buf = await c.blob.arrayBuffer();
            const samples = new Int16Array(buf.slice(44));
            pcm.push(samples);
            t += samples.length / sr;
          }
          doneChars += text.length;
          updateProgress(p, i + 1, list.length, doneChars, Date.now() - t0);
        }
      } catch (err) {
        return endJob((azure ? 'Azure: ' : '') + (err && err.message ? err.message : 'errore nella creazione') + ' La creazione è in pausa: puoi riprenderla più tardi.', true);
      }
      if (job.cancelled) break;
      let blob;
      if (azure) blob = new Blob(mp3, { type: 'audio/mpeg' });
      else {
        const total = pcm.reduce((a, x) => a + x.length, 0);
        const all = new Int16Array(total);
        let off = 0;
        for (const x of pcm) { all.set(x, off); off += x.length; }
        if (!total) blob = new Blob([], { type: 'audio/mpeg' });
        else blob = new Blob([await encodeMp3(all, sr)], { type: 'audio/mpeg' });
      }
      try { await idb.put(segKey(meta.id, meta.segments), blob); } catch (err) {
        return endJob('Spazio sul telefono esaurito: libera spazio o elimina un audiolibro. La creazione è in pausa.', true);
      }
      meta.segments++;
      meta.pages.push({ p, start: meta.dur, dur: t, bytes: blob.size });
      meta.markers.push(...marks);
      meta.dur += t;
      meta.bytes += blob.size;
      meta.next++;
      await saveList();
      renderList();
    }
    if (job.cancelled) return endJob(meta.segments ? 'Creazione interrotta: la parte già pronta resta ascoltabile.' : 'Creazione annullata.', true);
    meta.status = 'done';
    await saveList();
    endJob('Audiolibro pronto ✓ ' + fmtLong(meta.dur) + ', ' + fmtMB(meta.bytes) + '.');
  }

  // Toglie l'eventuale etichetta ID3 iniziale: unendo più pezzi deve restare solo l'audio.
  async function stripId3(blob) {
    const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return blob;
    let size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    size += 10 + (head[5] & 0x10 ? 10 : 0);
    return blob.slice(size, blob.size, 'audio/mpeg');
  }

  function endJob(msg, partial) {
    if (job && job.meta && partial && job.meta.status !== 'done') job.meta.status = 'partial';
    saveList();
    job = null;
    keepAwake(false);
    ui.progress.classList.add('hidden');
    ui.start.classList.remove('hidden');
    App.toast(msg, 4500);
    ui.estimate.textContent = msg;
    renderList();
  }

  function showProgress() {
    ui.progress.classList.remove('hidden');
    ui.start.classList.add('hidden');
    ui.pauseBtn.textContent = 'Pausa';
    ui.bar.value = 0;
    ui.progText.textContent = 'Avvio la voce…';
  }

  function updateProgress(p, i, n, doneChars, ms) {
    const meta = job.meta;
    const pagesDone = meta.next + i / Math.max(1, n);
    const frac = pagesDone / meta.pageList.length;
    ui.bar.value = Math.round(frac * 1000);
    const msPerChar = ms / Math.max(1, doneChars);
    const avgPageChars = doneChars / Math.max(0.2, pagesDone - meta.startedAt);
    const left = (meta.pageList.length - pagesDone) * avgPageChars * msPerChar / 1000;
    ui.progText.textContent = 'Pagina ' + p + ' (' + (meta.next + 1) + ' di ' + meta.pageList.length + ') · ' + Math.round(frac * 100) + '%' +
      (isFinite(left) && pagesDone - meta.startedAt > 0.3 ? ' · circa ' + fmtLong(left) + ' rimasti' : '') + '. Tieni l\'app aperta.';
  }

  ui.start.addEventListener('click', async () => {
    if (!S.pdf || job) return;
    const pageList = pagesInRange();
    if (!pageList.length) return;
    NV.unlock();
    const vid = ui.voice.value;
    store.set('abVoice', vid);
    const vopt = voiceOptions().find((v) => v.id === vid);
    const meta = {
      id: 'ab' + Date.now().toString(36),
      bookKey: S.bookKey,
      title: S.bookName.replace(/\.pdf$/i, ''),
      voiceId: vid,
      voice: vopt ? vopt.label.replace(/\s*\(.*\)$/, '').replace(/^[^\p{L}]+/u, '') : vid,
      pageList,
      next: 0,
      startedAt: 0,
      segments: 0,
      pages: [],
      markers: [],
      dur: 0,
      bytes: 0,
      status: 'creating',
      created: Date.now(),
    };
    books.unshift(meta);
    await saveList();
    renderList();
    startJob(meta);
  });
  ui.pauseBtn.addEventListener('click', () => {
    if (!job) return;
    job.paused = !job.paused;
    ui.pauseBtn.textContent = job.paused ? 'Riprendi' : 'Pausa';
    keepAwake(!job.paused);
    if (job.paused) ui.progText.textContent = 'In pausa.';
  });
  ui.cancelBtn.addEventListener('click', () => { if (job) job.cancelled = true; });
  ui.all.addEventListener('click', () => { ui.from.value = 1; ui.to.value = S.pdf ? S.pdf.numPages : 1; updateEstimate(); });
  ui.thisPage.addEventListener('click', () => { ui.from.value = ui.to.value = S.page || 1; updateEstimate(); });
  ui.toEnd.addEventListener('click', () => { ui.from.value = S.page || 1; ui.to.value = S.pdf ? S.pdf.numPages : 1; updateEstimate(); });
  ui.fit.addEventListener('click', () => { ui.to.value = ui.fit.dataset.page; updateEstimate(); });
  [ui.from, ui.to, ui.voice].forEach((el) => el.addEventListener('change', updateEstimate));

  // ---------- Elenco ----------
  function renderList() {
    ui.list.innerHTML = '';
    if (!books.length) {
      const p = document.createElement('p');
      p.className = 'ab-empty';
      p.textContent = 'Non hai ancora creato audiolibri. Scegli voce e pagine qui sopra e premi «Crea audiolibro».';
      ui.list.appendChild(p);
    }
    for (const b of books) {
      const row = document.createElement('div');
      row.className = 'ab-item';
      const info = document.createElement('div');
      info.className = 'ab-info';
      const t = document.createElement('strong');
      t.textContent = b.title;
      const s = document.createElement('span');
      const range = b.pageList.length ? 'pagine ' + b.pageList[0] + '–' + b.pageList[b.pageList.length - 1] : '';
      const state = job && job.meta === b ? ' · in creazione…' : b.status === 'done' ? '' : ' · incompleto (' + b.next + ' di ' + b.pageList.length + ' pagine)';
      s.textContent = b.voice + ' · ' + range + ' · ' + fmtLong(b.dur) + ' · ' + fmtMB(b.bytes) + state;
      info.append(t, s);
      const btns = document.createElement('div');
      btns.className = 'ab-btns';
      const mk = (label, cls, fn, title) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn ' + cls; x.textContent = label; if (title) x.setAttribute('aria-label', title); x.addEventListener('click', fn); btns.appendChild(x); return x; };
      if (b.segments) mk('▶ Ascolta', 'btn-primary', () => openPlayer(b));
      if (b.status !== 'done' && !(job && job.meta === b)) {
        mk('Continua creazione', '', () => {
          if (job) { App.toast('C\'è già un audiolibro in creazione.'); return; }
          if (b.bookKey !== S.bookKey) { App.toast('Apri prima il libro «' + b.title + '» per continuare.'); return; }
          b.status = 'creating';
          b.startedAt = b.next;
          renderList();
          startJob(b);
        });
      }
      if (b.segments) mk('⬇️ Scarica', '', () => download(b), 'Scarica in MP3');
      const del = mk('🗑', 'ab-del', () => {
        if (job && job.meta === b) { App.toast('Annulla prima la creazione.'); return; }
        if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Elimina?'; setTimeout(() => { del.dataset.sure = ''; del.textContent = '🗑'; }, 3000); return; }
        remove(b);
      }, 'Elimina audiolibro');
      row.append(info, btns);
      ui.list.appendChild(row);
    }
    updateStorage();
  }

  async function updateStorage() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return;
      const e = await navigator.storage.estimate();
      const used = books.reduce((a, b) => a + b.bytes, 0);
      ui.storage.textContent = 'Audiolibri: ' + fmtMB(used) + ' · spazio libero per l\'app: circa ' + fmtMB(Math.max(0, (e.quota || 0) - (e.usage || 0))) + '.';
    } catch (e) { /* ignora */ }
  }

  async function remove(b) {
    if (player.book === b) closePlayer();
    for (let k = 0; k < b.segments; k++) { try { await idb.del(segKey(b.id, k)); } catch (e) { /* ignora */ } }
    books = books.filter((x) => x !== b);
    await saveList();
    store.set('abpos:' + b.id, null);
    renderList();
    App.toast('Audiolibro eliminato.');
  }

  async function blobOf(b) {
    const parts = [];
    for (let k = 0; k < b.segments; k++) {
      const s = await idb.get(segKey(b.id, k));
      if (s) parts.push(s);
    }
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  // Nell'anteprima su claude.ai i file MP3 non si possono scaricare.
  let inPlatform = false;
  (async () => { try { if (window.claude && typeof window.claude.use === 'function') inPlatform = !!(await window.claude.use('downloads')); } catch (e) { /* ignora */ } })();

  async function download(b) {
    if (inPlatform) { App.toast('Qui non si possono scaricare file MP3: apri l\'app da GitHub Pages (manuel99bol-ux.github.io/Libro).', 5000); return; }
    App.showLoading('Preparo il file MP3…');
    const blob = await blobOf(b);
    App.hideLoading();
    const name = b.title + ' - audiolibro (' + b.voice + ').mp3';
    const file = new File([blob], name, { type: 'audio/mpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|ipod|android/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  // ---------- Lettore ----------
  const player = { audio: new Audio(), book: null, url: null };
  player.audio.preload = 'auto';
  player.audio.setAttribute('playsinline', '');

  async function openPlayer(b) {
    if (S.mode === 'playing') App.pause();
    if (player.book !== b) {
      player.audio.pause();
      if (player.url) URL.revokeObjectURL(player.url);
      App.showLoading('Apro l\'audiolibro…');
      const blob = await blobOf(b);
      App.hideLoading();
      player.url = URL.createObjectURL(blob);
      player.book = b;
      player.audio.src = player.url;
      const pos = store.get('abpos:' + b.id, 0);
      player.audio.addEventListener('loadedmetadata', function once() {
        player.audio.removeEventListener('loadedmetadata', once);
        if (pos && pos < (player.audio.duration || b.dur) - 2) player.audio.currentTime = pos;
      });
    }
    ui.player.classList.remove('hidden');
    ui.pTitle.textContent = b.title;
    ui.pSub.textContent = b.voice + (b.status === 'done' ? '' : ' · incompleto');
    ui.pTotal.textContent = fmtTime(b.dur);
    ui.pRate.value = String(store.get('abRate', '1'));
    player.audio.playbackRate = parseFloat(ui.pRate.value) || 1;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignora */ }
    setupMediaSession(b);
    play();
    ui.player.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function closePlayer() {
    player.audio.pause();
    ui.player.classList.add('hidden');
  }
  function play() {
    const p = player.audio.play();
    if (p && p.catch) p.catch(() => {});
  }
  function currentMarker() {
    const m = player.book ? player.book.markers : [];
    const t = player.audio.currentTime;
    let lo = 0, hi = m.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (m[mid].t <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? m[ans] : null;
  }
  function seekPage(dir) {
    const b = player.book;
    if (!b) return;
    const t = player.audio.currentTime;
    const pages = b.pages;
    let idx = pages.findIndex((pg) => pg.start + pg.dur > t + 0.1);
    if (idx < 0) idx = pages.length - 1;
    if (dir < 0 && t - pages[idx].start > 3) { player.audio.currentTime = pages[idx].start; return; }
    const j = Math.min(pages.length - 1, Math.max(0, idx + dir));
    player.audio.currentTime = pages[j].start;
  }
  let lastSave = 0;
  player.audio.addEventListener('timeupdate', () => {
    const b = player.book;
    if (!b) return;
    const t = player.audio.currentTime;
    if (!ui.pSeek.matches(':active')) ui.pSeek.value = String(Math.round((t / Math.max(1, b.dur)) * 1000));
    ui.pTime.textContent = fmtTime(t);
    const m = currentMarker();
    if (m && ui.pText.dataset.k !== m.p + ':' + m.i) {
      ui.pText.dataset.k = m.p + ':' + m.i;
      ui.pText.textContent = m.text;
      ui.pSub.textContent = b.voice + ' · pagina ' + m.p;
    }
    if (Date.now() - lastSave > 3000) { lastSave = Date.now(); store.set('abpos:' + b.id, t); }
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(player.audio.duration)) {
      try { navigator.mediaSession.setPositionState({ duration: player.audio.duration, position: Math.min(t, player.audio.duration), playbackRate: player.audio.playbackRate }); } catch (e) { /* ignora */ }
    }
  });
  const syncPlay = () => { ui.pPlay.textContent = player.audio.paused ? '▶' : '⏸'; ui.pPlay.setAttribute('aria-label', player.audio.paused ? 'Ascolta' : 'Pausa'); };
  player.audio.addEventListener('play', syncPlay);
  player.audio.addEventListener('pause', () => { syncPlay(); if (player.book) store.set('abpos:' + player.book.id, player.audio.currentTime); });
  player.audio.addEventListener('ended', () => { syncPlay(); if (player.book) store.set('abpos:' + player.book.id, 0); });

  ui.pPlay.addEventListener('click', () => { if (player.audio.paused) play(); else player.audio.pause(); });
  ui.pBack.addEventListener('click', () => { player.audio.currentTime = Math.max(0, player.audio.currentTime - 15); });
  ui.pFwd.addEventListener('click', () => { player.audio.currentTime = Math.min(player.audio.duration || 0, player.audio.currentTime + 30); });
  ui.pPrev.addEventListener('click', () => seekPage(-1));
  ui.pNext.addEventListener('click', () => seekPage(1));
  ui.pSeek.addEventListener('input', () => { if (player.book) player.audio.currentTime = (parseInt(ui.pSeek.value, 10) / 1000) * player.book.dur; });
  ui.pRate.addEventListener('change', () => { player.audio.playbackRate = parseFloat(ui.pRate.value) || 1; store.set('abRate', ui.pRate.value); });
  ui.pClose.addEventListener('click', closePlayer);

  // Comandi nel blocco schermo e nel Centro di controllo.
  function setupMediaSession(b) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: b.title,
        artist: 'Letto da ' + b.voice,
        album: 'Lettore di Libri',
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', play);
      ms.setActionHandler('pause', () => player.audio.pause());
      ms.setActionHandler('seekbackward', (d) => { player.audio.currentTime = Math.max(0, player.audio.currentTime - ((d && d.seekOffset) || 15)); });
      ms.setActionHandler('seekforward', (d) => { player.audio.currentTime = player.audio.currentTime + ((d && d.seekOffset) || 30); });
      ms.setActionHandler('previoustrack', () => seekPage(-1));
      ms.setActionHandler('nexttrack', () => seekPage(1));
      try { ms.setActionHandler('seekto', (d) => { if (d && d.seekTime != null) player.audio.currentTime = d.seekTime; }); } catch (e) { /* non supportato */ }
    } catch (e) { /* ignora */ }
  }

  // ---------- Collegamenti con il resto dell'app ----------
  function refreshBook() {
    ui.book.textContent = S.pdf ? '«' + S.bookName.replace(/\.pdf$/i, '') + '»' : 'Apri prima un libro.';
    if (S.pdf) {
      ui.from.max = ui.to.max = S.pdf.numPages;
      ui.from.value = S.page || 1;
      ui.to.value = S.pdf.numPages;
    }
    fillVoices();
    updateEstimate();
  }
  App.events.addEventListener('bookloaded', refreshBook);
  App.events.addEventListener('viewchange', (e) => {
    if (e.detail.view === 'viewAudio') { fillVoices(); if (!job) updateEstimate(); updateStorage(); }
  });
  // Se il telefono era stato chiuso durante una creazione, resta «incompleto»: si può continuare.
  loadList().then((list) => {
    list.forEach((b) => { if (b.status === 'creating') b.status = 'partial'; });
    renderList();
  });
  App.audiobook = { books: () => books, openPlayer };
})();
