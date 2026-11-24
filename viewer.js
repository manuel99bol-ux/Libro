/* Lettore di Libri — scheda "Pagine": visualizzazione completa del PDF,
   annotazioni (penna, evidenziatore, testo, gomma), rotazione ed eliminazione
   delle pagine, salvataggio di un nuovo PDF con pdf-lib. */
(function () {
  'use strict';

  const App = window.App;
  const S = App.state;
  const $ = (id) => document.getElementById(id);
  const ui = {
    view: $('viewPages'),
    scroll: $('pagesScroll'),
    inner: $('pagesInner'),
    bar: $('pagesBar'),
    viewTools: $('viewTools'),
    editTools: $('editTools'),
    zoomIn: $('zoomIn'),
    zoomOut: $('zoomOut'),
    zoomLabel: $('zoomLabel'),
    miniPlay: $('miniPlay'),
    miniInfo: $('miniInfo'),
    editToggle: $('editToggle'),
    editDone: $('editDone'),
    undoBtn: $('undoBtn'),
    saveBtn: $('saveBtn'),
    swatches: $('swatches'),
    textDialog: $('textDialog'),
    textDialogTitle: $('textDialogTitle'),
    textValue: $('textValue'),
    textSize: $('textSize'),
    textDelete: $('textDelete'),
    saveDialog: $('saveDialog'),
    saveInfo: $('saveInfo'),
    shareBtn: $('shareBtn'),
  };

  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 4;
  const COLORS = ['#d32f2f', '#1565c0', '#2e7d32', '#000000', '#ffd600', '#ff6d00'];
  const PEN_WIDTH = 2.5;   // punti PDF
  const HL_WIDTH = 14;     // punti PDF
  const HL_OPACITY = 0.45;
  const LINE_HEIGHT = 1.2;

  const V = {
    zoom: clampZoom(Number(App.store.get('zoom', 1)) || 1),
    editing: false,
    tool: 'pen',
    colors: Object.assign({ pen: '#d32f2f', hl: '#ffd600', text: '#1565c0' }, App.store.get('colors', {})),
    pages: [],
    built: false,
    needsScroll: false,
    visible: new Set(),
    undo: [],
    observer: null,
    defaultSize: null,
    drag: null,
    lastWidth: 0,
  };

  function clampZoom(z) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); }
  const edits = () => App.edits;
  const anns = (n) => (edits().ann[n] || (edits().ann[n] = []));

  // ---------- Geometria ----------
  // Le annotazioni sono salvate in coordinate normalizzate (0..1) della pagina NON ruotata,
  // con l'origine in alto a sinistra. Così restano corrette con qualsiasi zoom o rotazione.
  function toDisp(u, v, r) {
    switch (r) {
      case 90: return [1 - v, u];
      case 180: return [1 - u, 1 - v];
      case 270: return [v, 1 - u];
      default: return [u, v];
    }
  }
  function fromDisp(x, y, r) {
    switch (r) {
      case 90: return [y, 1 - x];
      case 180: return [1 - x, 1 - y];
      case 270: return [1 - y, x];
      default: return [x, y];
    }
  }
  function info(n) { return (V.pages[n] && V.pages[n].size) || V.defaultSize; }
  function rotOf(n) { return (((info(n).rotate0 || 0) + (edits().rot[n] || 0)) % 360 + 360) % 360; }
  function dispPt(n) {
    const i = info(n);
    return rotOf(n) % 180 ? { w: i.h, h: i.w } : { w: i.w, h: i.h };
  }
  function baseWidth() { return Math.max(200, Math.min(ui.scroll.clientWidth - 16, 900)); }
  function cssSize(n) {
    const d = dispPt(n);
    const w = Math.round(baseWidth() * V.zoom);
    return { w, h: Math.round(w * d.h / d.w) };
  }

  // ---------- Costruzione della vista ----------
  async function build() {
    if (!S.pdf) return;
    if (V.observer) V.observer.disconnect();
    V.pages.forEach((p) => p && freePage(p));
    ui.inner.innerHTML = '';
    V.pages = [];
    V.visible.clear();
    V.undo = [];
    updateUndo();

    const pdf = S.pdf;
    const first = await pdf.getPage(1);
    if (pdf !== S.pdf) return;
    const vp = first.getViewport({ scale: 1, rotation: 0 });
    V.defaultSize = { w: vp.width, h: vp.height, rotate0: first.rotate || 0 };

    const frag = document.createDocumentFragment();
    for (let n = 1; n <= pdf.numPages; n++) {
      const box = document.createElement('div');
      box.className = 'pagebox';
      box.dataset.n = n;
      box.innerHTML =
        '<div class="pagehead"><span class="pnum">Pagina ' + n + '</span><span class="pbtns">' +
        '<button type="button" data-act="read" aria-label="Leggi da pagina ' + n + '">🔊 Leggi</button>' +
        '<button type="button" data-act="rotate" class="edit-only" aria-label="Ruota pagina ' + n + '">↻ Ruota</button>' +
        '<button type="button" data-act="delete" class="edit-only" aria-label="Elimina pagina ' + n + '">🗑</button>' +
        '</span></div>' +
        '<div class="pagearea" data-n="' + n + '">' +
        '<div class="spinner">Pagina ' + n + '…</div>' +
        '<canvas class="pdf"></canvas><canvas class="ann"></canvas>' +
        '<div class="deleted">Pagina eliminata<button type="button" data-act="restore">Ripristina</button></div>' +
        '</div>';
      frag.appendChild(box);
      const area = box.querySelector('.pagearea');
      V.pages[n] = {
        n, box, area,
        pdfCanvas: area.querySelector('canvas.pdf'),
        annCanvas: area.querySelector('canvas.ann'),
        spinner: area.querySelector('.spinner'),
        size: n === 1 ? V.defaultSize : null,
        token: 0,
        task: null,
        renderedKey: null,
      };
    }
    ui.inner.appendChild(frag);
    V.observer = new IntersectionObserver(onIntersect, { root: ui.scroll, rootMargin: '900px 0px' });
    V.built = true;
    layoutAll();
    for (let n = 1; n <= pdf.numPages; n++) {
      updateDeleted(n);
      V.observer.observe(V.pages[n].area);
    }
    markReading();
  }

  function layoutPage(n) {
    const p = V.pages[n];
    const { w, h } = cssSize(n);
    p.box.style.width = w + 'px';
    p.area.style.height = h + 'px';
    return w;
  }

  function layoutAll() {
    if (!V.built) return;
    V.lastWidth = ui.scroll.clientWidth;
    let maxW = 0;
    for (let n = 1; n < V.pages.length; n++) maxW = Math.max(maxW, layoutPage(n));
    ui.inner.style.width = maxW + 16 > ui.scroll.clientWidth ? (maxW + 16) + 'px' : '';
    ui.zoomLabel.textContent = Math.round(V.zoom * 100) + '%';
    V.visible.forEach((n) => renderPage(n));
  }

  function onIntersect(entries) {
    for (const e of entries) {
      const n = Number(e.target.dataset.n);
      if (e.isIntersecting) { V.visible.add(n); renderPage(n); }
      else { V.visible.delete(n); freePage(V.pages[n]); }
    }
  }

  function freePage(p) {
    if (!p) return;
    p.token++;
    if (p.task) { try { p.task.cancel(); } catch (e) { /* ignora */ } p.task = null; }
    p.pdfCanvas.width = p.pdfCanvas.height = 0;
    p.annCanvas.width = p.annCanvas.height = 0;
    p.renderedKey = null;
    p.spinner.classList.remove('hidden');
  }

  async function renderPage(n) {
    const p = V.pages[n];
    if (!p || !S.pdf) return;
    const token = ++p.token;
    const page = await S.pdf.getPage(n);
    if (token !== p.token) return;
    if (!p.size) {
      const vp0 = page.getViewport({ scale: 1, rotation: 0 });
      p.size = { w: vp0.width, h: vp0.height, rotate0: page.rotate || 0 };
      const d = V.defaultSize;
      if (p.size.w !== d.w || p.size.h !== d.h || p.size.rotate0 !== d.rotate0) layoutPage(n);
    }
    const { w, h } = cssSize(n);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxPixels = 8e6; // limite di memoria (soprattutto per iPhone)
    const factor = Math.min(dpr, Math.sqrt(maxPixels / (w * h)));
    const r = rotOf(n);
    const key = w + 'x' + h + '@' + factor.toFixed(3) + 'r' + r;
    if (p.renderedKey === key) { drawAnn(n); return; }

    const d = dispPt(n);
    const viewport = page.getViewport({ scale: (w / d.w) * factor, rotation: r });
    // Disegna su una tela fuori schermo per evitare sfarfallii, poi copia.
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(viewport.width));
    off.height = Math.max(1, Math.floor(viewport.height));
    if (p.task) { try { p.task.cancel(); } catch (e) { /* ignora */ } }
    const task = page.render({ canvasContext: off.getContext('2d'), viewport });
    p.task = task;
    try {
      await task.promise;
    } catch (err) {
      if (p.task === task) p.task = null;
      return; // annullato
    }
    if (p.task === task) p.task = null;
    if (token !== p.token) return;
    p.pdfCanvas.width = off.width;
    p.pdfCanvas.height = off.height;
    p.pdfCanvas.getContext('2d').drawImage(off, 0, 0);
    p.annCanvas.width = off.width;
    p.annCanvas.height = off.height;
    p.renderedKey = key;
    p.spinner.classList.add('hidden');
    drawAnn(n);
  }

  // ---------- Disegno delle annotazioni ----------
  function drawAnn(n, extra) {
    const p = V.pages[n];
    if (!p || !p.annCanvas.width) return;
    const c = p.annCanvas;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const r = rotOf(n);
    const k = c.width / dispPt(n).w; // pixel per punto PDF
    const list = (edits().ann[n] || []).concat(extra ? [extra] : []);
    for (const a of list) drawOne(ctx, a, r, c.width, c.height, k);
  }

  function drawOne(ctx, a, r, W, H, k) {
    ctx.save();
    if (a.type === 'stroke') {
      ctx.globalAlpha = a.tool === 'hl' ? HL_OPACITY : 1;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width * k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      a.pts.forEach((pt, i) => {
        const [x, y] = toDisp(pt[0], pt[1], r);
        if (i === 0) ctx.moveTo(x * W, y * H); else ctx.lineTo(x * W, y * H);
      });
      if (a.pts.length === 1) {
        const [x, y] = toDisp(a.pts[0][0], a.pts[0][1], r);
        ctx.lineTo(x * W + 0.01, y * H);
      }
      ctx.stroke();
    } else if (a.type === 'text') {
      ctx.fillStyle = a.color;
      ctx.font = (a.size * k) + 'px Helvetica, Arial, sans-serif';
      ctx.textBaseline = 'alphabetic';
      const [x, y] = toDisp(a.u, a.v, r);
      a.text.split('\n').forEach((line, i) => {
        ctx.fillText(line, x * W, y * H + i * LINE_HEIGHT * a.size * k);
      });
    }
    ctx.restore();
  }

  // Rettangolo (in pixel della tela) occupato da un testo, per toccarlo o cancellarlo.
  function textBox(n, a) {
    const p = V.pages[n];
    const c = p.annCanvas;
    const ctx = c.getContext('2d');
    const k = c.width / dispPt(n).w;
    const [x, y] = toDisp(a.u, a.v, rotOf(n));
    ctx.font = (a.size * k) + 'px Helvetica, Arial, sans-serif';
    const lines = a.text.split('\n');
    const width = Math.max.apply(null, lines.map((l) => ctx.measureText(l).width));
    const size = a.size * k;
    return { x0: x * c.width, y0: y * c.height - size, x1: x * c.width + width, y1: y * c.height + (lines.length - 1) * LINE_HEIGHT * size + size * 0.3 };
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // Trova l'annotazione sotto il punto (px,py in pixel della tela).
  function hitTest(n, px, py, radius, onlyText) {
    const p = V.pages[n];
    const c = p.annCanvas;
    const r = rotOf(n);
    const k = c.width / dispPt(n).w;
    const list = edits().ann[n] || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.type === 'text') {
        const b = textBox(n, a);
        if (px >= b.x0 - radius && px <= b.x1 + radius && py >= b.y0 - radius && py <= b.y1 + radius) return i;
      } else if (!onlyText) {
        const tol = radius + (a.width * k) / 2;
        const pts = a.pts.map((pt) => { const d = toDisp(pt[0], pt[1], r); return [d[0] * c.width, d[1] * c.height]; });
        for (let j = 0; j < pts.length; j++) {
          const q = pts[Math.min(j + 1, pts.length - 1)];
          if (distToSeg(px, py, pts[j][0], pts[j][1], q[0], q[1]) <= tol) return i;
        }
      }
    }
    return -1;
  }

  // ---------- Modifiche e "annulla" ----------
  function pushUndo() {
    V.undo.push(JSON.stringify(edits()));
    if (V.undo.length > 60) V.undo.shift();
    updateUndo();
  }
  function updateUndo() { ui.undoBtn.disabled = V.undo.length === 0; }

  function editsChanged() {
    App.saveEdits();
    App.el.deletedNote.classList.toggle('hidden', !edits().del[S.page]);
  }

  function undo() {
    if (!V.undo.length) return;
    App.edits = JSON.parse(V.undo.pop());
    updateUndo();
    editsChanged();
    for (let n = 1; n < V.pages.length; n++) updateDeleted(n);
    layoutAll(); // ridisegna le pagine visibili (anche se è cambiata la rotazione)
    App.toast('Modifica annullata');
  }

  function updateDeleted(n) {
    V.pages[n].box.classList.toggle('is-deleted', !!edits().del[n]);
  }

  function rotatePage(n) {
    pushUndo();
    edits().rot[n] = ((edits().rot[n] || 0) + 90) % 360;
    editsChanged();
    layoutPage(n);
    renderPage(n);
  }

  function deletePage(n, del) {
    pushUndo();
    if (del) edits().del[n] = true; else delete edits().del[n];
    editsChanged();
    updateDeleted(n);
    if (del) App.toast('Pagina ' + n + ' segnata come eliminata. Sarà tolta quando salvi il PDF.', 3500);
  }

  // ---------- Strumenti ----------
  function renderSwatches() {
    ui.swatches.innerHTML = '';
    const colorTool = V.tool === 'pen' || V.tool === 'hl' || V.tool === 'text';
    ui.swatches.style.visibility = colorTool ? 'visible' : 'hidden';
    if (!colorTool) return;
    // Sugli schermi stretti mostriamo meno colori.
    const list = window.innerWidth < 380 ? COLORS.slice(0, 5) : COLORS;
    list.forEach((col) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = col;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Colore ' + col);
      b.setAttribute('aria-checked', String(V.colors[V.tool] === col));
      b.addEventListener('click', () => {
        V.colors[V.tool] = col;
        App.store.set('colors', V.colors);
        renderSwatches();
      });
      ui.swatches.appendChild(b);
    });
  }

  function setTool(tool) {
    V.tool = tool;
    App.store.set('tool', tool);
    ui.editTools.querySelectorAll('[data-tool]').forEach((b) => {
      const on = b.dataset.tool === tool;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    ui.view.classList.toggle('tool-draw', V.editing && tool !== 'pan');
    renderSwatches();
  }

  function setEditing(on) {
    V.editing = on;
    ui.view.classList.toggle('editing', on);
    ui.viewTools.classList.toggle('hidden', on);
    ui.editTools.classList.toggle('hidden', !on);
    ui.editToggle.setAttribute('aria-pressed', String(on));
    setTool(V.tool);
    if (on) App.toast('Con «Scorri» muovi le pagine', 2000);
  }

  // ---------- Input da tocco / mouse / penna ----------
  function canvasPoint(e, n) {
    const c = V.pages[n].annCanvas;
    const rect = c.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const [u, v] = fromDisp(x, y, rotOf(n));
    return { x, y, u: Math.round(u * 1e4) / 1e4, v: Math.round(v * 1e4) / 1e4, px: x * c.width, py: y * c.height, scale: c.width / rect.width };
  }

  let rafPending = false;
  function scheduleDraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const d = V.drag;
      if (d && d.stroke) drawAnn(d.n, d.stroke);
    });
  }

  function eraseAt(d, e) {
    const pt = canvasPoint(e, d.n);
    const i = hitTest(d.n, pt.px, pt.py, 12 * pt.scale, false);
    if (i >= 0) {
      if (!d.changed) { pushUndo(); d.changed = true; }
      anns(d.n).splice(i, 1);
      drawAnn(d.n);
    }
  }

  ui.inner.addEventListener('pointerdown', (e) => {
    const c = e.target.closest && e.target.closest('canvas.ann');
    if (!c || !V.editing || V.tool === 'pan') return;
    if (V.drag) { // secondo dito: annulla il tratto (probabile gesto di zoom)
      const n = V.drag.n;
      V.drag = null;
      drawAnn(n);
      return;
    }
    const n = Number(c.parentElement.dataset.n);
    if (edits().del[n]) return;
    e.preventDefault();
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
    const pt = canvasPoint(e, n);
    const d = { n, id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY };
    if (V.tool === 'pen' || V.tool === 'hl') {
      d.stroke = { type: 'stroke', tool: V.tool, color: V.colors[V.tool], width: V.tool === 'hl' ? HL_WIDTH : PEN_WIDTH, pts: [[pt.u, pt.v]] };
      scheduleDraw();
    } else if (V.tool === 'eraser') {
      d.changed = false;
      eraseAt(d, e);
    }
    V.drag = d;
  });

  ui.inner.addEventListener('pointermove', (e) => {
    const d = V.drag;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (list.length ? list : [e])) {
      if (Math.hypot(ev.clientX - d.lastX, ev.clientY - d.lastY) < 1.5) continue;
      d.lastX = ev.clientX; d.lastY = ev.clientY;
      if (d.stroke) {
        const pt = canvasPoint(ev, d.n);
        d.stroke.pts.push([pt.u, pt.v]);
      } else if (V.tool === 'eraser') {
        eraseAt(d, ev);
      }
    }
    if (d.stroke) scheduleDraw();
  });

  function endDrag(e, cancelled) {
    const d = V.drag;
    if (!d || e.pointerId !== d.id) return;
    V.drag = null;
    if (cancelled) { drawAnn(d.n); return; }
    if (d.stroke) {
      pushUndo();
      anns(d.n).push(d.stroke);
      editsChanged();
      drawAnn(d.n);
    } else if (V.tool === 'eraser') {
      if (d.changed) editsChanged();
    } else if (V.tool === 'text') {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 12) return; // era un trascinamento
      const pt = canvasPoint(e, d.n);
      const i = hitTest(d.n, pt.px, pt.py, 8 * pt.scale, true);
      if (i >= 0) openTextDialog(d.n, null, i);
      else openTextDialog(d.n, pt, -1);
    }
  }
  ui.inner.addEventListener('pointerup', (e) => endDrag(e, false));
  ui.inner.addEventListener('pointercancel', (e) => endDrag(e, true));

  // ---------- Testo ----------
  let textTarget = null;
  function openTextDialog(n, pt, index) {
    const existing = index >= 0 ? anns(n)[index] : null;
    textTarget = { n, pt, index };
    ui.textDialogTitle.textContent = existing ? 'Modifica testo' : 'Aggiungi testo';
    ui.textValue.value = existing ? existing.text : '';
    ui.textSize.value = String(existing ? existing.size : App.store.get('textSize', 16));
    ui.textDelete.classList.toggle('hidden', !existing);
    ui.textDialog.returnValue = '';
    ui.textDialog.showModal();
    setTimeout(() => ui.textValue.focus(), 50);
  }

  ui.textDialog.addEventListener('close', () => {
    const t = textTarget;
    textTarget = null;
    if (!t) return;
    const action = ui.textDialog.returnValue;
    const text = ui.textValue.value.replace(/\s+$/, '');
    const size = Number(ui.textSize.value) || 16;
    App.store.set('textSize', size);
    const list = anns(t.n);
    if (action === 'delete' && t.index >= 0) {
      pushUndo();
      list.splice(t.index, 1);
    } else if (action === 'ok' && text.trim()) {
      pushUndo();
      if (t.index >= 0) {
        Object.assign(list[t.index], { text, size, color: V.colors.text });
      } else {
        // Il tocco indica l'angolo in alto a sinistra: calcoliamo la linea di base.
        const r = rotOf(t.n);
        const yb = t.pt.y + (size * 0.9) / dispPt(t.n).h;
        const [u, v] = fromDisp(t.pt.x, Math.min(1, yb), r);
        list.push({ type: 'text', u, v, text, size, color: V.colors.text });
      }
    } else {
      return;
    }
    editsChanged();
    drawAnn(t.n);
  });

  // ---------- Salvataggio del PDF modificato ----------
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) || [0, '00', '00', '00'];
    return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
  }

  let lastBlob = null;
  let lastName = '';

  async function exportPdf() {
    if (!S.pdf) return;
    const total = S.pdf.numPages;
    const kept = [];
    for (let n = 1; n <= total; n++) if (!edits().del[n]) kept.push(n);
    if (!kept.length) { alert('Hai eliminato tutte le pagine: ripristinane almeno una.'); return; }

    App.showLoading('Creo il PDF modificato…');
    try {
      if (!window.PDFLib) await App.loadScript('lib/pdf-lib.min.js');
      const { PDFDocument, StandardFonts, degrees, LineCapStyle, BlendMode } = PDFLib;
      const doc = await PDFDocument.load(S.bytes, { ignoreEncryption: true, updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const encCache = new Map();
      const safeText = (s) => Array.from(s).map((ch) => {
        if (!encCache.has(ch)) {
          let ok = true;
          try { font.encodeText(ch); } catch (e) { ok = false; }
          encCache.set(ch, ok);
        }
        return encCache.get(ch) ? ch : '?';
      }).join('');

      const pages = doc.getPages();
      for (let n = 1; n <= total; n++) {
        const page = pages[n - 1];
        if (!page) continue;
        const cb = page.getCropBox();
        const extra = edits().rot[n] || 0;
        const base = ((page.getRotation().angle || 0) % 360 + 360) % 360;
        const totalRot = (base + extra) % 360;
        if (extra) page.setRotation(degrees(totalRot));
        const dispH = totalRot % 180 ? cb.width : cb.height;

        for (const a of (edits().ann[n] || [])) {
          if (a.type === 'stroke' && a.pts.length) {
            const pts = a.pts.length === 1 ? [a.pts[0], [a.pts[0][0] + 0.0005, a.pts[0][1]]] : a.pts;
            const path = pts.map((pt, i) => (i ? 'L' : 'M') + (pt[0] * cb.width).toFixed(2) + ' ' + (pt[1] * cb.height).toFixed(2)).join(' ');
            const opts = {
              x: cb.x,
              y: cb.y + cb.height,
              borderColor: hexToRgb(a.color),
              borderWidth: a.width,
              borderLineCap: LineCapStyle.Round,
            };
            if (a.tool === 'hl') { opts.borderOpacity = HL_OPACITY; opts.blendMode = BlendMode.Multiply; }
            page.drawSvgPath(path, opts);
          } else if (a.type === 'text') {
            const [x, y] = toDisp(a.u, a.v, totalRot);
            a.text.split('\n').forEach((line, i) => {
              if (!line) return;
              const [u, v] = fromDisp(x, y + (i * LINE_HEIGHT * a.size) / dispH, totalRot);
              page.drawText(safeText(line), {
                x: cb.x + u * cb.width,
                y: cb.y + (1 - v) * cb.height,
                size: a.size,
                font,
                color: hexToRgb(a.color),
                rotate: degrees(totalRot),
              });
            });
          }
        }
      }
      for (let n = total; n >= 1; n--) if (edits().del[n]) doc.removePage(n - 1);

      const bytes = await doc.save();
      lastBlob = new Blob([bytes], { type: 'application/pdf' });
      lastName = S.bookName.replace(/\.pdf$/i, '') + ' (modificato).pdf';
      App.hideLoading();
      const mb = (lastBlob.size / 1048576).toFixed(1);
      ui.saveInfo.textContent = '«' + lastName + '» — ' + kept.length + ' pagine, ' + mb + ' MB. Il file originale non viene toccato.';
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([lastBlob], lastName, { type: 'application/pdf' })] }));
      ui.shareBtn.classList.toggle('hidden', !canShare);
      ui.saveDialog.returnValue = '';
      ui.saveDialog.showModal();
    } catch (err) {
      App.hideLoading();
      console.error(err);
      alert('Non è stato possibile creare il PDF modificato. Il file potrebbe essere protetto.');
    }
  }

  function downloadBlob() {
    const url = URL.createObjectURL(lastBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = lastName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  ui.saveDialog.addEventListener('close', () => {
    if (!lastBlob) return;
    const v = ui.saveDialog.returnValue;
    if (v === 'download') downloadBlob();
    else if (v === 'share') {
      const file = new File([lastBlob], lastName, { type: 'application/pdf' });
      navigator.share({ files: [file], title: lastName }).catch((err) => {
        if (err && err.name !== 'AbortError') downloadBlob();
      });
    }
  });

  // ---------- Zoom ----------
  function setZoom(z, anchor) {
    z = clampZoom(z);
    if (Math.abs(z - V.zoom) < 0.001) return;
    const sc = ui.scroll;
    const rect = sc.getBoundingClientRect();
    const ax = anchor ? anchor.x - rect.left : sc.clientWidth / 2;
    const ay = anchor ? anchor.y - rect.top : sc.clientHeight / 2;
    const cx = sc.scrollLeft + ax;
    const cy = sc.scrollTop + ay;
    const ratio = z / V.zoom;
    V.zoom = z;
    App.store.set('zoom', z);
    layoutAll();
    sc.scrollLeft = cx * ratio - ax;
    sc.scrollTop = cy * ratio - ay;
  }
  function zoomStep(dir) {
    const next = dir > 0
      ? ZOOM_STEPS.find((s) => s > V.zoom + 0.01) || ZOOM_MAX
      : ZOOM_STEPS.slice().reverse().find((s) => s < V.zoom - 0.01) || ZOOM_MIN;
    setZoom(next);
  }

  // Pizzico con due dita: anteprima con transform, poi ridisegno alla nuova scala.
  let pinch = null;
  const tdist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const tmid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  ui.scroll.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const mid = tmid(e.touches);
      const rect = ui.scroll.getBoundingClientRect();
      pinch = { d0: tdist(e.touches), mid, ratio: 1 };
      ui.inner.style.transformOrigin =
        (ui.scroll.scrollLeft + mid.x - rect.left - ui.inner.offsetLeft) + 'px ' +
        (ui.scroll.scrollTop + mid.y - rect.top - ui.inner.offsetTop) + 'px';
    }
  }, { passive: true });
  ui.scroll.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    pinch.ratio = Math.min(ZOOM_MAX / V.zoom, Math.max(ZOOM_MIN / V.zoom, tdist(e.touches) / pinch.d0));
    ui.inner.style.transform = 'scale(' + pinch.ratio + ')';
    ui.zoomLabel.textContent = Math.round(V.zoom * pinch.ratio * 100) + '%';
  }, { passive: false });
  const endPinch = (e) => {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch;
    pinch = null;
    ui.inner.style.transform = '';
    setZoom(V.zoom * p.ratio, p.mid);
  };
  ui.scroll.addEventListener('touchend', endPinch);
  ui.scroll.addEventListener('touchcancel', endPinch);

  // ---------- Lettura ----------
  function markReading() {
    if (!V.built) return;
    V.pages.forEach((p) => p && p.box.classList.toggle('reading', p.n === S.page && S.mode !== 'stopped'));
    ui.miniInfo.textContent = 'Pag. ' + S.page + '/' + (S.pdf ? S.pdf.numPages : '–');
  }

  function scrollToPage(n) {
    const p = V.pages[n];
    if (p) ui.scroll.scrollTop = p.box.offsetTop - 6;
  }

  // ---------- Eventi ----------
  ui.inner.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const n = Number(b.closest('.pagebox').dataset.n);
    const act = b.dataset.act;
    if (act === 'read') {
      App.goToPage(n).then(() => App.play());
      App.toast('Lettura dalla pagina ' + n);
    } else if (act === 'rotate') rotatePage(n);
    else if (act === 'delete') deletePage(n, true);
    else if (act === 'restore') deletePage(n, false);
  });

  ui.zoomIn.addEventListener('click', () => zoomStep(1));
  ui.zoomOut.addEventListener('click', () => zoomStep(-1));
  ui.miniPlay.addEventListener('click', () => App.togglePlay());
  ui.editToggle.addEventListener('click', () => setEditing(true));
  ui.editDone.addEventListener('click', () => setEditing(false));
  ui.undoBtn.addEventListener('click', undo);
  ui.saveBtn.addEventListener('click', exportPdf);
  ui.editTools.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  App.events.addEventListener('bookloaded', () => {
    V.built = false;
    V.needsScroll = true;
    if (V.observer) V.observer.disconnect();
    ui.inner.innerHTML = '';
    V.pages = [];
    setEditing(false);
  });

  App.events.addEventListener('viewchange', async (e) => {
    const on = e.detail.view === 'viewPages';
    ui.bar.classList.toggle('hidden', !on);
    if (!on) return;
    if (!V.built) await build();
    else if (ui.scroll.clientWidth !== V.lastWidth) layoutAll();
    markReading();
    if (V.needsScroll) { V.needsScroll = false; scrollToPage(S.page); }
  });

  App.events.addEventListener('pagechange', markReading);
  App.events.addEventListener('modechange', (e) => {
    const playing = e.detail.mode === 'playing';
    ui.miniPlay.textContent = playing ? '⏸' : '▶';
    ui.miniPlay.setAttribute('aria-label', playing ? 'Pausa' : 'Leggi');
    markReading();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderSwatches();
      if (!V.built || S.view !== 'viewPages' || ui.scroll.clientWidth === V.lastWidth) return;
      const sc = ui.scroll;
      const ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
      layoutAll();
      sc.scrollTop = ratio * sc.scrollHeight;
    }, 200);
  });

  V.tool = App.store.get('tool', 'pen');
  if (V.tool === 'pan' || !['pen', 'hl', 'text', 'eraser'].includes(V.tool)) V.tool = 'pen';
  setTool(V.tool);
  ui.zoomLabel.textContent = Math.round(V.zoom * 100) + '%';
})();
