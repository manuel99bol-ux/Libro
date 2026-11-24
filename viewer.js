/* Lettore di Libri — scheda "Pagine" ed editor del documento.
 *
 * Modello: ogni pagina ha una lista di oggetti (caselle di testo, forme, immagini,
 * tratti a mano). Ogni oggetto vive in un "riquadro" R (0/90/180/270): coordinate
 * in punti PDF con origine in alto a sinistra della pagina vista con rotazione R.
 * Le stesse coordinate servono per disegnare sullo schermo e per scrivere il PDF
 * con pdf-lib, quindi quello che si vede è quello che si esporta.
 */
(function () {
  'use strict';

  const App = window.App;
  const S = App.state;
  const $ = (id) => document.getElementById(id);
  const ui = {
    body: document.body,
    view: $('viewPages'),
    scroll: $('pagesScroll'),
    inner: $('pagesInner'),
    bar: $('pagesBar'),
    zoomIn: $('zoomIn'),
    zoomOut: $('zoomOut'),
    zoomLabel: $('zoomLabel'),
    miniPlay: $('miniPlay'),
    miniInfo: $('miniInfo'),
    editToggle: $('editToggle'),
    // editor
    edClose: $('edClose'),
    edUndo: $('edUndo'),
    edRedo: $('edRedo'),
    edSave: $('edSave'),
    edDocName: $('edDocName'),
    edSaved: $('edSaved'),
    ribbon: $('ribbon'),
    tabs: document.querySelectorAll('.rtab'),
    fFamily: $('fFamily'),
    fSize: $('fSize'),
    fcBar: $('fcBar'),
    hlBar: $('hlBar'),
    stBar: $('stBar'),
    flBar: $('flBar'),
    inkSwatches: $('inkSwatches'),
    palette: $('palette'),
    imgInput: $('imgInput'),
    sbPage: $('sbPage'),
    sbHint: $('sbHint'),
    sbZoom: $('sbZoom'),
    sbZoomVal: $('sbZoomVal'),
    sbZoomIn: $('sbZoomIn'),
    sbZoomOut: $('sbZoomOut'),
    saveDialog: $('saveDialog'),
    saveInfo: $('saveInfo'),
    shareBtn: $('shareBtn'),
    fileInput: $('fileInput'),
  };

  // ---------- Costanti ----------
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 4;
  const PAD = 2;            // margine interno delle caselle di testo (punti)
  const LH = 1.2;           // interlinea
  const BASE = 0.9;         // posizione della linea di base nella riga (× dimensione)
  const HL_OPACITY = 0.45;
  const INK_WIDTHS = { pen: [1, 2.5, 5], hl: [8, 14, 22] };
  const FAMILIES = {
    sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
    serif: '"Times New Roman", Times, "Liberation Serif", serif',
    mono: '"Courier New", Courier, "Liberation Mono", monospace',
  };
  // I 12 caratteri standard del PDF: si esportano senza incorporare file di font.
  const STD = {
    sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
    serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
    mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
  };
  const stdName = (o) => STD[o.font || 'sans'][(o.bold ? 1 : 0) + (o.italic ? 2 : 0)];
  const PALETTE = [
    '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff', '#c00000', '#ff0000', '#ffc000',
    '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0', '#ff66cc',
  ];
  const HL_PALETTE = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#0000ff', '#ff0000', '#000080', '#008080',
    '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0', '#000000', '#ffc000'];
  const INK_COLORS = ['#000000', '#d32f2f', '#1565c0', '#2e7d32', '#7030a0', '#ff6d00', '#ffff00', '#00ff00', '#00ffff', '#ff66cc'];

  const ICONS = {
    check: 'M5 12l5 5L20 7',
    undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
    redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
    save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
    share: 'M12 15V3M8 7l4-4 4 4M5 12v9h14v-9',
    folder: 'M3 6h6l2 2h10v11H3z',
    discard: 'M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.7L3 8M3 3v5h5',
    paste: 'M9 3h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
    cut: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.5 7.5L20 19M8.5 16.5L20 5',
    copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
    duplicate: 'M8 8h12v12H8zM16 8V4H4v12h4M14 11v6M11 14h6',
    alignL: 'M4 6h16M4 10h10M4 14h16M4 18h10',
    alignC: 'M4 6h16M7 10h10M4 14h16M7 18h10',
    alignR: 'M4 6h16M10 10h10M4 14h16M10 18h10',
    alignJ: 'M4 6h16M4 10h16M4 14h16M4 18h16',
    select: 'M6 3l12 8-5.5 1.5L10 18z',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
    textbox: 'M3 4h18v16H3zM8 9h8M12 9v7',
    image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M17 9.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0',
    rect: 'M4 6h16v12H4z',
    ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
    line: 'M5 19L19 5',
    arrow: 'M5 19L19 5M10 5h9v9',
    bucket: 'M5 11l7-7 7 7-7 7zM19 15s2 2.5 2 4a2 2 0 01-4 0c0-1.5 2-4 2-4z',
    pen: 'M15 4l5 5L9 20H4v-5zM13 6l5 5',
    marker: 'M9 11l-5 5v4h4l5-5M9 11l7-7 4 4-7 7zM14 20h6',
    eraser: 'M8 20h12M4.5 15.5l9-9 6 6-7.5 7.5H8z',
    rotL: 'M4 4v5h5M4.6 9A8 8 0 1112 20',
    rotR: 'M20 4v5h-5M19.4 9A8 8 0 1012 20',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    pagePlus: 'M6 3h9l4 4v14H6zM15 3v4h4M12 11v6M9 14h6',
    pageDel: 'M6 3h9l4 4v14H6zM15 3v4h4M9.5 12.5l5 5M14.5 12.5l-5 5',
    zoomIn: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.5 15.5L21 21M8 10.5h5M10.5 8v5',
    zoomOut: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.5 15.5L21 21M8 10.5h5',
    fitWidth: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
    fitPage: 'M6 3h12v18H6zM12 7v10M9 10l3-3 3 3M9 14l3 3 3-3',
    headphones: 'M4 15v-3a8 8 0 0116 0v3M4 15h3v6H4zM17 15h3v6h-3z',
    edit: 'M15 4l5 5L9 20H4v-5z',
  };
  const icon = (name) => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>';
  document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

  // ---------- Stato ----------
  const V = {
    zoom: clampZoom(Number(App.store.get('zoom', 1)) || 1),
    editMode: false,
    tool: 'select',
    pages: {},
    built: false,
    needsScroll: false,
    visible: new Set(),
    undo: [],
    redo: [],
    observer: null,
    defaultSize: null,
    drag: null,
    sel: null,          // { key, obj }
    editing: null,      // casella di testo in modifica
    clip: null,
    curKey: null,
    lastWidth: 0,
    images: {},
    imgEls: {},
    style: Object.assign({ font: 'sans', size: 12, bold: false, italic: false, underline: false, color: '#000000', hl: '#ffff00', align: 'left' },
      App.store.get('textStyle', {})),
    shape: Object.assign({ stroke: '#0070c0', fill: null, sw: 2 }, App.store.get('shapeStyle', {})),
    ink: Object.assign({ pen: { color: '#000000', w: 1 }, hl: { color: '#ffff00', w: 1 } }, App.store.get('ink', {})),
  };

  function clampZoom(z) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); }
  const edits = () => App.edits;
  const anns = (key) => (edits().ann[key] || (edits().ann[key] = []));
  const norm360 = (a) => ((Math.round(a) % 360) + 360) % 360;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- Testo compatibile con i caratteri standard del PDF ----------
  const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function winAnsi(s) {
    let out = '';
    let bad = false;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (ch === '\n' || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.includes(ch)) out += ch;
      else if (ch === '\t') out += '    ';
      else if (ch === '\r') continue;
      else { out += '?'; bad = true; }
    }
    return { text: out, bad };
  }

  // Metriche dei caratteri prese da pdf-lib: stesse misure a schermo e nel PDF.
  const M = { fonts: null, loading: null };
  function ensureMetrics() {
    if (M.fonts) return Promise.resolve();
    if (M.loading) return M.loading;
    M.loading = (async () => {
      if (!window.PDFLib) await App.loadScript('lib/pdf-lib.min.js');
      const doc = await PDFLib.PDFDocument.create();
      const f = {};
      for (const fam in STD) for (const n of STD[fam]) f[n] = await doc.embedFont(n);
      M.fonts = f;
      redrawVisible();
    })().catch((e) => { console.error(e); M.loading = null; });
    return M.loading;
  }
  const textWidth = (t, name, size) => (M.fonts ? M.fonts[name].widthOfTextAtSize(t, size) : t.length * size * 0.5);

  function layoutText(o) {
    const name = stdName(o);
    const size = o.size;
    const text = winAnsi(o.text || '').text;
    // Righe modificate del PDF: la casella si allarga col testo (fino al margine), come in un elaboratore di testi.
    let boxW = o.w;
    if (o.auto) {
      const natural = Math.max.apply(null, text.split('\n').map((t) => textWidth(t, name, size)));
      boxW = Math.min(o.maxW || Infinity, Math.max(o.minW || 0, natural + 2 * PAD + 1));
    }
    const avail = Math.max(size, boxW - 2 * PAD);
    const lines = [];
    const sp = textWidth(' ', name, size);
    for (const para of text.split('\n')) {
      let cur = [];
      let curW = 0;
      const flush = (last) => { lines.push({ words: cur, text: cur.join(' '), width: curW, last }); cur = []; curW = 0; };
      for (let w of para.split(' ')) {
        let ww = textWidth(w, name, size);
        while (ww > avail && w.length > 1) { // parola più lunga della riga: va spezzata
          if (cur.length) flush(false);
          let i = w.length - 1;
          while (i > 1 && textWidth(w.slice(0, i), name, size) > avail) i--;
          cur = [w.slice(0, i)];
          curW = textWidth(cur[0], name, size);
          flush(false);
          w = w.slice(i);
          ww = textWidth(w, name, size);
        }
        if (cur.length && curW + sp + ww > avail) flush(false);
        curW += cur.length ? sp + ww : ww;
        cur.push(w);
      }
      flush(true);
    }
    const lh = size * LH;
    const align = o.align || 'left';
    lines.forEach((L, i) => {
      L.top = o.y + PAD + i * lh;
      L.base = L.top + size * BASE;
      let x = o.x + PAD;
      if (align === 'center') x = o.x + (boxW - L.width) / 2;
      else if (align === 'right') x = o.x + boxW - PAD - L.width;
      L.x = x;
      L.segs = [{ t: L.text, x }];
      if (align === 'justify' && !L.last && L.words.length > 1) {
        const ws = L.words.map((w) => textWidth(w, name, size));
        const gap = (avail - ws.reduce((a, b) => a + b, 0)) / (L.words.length - 1);
        let xx = o.x + PAD;
        L.segs = L.words.map((w, j) => { const s = { t: w, x: xx }; xx += ws[j] + gap; return s; });
        L.x = o.x + PAD;
        L.width = avail;
      }
    });
    return { lines, h: 2 * PAD + Math.max(1, lines.length) * lh, w: boxW, name };
  }

  // ---------- Percorsi (comuni a schermo ed esportazione) ----------
  const f2 = (n) => Math.round(n * 100) / 100;
  function shapePath(o) {
    const x = o.x, y = o.y, w = o.w, h = o.h;
    switch (o.kind) {
      case 'rect': return 'M' + f2(x) + ' ' + f2(y) + 'H' + f2(x + w) + 'V' + f2(y + h) + 'H' + f2(x) + 'Z';
      case 'ellipse': {
        const cx = x + w / 2, cy = y + h / 2, rx = Math.abs(w) / 2, ry = Math.abs(h) / 2, k = 0.5523;
        return 'M' + f2(cx - rx) + ' ' + f2(cy) +
          'C' + f2(cx - rx) + ' ' + f2(cy - ry * k) + ' ' + f2(cx - rx * k) + ' ' + f2(cy - ry) + ' ' + f2(cx) + ' ' + f2(cy - ry) +
          'C' + f2(cx + rx * k) + ' ' + f2(cy - ry) + ' ' + f2(cx + rx) + ' ' + f2(cy - ry * k) + ' ' + f2(cx + rx) + ' ' + f2(cy) +
          'C' + f2(cx + rx) + ' ' + f2(cy + ry * k) + ' ' + f2(cx + rx * k) + ' ' + f2(cy + ry) + ' ' + f2(cx) + ' ' + f2(cy + ry) +
          'C' + f2(cx - rx * k) + ' ' + f2(cy + ry) + ' ' + f2(cx - rx) + ' ' + f2(cy + ry * k) + ' ' + f2(cx - rx) + ' ' + f2(cy) + 'Z';
      }
      case 'line': return 'M' + f2(x) + ' ' + f2(y) + 'L' + f2(x + w) + ' ' + f2(y + h);
      case 'arrow': {
        const x2 = x + w, y2 = y + h, a = Math.atan2(h, w), L = Math.max(8, (o.sw || 2) * 4), s = 0.45;
        return 'M' + f2(x) + ' ' + f2(y) + 'L' + f2(x2) + ' ' + f2(y2) +
          'M' + f2(x2 - L * Math.cos(a - s)) + ' ' + f2(y2 - L * Math.sin(a - s)) + 'L' + f2(x2) + ' ' + f2(y2) +
          'L' + f2(x2 - L * Math.cos(a + s)) + ' ' + f2(y2 - L * Math.sin(a + s));
      }
    }
    return '';
  }
  function inkPath(o) {
    const p = o.pts;
    if (!p.length) return '';
    let d = 'M' + f2(p[0][0]) + ' ' + f2(p[0][1]);
    if (p.length === 1) d += 'L' + f2(p[0][0] + 0.05) + ' ' + f2(p[0][1]);
    for (let i = 1; i < p.length; i++) d += 'L' + f2(p[i][0]) + ' ' + f2(p[i][1]);
    return d;
  }
  const rectPath = (x, y, w, h) => 'M' + f2(x) + ' ' + f2(y) + 'H' + f2(x + w) + 'V' + f2(y + h) + 'H' + f2(x) + 'Z';

  // ---------- Geometria delle pagine ----------
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
  const pageCount = () => (S.pdf ? S.pdf.numPages : 0);
  function getOrder() {
    if (edits().order) return edits().order.slice();
    const o = [];
    for (let n = 1; n <= pageCount(); n++) o.push(String(n));
    return o;
  }
  function srcOf(key) {
    const ex = edits().extra && edits().extra[key];
    if (ex) return ex.blank ? 0 : ex.src;
    return Number(key);
  }
  function pinfo(key) {
    const p = V.pages[key];
    if (p && p.size) return p.size;
    const ex = edits().extra && edits().extra[key];
    if (ex && ex.blank) return { w: ex.blank.w, h: ex.blank.h, rotate0: 0 };
    if (ex && ex.src && V.pages[ex.src] && V.pages[ex.src].size) return V.pages[ex.src].size;
    if (V.pages[String(srcOf(key))] && V.pages[String(srcOf(key))].size) return V.pages[String(srcOf(key))].size;
    return V.defaultSize;
  }
  const rotOf = (key) => norm360((pinfo(key).rotate0 || 0) + (edits().rot[key] || 0));
  function fdims(key, R) {
    const i = pinfo(key);
    return R % 180 ? { w: i.h, h: i.w } : { w: i.w, h: i.h };
  }
  const dispPt = (key) => fdims(key, rotOf(key));
  // Matrice affine: coordinate del riquadro R (punti) -> pixel di una superficie W×H che mostra la pagina.
  function frameMatrix(key, R, W, H) {
    const r = rotOf(key);
    const d = fdims(key, R);
    const map = (X, Y) => { const uv = fromDisp(X / d.w, Y / d.h, R); const xy = toDisp(uv[0], uv[1], r); return [xy[0] * W, xy[1] * H]; };
    const o = map(0, 0), a = map(1, 0), b = map(0, 1);
    return [a[0] - o[0], a[1] - o[1], b[0] - o[0], b[1] - o[1], o[0], o[1]];
  }
  // Punto normalizzato sullo schermo (0..1) -> coordinate del riquadro R.
  function toFrame(key, R, dx, dy) {
    const uv = fromDisp(dx, dy, rotOf(key));
    const xy = toDisp(uv[0], uv[1], R);
    const d = fdims(key, R);
    return [xy[0] * d.w, xy[1] * d.h];
  }
  function cssMatrix(key, R) {
    const p = V.pages[key];
    return frameMatrix(key, R, p.area.clientWidth, p.area.clientHeight);
  }
  const applyM = (m, X, Y) => [m[0] * X + m[2] * Y + m[4], m[1] * X + m[3] * Y + m[5]];
  function invDelta(m, dx, dy) {
    const det = m[0] * m[3] - m[1] * m[2];
    return [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det];
  }
  function baseWidth() { return Math.max(200, Math.min(ui.scroll.clientWidth - 16, 900)); }
  function cssSize(key) {
    const d = dispPt(key);
    const w = Math.round(baseWidth() * V.zoom);
    return { w, h: Math.round(w * d.h / d.w) };
  }

  // ---------- Costruzione della vista ----------
  function createPage(key) {
    const box = document.createElement('div');
    box.className = 'pagebox';
    box.dataset.key = key;
    box.innerHTML =
      '<div class="pagehead"><span class="pnum"></span><span class="pbtns">' +
      '<button type="button" data-act="read">🔊 Leggi</button></span></div>' +
      '<div class="pagearea" data-key="' + key + '">' +
      '<div class="spinner">…</div>' +
      '<canvas class="pg"></canvas><div class="overlay"></div>' +
      '<div class="deleted">Pagina eliminata<button type="button" data-act="restore">Ripristina</button></div>' +
      '</div>';
    const area = box.querySelector('.pagearea');
    const p = {
      key, box, area,
      label: box.querySelector('.pnum'),
      readBtn: box.querySelector('[data-act="read"]'),
      canvas: area.querySelector('canvas.pg'),
      overlay: area.querySelector('.overlay'),
      spinner: area.querySelector('.spinner'),
      base: null,
      size: null,
      token: 0,
      task: null,
      renderedKey: null,
      runs: null,
    };
    p.readBtn.classList.toggle('hidden', !srcOf(key));
    V.pages[key] = p;
    if (V.observer) V.observer.observe(area);
    return p;
  }

  async function build() {
    if (!S.pdf) return;
    if (V.observer) V.observer.disconnect();
    Object.values(V.pages).forEach(freePage);
    ui.inner.innerHTML = '';
    V.pages = {};
    V.visible.clear();
    const pdf = S.pdf;
    const first = await pdf.getPage(1);
    if (pdf !== S.pdf) return;
    const vp = first.getViewport({ scale: 1, rotation: 0 });
    V.defaultSize = { w: vp.width, h: vp.height, rotate0: first.rotate || 0 };
    V.observer = new IntersectionObserver(onIntersect, { root: ui.scroll, rootMargin: '900px 0px' });
    V.built = true;
    syncDom();
    markReading();
  }

  // Allinea le pagine nel DOM all'ordine corrente (dopo spostamenti, inserimenti, annulla).
  function syncDom() {
    if (!V.built) return;
    const order = getOrder();
    const want = new Set(order);
    for (const key of Object.keys(V.pages)) {
      if (!want.has(key)) {
        const p = V.pages[key];
        V.observer.unobserve(p.area);
        freePage(p);
        p.box.remove();
        delete V.pages[key];
        V.visible.delete(key);
      }
    }
    order.forEach((key, i) => {
      const p = V.pages[key] || createPage(key);
      p.label.textContent = 'Pagina ' + (i + 1);
      p.box.classList.toggle('is-deleted', !!edits().del[key]);
      if (ui.inner.children[i] !== p.box) ui.inner.insertBefore(p.box, ui.inner.children[i] || null);
    });
    layoutAll();
    updateStatus();
  }

  function layoutPage(key) {
    const p = V.pages[key];
    const { w, h } = cssSize(key);
    p.box.style.width = w + 'px';
    p.area.style.height = h + 'px';
    return w;
  }

  function layoutAll() {
    if (!V.built) return;
    V.lastWidth = ui.scroll.clientWidth;
    let maxW = 0;
    for (const key of Object.keys(V.pages)) maxW = Math.max(maxW, layoutPage(key));
    ui.inner.style.width = maxW + 16 > ui.scroll.clientWidth ? (maxW + 16) + 'px' : '';
    const pct = Math.round(V.zoom * 100) + '%';
    ui.zoomLabel.textContent = pct;
    ui.sbZoomVal.textContent = pct;
    ui.sbZoom.value = Math.round(V.zoom * 100);
    V.visible.forEach((key) => renderPage(key));
    positionSel();
    if (V.editing) styleEditor();
  }

  function onIntersect(entries) {
    for (const e of entries) {
      const key = e.target.dataset.key;
      if (e.isIntersecting) { V.visible.add(key); renderPage(key); }
      else { V.visible.delete(key); freePage(V.pages[key]); }
    }
  }

  function freePage(p) {
    if (!p) return;
    p.token++;
    if (p.task) { try { p.task.cancel(); } catch (e) { /* ignora */ } p.task = null; }
    p.canvas.width = p.canvas.height = 0;
    p.base = null;
    p.renderedKey = null;
    p.spinner.classList.remove('hidden');
  }

  async function renderPage(key) {
    const p = V.pages[key];
    if (!p || !S.pdf) return;
    const token = ++p.token;
    const src = srcOf(key);
    let page = null;
    if (src) {
      page = await S.pdf.getPage(src);
      if (token !== p.token) return;
      if (!p.size) {
        const vp0 = page.getViewport({ scale: 1, rotation: 0 });
        p.size = { w: vp0.width, h: vp0.height, rotate0: page.rotate || 0, view: page.view };
        layoutPage(key);
      }
    } else if (!p.size) {
      p.size = pinfo(key);
      layoutPage(key);
    }
    migrate(key);
    const { w, h } = cssSize(key);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const factor = Math.min(dpr, Math.sqrt(5e6 / (w * h)));
    const r = rotOf(key);
    const rk = w + 'x' + h + '@' + factor.toFixed(3) + 'r' + r;
    if (p.renderedKey !== rk) {
      const off = document.createElement('canvas');
      if (page) {
        const d = dispPt(key);
        const viewport = page.getViewport({ scale: (w / d.w) * factor, rotation: r });
        off.width = Math.max(1, Math.floor(viewport.width));
        off.height = Math.max(1, Math.floor(viewport.height));
        if (p.task) { try { p.task.cancel(); } catch (e) { /* ignora */ } }
        const task = page.render({ canvasContext: off.getContext('2d'), viewport });
        p.task = task;
        try { await task.promise; } catch (err) { if (p.task === task) p.task = null; return; }
        if (p.task === task) p.task = null;
      } else {
        off.width = Math.max(1, Math.round(w * factor));
        off.height = Math.max(1, Math.round(h * factor));
        const c = off.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, off.width, off.height);
      }
      if (token !== p.token) return;
      p.base = off;
      p.renderedKey = rk;
      p.canvas.width = off.width;
      p.canvas.height = off.height;
      p.spinner.classList.add('hidden');
    }
    compose(key);
  }

  function redrawVisible() { V.visible.forEach((key) => compose(key)); }

  // ---------- Disegno ----------
  function compose(key, extra) {
    const p = V.pages[key];
    if (!p || !p.base) return;
    const c = p.canvas;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(p.base, 0, 0);
    const list = (edits().ann[key] || []).concat(extra ? [extra] : []);
    for (const o of list) {
      if (V.editing && V.editing.o === o) continue;
      drawObj(ctx, key, o, c.width, c.height);
    }
  }

  function drawObj(ctx, key, o, W, H) {
    const m = frameMatrix(key, o.R || 0, W, H);
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (o.type === 'ink') {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.width;
      ctx.strokeStyle = o.color;
      if (o.tool === 'hl') { ctx.globalAlpha = HL_OPACITY; ctx.globalCompositeOperation = 'multiply'; }
      ctx.stroke(new Path2D(inkPath(o)));
    } else if (o.type === 'shape') {
      const path = new Path2D(shapePath(o));
      if (o.fill && o.kind !== 'line' && o.kind !== 'arrow') { ctx.fillStyle = o.fill; ctx.fill(path); }
      if (o.stroke && o.sw > 0) {
        ctx.lineWidth = o.sw;
        ctx.strokeStyle = o.stroke;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
    } else if (o.type === 'image') {
      const img = imageEl(o.img, key);
      if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
    } else if (o.type === 'tbox') {
      if (!M.fonts) ensureMetrics();
      else drawTbox(ctx, o);
    }
    ctx.restore();
  }

  function cssFont(o, size) {
    return (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + size + 'px ' + FAMILIES[o.font || 'sans'];
  }

  function drawTbox(ctx, o) {
    const L = layoutText(o);
    ctx.font = cssFont(o, o.size);
    ctx.textBaseline = 'alphabetic';
    if (o.hl) {
      ctx.fillStyle = o.hl;
      for (const l of L.lines) if (l.width > 0) ctx.fillRect(l.x, l.top, l.width, o.size * LH);
    }
    ctx.fillStyle = o.color || '#000000';
    for (const l of L.lines) {
      for (const s of l.segs) ctx.fillText(s.t, s.x, l.base);
      if (o.underline && l.width > 0) ctx.fillRect(l.x, l.base + o.size * 0.1, l.width, Math.max(0.5, o.size * 0.06));
    }
  }

  function imageEl(id, key) {
    if (V.imgEls[id]) return V.imgEls[id].complete ? V.imgEls[id] : null;
    if (!V.images[id]) return null;
    const img = new Image();
    img.onload = () => compose(key);
    img.src = V.images[id];
    V.imgEls[id] = img;
    return img.complete ? img : null;
  }

  // Converte le annotazioni della versione precedente nel nuovo modello.
  function migrate(key) {
    const list = edits().ann[key];
    if (!list || !list.length) return;
    let changed = false;
    list.forEach((o, i) => {
      if (o.type === 'stroke') {
        const d = fdims(key, 0);
        list[i] = { type: 'ink', R: 0, tool: o.tool, color: o.color, width: o.width, pts: o.pts.map((q) => [q[0] * d.w, q[1] * d.h]) };
        changed = true;
      } else if (o.type === 'text') {
        const R = rotOf(key);
        const xy = toDisp(o.u, o.v, R);
        const d = fdims(key, R);
        const longest = Math.max.apply(null, o.text.split('\n').map((l) => l.length));
        list[i] = {
          type: 'tbox', R, x: xy[0] * d.w - PAD, y: xy[1] * d.h - PAD - o.size * BASE,
          w: longest * o.size * 0.6 + 2 * PAD + 6, size: o.size, font: 'sans', color: o.color, text: o.text, align: 'left',
        };
        changed = true;
      }
    });
    if (changed) App.saveEdits();
  }

  // ---------- Riquadri e selezione ----------
  function objBox(o) {
    if (o.type === 'tbox') { const L = layoutText(o); return { x0: o.x, y0: o.y, x1: o.x + L.w, y1: o.y + L.h }; }
    if (o.type === 'ink') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of o.pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      const hw = o.width / 2;
      return { x0: x0 - hw, y0: y0 - hw, x1: x1 + hw, y1: y1 + hw };
    }
    return { x0: Math.min(o.x, o.x + o.w), y0: Math.min(o.y, o.y + o.h), x1: Math.max(o.x, o.x + o.w), y1: Math.max(o.y, o.y + o.h) };
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function hitObj(key, dx, dy, onlyInk) {
    const list = edits().ann[key] || [];
    const tolCss = 10;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      if (onlyInk && o.type !== 'ink') continue;
      const R = o.R || 0;
      const [X, Y] = toFrame(key, R, dx, dy);
      const k = Math.hypot.apply(null, cssMatrix(key, R).slice(0, 2)); // px css per punto
      const tol = tolCss / k;
      if (o.type === 'ink' || (o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow'))) {
        const pts = o.type === 'ink' ? o.pts : [[o.x, o.y], [o.x + o.w, o.y + o.h]];
        const hw = (o.type === 'ink' ? o.width : o.sw) / 2;
        for (let j = 0; j < pts.length; j++) {
          const q = pts[Math.min(j + 1, pts.length - 1)];
          if (distToSeg(X, Y, pts[j][0], pts[j][1], q[0], q[1]) <= tol + hw) return o;
        }
      } else {
        const b = objBox(o);
        if (X >= b.x0 - tol && X <= b.x1 + tol && Y >= b.y0 - tol && Y <= b.y1 + tol) return o;
      }
    }
    return null;
  }

  // Elementi della selezione (riquadro, maniglia, barra contestuale), riusati.
  const selBox = document.createElement('div');
  selBox.className = 'selbox';
  const selHandle = document.createElement('div');
  selHandle.className = 'sel-handle';
  selBox.appendChild(selHandle);
  const ctxBar = document.createElement('div');
  ctxBar.className = 'ctxbar';
  ctxBar.innerHTML =
    '<button type="button" data-ctx="edit">' + icon('edit') + 'Modifica testo</button>' +
    '<button type="button" data-ctx="copy">' + icon('copy') + 'Copia</button>' +
    '<button type="button" data-ctx="duplicate">' + icon('duplicate') + 'Duplica</button>' +
    '<button type="button" data-ctx="delete">' + icon('trash') + 'Elimina</button>';

  function select(key, o) {
    V.sel = o ? { key, obj: o } : null;
    positionSel();
    syncRibbon();
  }
  function deselect() { if (V.sel) select(null, null); }

  function positionSel() {
    if (!V.sel || !V.pages[V.sel.key] || !anns(V.sel.key).includes(V.sel.obj)) {
      V.sel = null;
      selBox.remove();
      ctxBar.remove();
      return;
    }
    const { key, obj } = V.sel;
    const p = V.pages[key];
    const m = cssMatrix(key, obj.R || 0);
    const b = objBox(obj);
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map((q) => applyM(m, q[0], q[1]));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const l = Math.min.apply(null, xs), t = Math.min.apply(null, ys);
    const r = Math.max.apply(null, xs), bt = Math.max.apply(null, ys);
    if (selBox.parentNode !== p.overlay) p.overlay.appendChild(selBox);
    if (ctxBar.parentNode !== p.overlay) p.overlay.appendChild(ctxBar);
    Object.assign(selBox.style, { left: (l - 2) + 'px', top: (t - 2) + 'px', width: (r - l + 4) + 'px', height: (bt - t + 4) + 'px' });
    // Maniglia: estremo finale per linee/frecce, angolo in basso a destra per il resto.
    const sameFrame = (obj.R || 0) === rotOf(key);
    selHandle.style.display = sameFrame && obj.type !== 'ink' ? '' : 'none';
    let hx, hy;
    if (obj.type === 'shape' && (obj.kind === 'line' || obj.kind === 'arrow')) [hx, hy] = applyM(m, obj.x + obj.w, obj.y + obj.h);
    else [hx, hy] = [r, bt];
    selHandle.style.left = (hx - l + 2) + 'px';
    selHandle.style.top = (hy - t + 2) + 'px';
    ctxBar.querySelector('[data-ctx="edit"]').style.display = obj.type === 'tbox' ? '' : 'none';
    const barH = 44;
    const top = t - barH - 8 >= 0 ? t - barH - 8 : bt + 12;
    const left = Math.max(0, Math.min(l, p.area.clientWidth - ctxBar.offsetWidth));
    ctxBar.style.top = top + 'px';
    ctxBar.style.left = left + 'px';
  }

  // ---------- Annulla / Ripeti / salvataggio automatico ----------
  const snapshot = () => JSON.stringify(edits());
  function pushUndo(snap) {
    V.undo.push(snap || snapshot());
    if (V.undo.length > 80) V.undo.shift();
    V.redo = [];
    updateUndo();
  }
  function updateUndo() {
    ui.edUndo.disabled = V.undo.length === 0;
    ui.edRedo.disabled = V.redo.length === 0;
  }
  let savedTimer = null;
  function changed(keys) {
    App.saveEdits();
    App.el.deletedNote.classList.toggle('hidden', !edits().del[S.page]);
    ui.edSaved.textContent = 'Salvataggio…';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { ui.edSaved.textContent = 'Salvato ✓'; }, 600);
    (keys || []).forEach((k) => compose(k));
    positionSel();
  }
  function restore(json) {
    App.edits = Object.assign(App.emptyEdits(), JSON.parse(json));
    V.sel = null;
    positionSel();
    Object.values(V.pages).forEach((p) => { p.runs = null; });
    syncDom();
    changed([]);
    updateUndo();
  }
  function undo() {
    commitEdit();
    if (!V.undo.length) return;
    V.redo.push(snapshot());
    restore(V.undo.pop());
  }
  function redo() {
    commitEdit();
    if (!V.redo.length) return;
    V.undo.push(snapshot());
    restore(V.redo.pop());
  }

  // ---------- Modifica del testo sulla pagina ----------
  const ta = document.createElement('textarea');
  ta.className = 'inline-editor';
  ta.setAttribute('autocapitalize', 'sentences');
  ta.setAttribute('aria-label', 'Testo della casella');

  function startEdit(key, o, opts) {
    commitEdit();
    opts = opts || {};
    V.sel = null;
    positionSel();
    V.editing = { key, o, snap: opts.snapshot || snapshot(), orig: o.text, replace: !!opts.replace, styled: false };
    V.pages[key].overlay.appendChild(ta);
    ta.value = o.text;
    styleEditor();
    compose(key);
    syncRibbon();
    setHint('Scrivi il testo. Tocca fuori dalla casella per terminare.');
    ta.focus({ preventScroll: true });
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* ignora */ }
    setTimeout(() => ta.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  }

  function styleEditor() {
    if (!V.editing) return;
    const { key, o } = V.editing;
    const m = cssMatrix(key, o.R || 0);
    const k = Math.hypot(m[0], m[1]);
    const ang = Math.atan2(m[1], m[0]) * 180 / Math.PI;
    const [x, y] = applyM(m, o.x, o.y);
    const bw = o.auto ? layoutText(o).w : o.w;
    Object.assign(ta.style, {
      left: x + 'px',
      top: y + 'px',
      width: (bw * k + (o.auto ? 6 : 0)) + 'px',
      font: cssFont(o, o.size * k),
      lineHeight: String(LH),
      padding: (PAD * k) + 'px',
      color: o.color || '#000',
      textAlign: o.align === 'justify' ? 'justify' : (o.align || 'left'),
      textDecoration: o.underline ? 'underline' : 'none',
      transform: ang ? 'rotate(' + ang + 'deg)' : '',
      background: o.hl ? hexA(o.hl, 0.35) : 'transparent',
    });
    autoSize();
  }
  function autoSize() { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  ta.addEventListener('input', () => {
    if (!V.editing) return;
    V.editing.o.text = ta.value;
    if (V.editing.o.auto) styleEditor(); else autoSize();
  });
  ta.addEventListener('focusout', (e) => {
    // Restiamo in modifica se il fuoco va alla barra multifunzione (carattere, dimensione...).
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#editorTop, #palette')) return;
    setTimeout(() => { if (V.editing && document.activeElement !== ta && !document.activeElement.closest('#editorTop, #palette')) commitEdit(); }, 0);
  });

  function commitEdit() {
    if (!V.editing) return;
    const ed = V.editing;
    V.editing = null;
    ta.remove();
    setHint('');
    const { key, o } = ed;
    const list = anns(key);
    o.text = ta.value.replace(/\s+$/, '');
    if (ed.replace && o.text === ed.orig && !ed.styled) {
      restore(ed.snap); // nessuna modifica reale al testo del PDF
      return;
    }
    if (!o.text.trim()) {
      const i = list.indexOf(o);
      if (i >= 0) list.splice(i, 1);
    } else {
      o.w = Math.max(o.w, o.size); // larghezza minima
    }
    if (snapshot() !== ed.snap) {
      pushUndo(ed.snap);
      if (winAnsi(o.text).bad) App.toast('Alcuni simboli (es. emoji) non sono disponibili e appaiono come «?».', 3500);
    }
    changed([key]);
    if (list.includes(o)) select(key, o);
    else syncRibbon();
  }

  // ---------- Testo originale del PDF ----------
  async function pdfRuns(key) {
    const p = V.pages[key];
    if (p.runs) return p.runs;
    const src = srcOf(key);
    if (!src) return (p.runs = []);
    const page = await S.pdf.getPage(src);
    const tc = await page.getTextContent();
    const view = page.view;
    const W = view[2] - view[0], H = view[3] - view[1];
    const runs = [];
    let cur = null;
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.transform) continue;
      const t = it.transform;
      const fs = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
      if (!fs || (!it.str.trim() && !cur)) continue;
      const ang = norm360(Math.atan2(t[1], t[0]) * 180 / Math.PI);
      if (ang % 90) { cur = null; continue; } // testo inclinato: non modificabile
      const R = ang;
      const u = (t[4] - view[0]) / W, v = (view[3] - t[5]) / H;
      const xy = toDisp(u, v, R);
      const d = fdims(key, R);
      const X = xy[0] * d.w, Y = xy[1] * d.h;
      const x1 = X + (it.width || 0);
      if (cur && cur.R === R && Math.abs(cur.yb - Y) < fs * 0.25 && Math.abs(cur.fs - fs) < fs * 0.25 &&
          X >= cur.x1 - fs * 0.4 && X - cur.x1 < fs * 1.2) {
        const gap = X - cur.x1;
        if (gap > fs * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
        cur.text += it.str;
        cur.x1 = Math.max(cur.x1, x1);
      } else if (it.str.trim()) {
        cur = { R, x0: X, x1, yb: Y, fs, text: it.str, fontName: it.fontName };
        runs.push(cur);
      }
      if (it.hasEOL) cur = null;
    }
    runs.forEach((r) => { r.text = r.text.replace(/\s+/g, ' ').trim(); });
    p.runs = runs.filter((r) => r.text);
    p.styles = tc.styles;
    p.pdfPage = page;
    return p.runs;
  }

  async function runAt(key, dx, dy) {
    const runs = await pdfRuns(key);
    for (const r of runs) {
      const [X, Y] = toFrame(key, r.R, dx, dy);
      if (X >= r.x0 - 2 && X <= r.x1 + 2 && Y >= r.yb - r.fs * 0.9 && Y <= r.yb + r.fs * 0.3) return r;
    }
    return null;
  }

  function guessFont(p, run) {
    let family = 'sans', bold = false, italic = false;
    const st = p.styles && p.styles[run.fontName];
    if (st && st.fontFamily === 'serif') family = 'serif';
    if (st && st.fontFamily === 'monospace') family = 'mono';
    let name = '';
    try {
      if (p.pdfPage && p.pdfPage.commonObjs.has(run.fontName)) name = p.pdfPage.commonObjs.get(run.fontName).name || '';
    } catch (e) { /* ignora */ }
    if (/times|serif|roman|georgia|garamond|cambria|book|minion|palatino/i.test(name) && !/sans/i.test(name)) family = 'serif';
    if (/courier|mono|consol/i.test(name)) family = 'mono';
    if (/arial|helvetica|calibri|verdana|sans/i.test(name)) family = 'sans';
    bold = /bold|black|heavy|semibold|demi/i.test(name);
    italic = /italic|oblique/i.test(name);
    return { family, bold, italic };
  }

  // Colori campionati dall'immagine della pagina: sfondo (per coprire) e testo.
  function sampleColors(key, run) {
    const p = V.pages[key];
    const fallback = { bg: '#ffffff', fg: '#000000' };
    if (!p.base) return fallback;
    const m = frameMatrix(key, run.R, p.base.width, p.base.height);
    const corners = [[run.x0, run.yb - run.fs * 0.9], [run.x1, run.yb - run.fs * 0.9], [run.x0, run.yb + run.fs * 0.25], [run.x1, run.yb + run.fs * 0.25]]
      .map((q) => applyM(m, q[0], q[1]));
    const xs = corners.map((q) => q[0]), ys = corners.map((q) => q[1]);
    const x0 = Math.max(0, Math.floor(Math.min.apply(null, xs)) - 3), y0 = Math.max(0, Math.floor(Math.min.apply(null, ys)) - 3);
    const x1 = Math.min(p.base.width, Math.ceil(Math.max.apply(null, xs)) + 3), y1 = Math.min(p.base.height, Math.ceil(Math.max.apply(null, ys)) + 3);
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) return fallback;
    let data;
    try { data = p.base.getContext('2d').getImageData(x0, y0, w, h).data; } catch (e) { return fallback; }
    const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
    // Sfondo: colore più frequente sul bordo del riquadro.
    const counts = new Map();
    const add = (c) => { const k = (c[0] >> 3) + ',' + (c[1] >> 3) + ',' + (c[2] >> 3); const e = counts.get(k) || { n: 0, c }; e.n++; counts.set(k, e); };
    for (let x = 0; x < w; x++) { add(px(x, 0)); add(px(x, h - 1)); }
    for (let y = 0; y < h; y++) { add(px(0, y)); add(px(w - 1, y)); }
    let bg = [255, 255, 255], best = 0;
    counts.forEach((e) => { if (e.n > best) { best = e.n; bg = e.c; } });
    // Testo: il pixel più diverso dallo sfondo.
    let fg = [0, 0, 0], far = 0;
    for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
      const c = px(x, y);
      const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
      if (d > far) { far = d; fg = c; }
    }
    if (far < 90) fg = [0, 0, 0];
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    return { bg: hex(bg), fg: hex(fg) };
  }

  function startReplace(key, run) {
    const p = V.pages[key];
    const snap = snapshot();
    const font = guessFont(p, run);
    const col = sampleColors(key, run);
    const size = Math.round(run.fs * 2) / 2;
    const style = { font: font.family, bold: font.bold, italic: font.italic };
    const tw = textWidth(winAnsi(run.text).text, stdName(style), size);
    const cover = {
      type: 'shape', kind: 'rect', R: run.R, whiteout: true,
      x: run.x0 - 1, y: run.yb - run.fs * 0.92 - 1, w: (run.x1 - run.x0) + 2, h: run.fs * 1.2 + 2,
      fill: col.bg, stroke: null, sw: 0,
    };
    const tb = {
      type: 'tbox', R: run.R, x: run.x0 - PAD, y: run.yb - PAD - size * BASE,
      w: Math.max(run.x1 - run.x0, tw) + 2 * PAD + size * 0.6,
      size, font: font.family, bold: font.bold, italic: font.italic, underline: false,
      color: col.fg, hl: null, align: 'left', text: run.text,
      auto: true, minW: (run.x1 - run.x0) + 2 * PAD, maxW: Math.max((run.x1 - run.x0) + 2 * PAD, fdims(key, run.R).w - (run.x0 - PAD) - 8),
    };
    anns(key).push(cover, tb);
    startEdit(key, tb, { snapshot: snap, replace: true });
  }

  // ---------- Input: tocco, mouse, penna ----------
  function normPoint(e, key) {
    const rect = V.pages[key].canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))];
  }

  let rafPending = false;
  function scheduleCompose() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const d = V.drag;
      if (!d) return;
      if (d.kind === 'ink' || d.kind === 'shape') compose(d.key, d.o);
      else if (d.kind === 'move' || d.kind === 'resize') { compose(d.key); positionSel(); }
    });
  }

  const SHAPES = ['rect', 'ellipse', 'line', 'arrow'];

  ui.inner.addEventListener('pointerdown', (e) => {
    if (!V.editMode) return;
    if (e.target.closest('.ctxbar') || e.target === ta) return;
    // Spostamento / ridimensionamento della selezione
    if (e.target.closest('.selbox') && V.sel) {
      e.preventDefault();
      try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
      V.drag = {
        kind: e.target.closest('.sel-handle') ? 'resize' : 'move', id: e.pointerId, key: V.sel.key,
        x0: e.clientX, y0: e.clientY, snap: snapshot(), orig: clone(V.sel.obj), moved: false,
      };
      return;
    }
    const cv = e.target.closest('canvas.pg');
    if (!cv) return;
    const key = cv.closest('.pagearea').dataset.key;
    if (edits().del[key]) return;
    if (V.drag) { // secondo dito: annulla il gesto in corso (zoom o scorrimento)
      const k = V.drag.key;
      V.drag = null;
      compose(k);
      return;
    }
    const [dx, dy] = normPoint(e, key);
    if (V.tool === 'select' || V.tool === 'textbox') {
      V.drag = { kind: 'tap', id: e.pointerId, key, x0: e.clientX, y0: e.clientY, dx, dy, t0: Date.now() };
      return; // nessun preventDefault: con un dito si può ancora scorrere il documento
    }
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
    commitEdit();
    const R = rotOf(key);
    const [X, Y] = toFrame(key, R, dx, dy);
    if (V.tool === 'pen' || V.tool === 'hl') {
      const ink = V.ink[V.tool];
      V.drag = { kind: 'ink', id: e.pointerId, key, lx: e.clientX, ly: e.clientY,
        o: { type: 'ink', R, tool: V.tool, color: ink.color, width: INK_WIDTHS[V.tool][ink.w], pts: [[X, Y]] } };
      scheduleCompose();
    } else if (V.tool === 'eraser') {
      V.drag = { kind: 'erase', id: e.pointerId, key, snap: snapshot(), changed: false };
      eraseAt(V.drag, dx, dy);
    } else if (SHAPES.includes(V.tool)) {
      const line = V.tool === 'line' || V.tool === 'arrow';
      V.drag = { kind: 'shape', id: e.pointerId, key, X0: X, Y0: Y,
        o: { type: 'shape', kind: V.tool, R, x: X, y: Y, w: 0, h: 0, stroke: V.shape.stroke || (line ? '#000000' : null), fill: line ? null : V.shape.fill, sw: V.shape.sw } };
    }
  });

  function eraseAt(d, dx, dy) {
    const o = hitObj(d.key, dx, dy, true);
    if (o) {
      if (!d.changed) { pushUndo(d.snap); d.changed = true; }
      const list = anns(d.key);
      list.splice(list.indexOf(o), 1);
      compose(d.key);
    }
  }

  ui.inner.addEventListener('pointermove', (e) => {
    const d = V.drag;
    if (!d || e.pointerId !== d.id) return;
    if (d.kind === 'tap') {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 10) V.drag = null; // sta scorrendo
      return;
    }
    e.preventDefault();
    if (d.kind === 'ink') {
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (list.length ? list : [e])) {
        if (Math.hypot(ev.clientX - d.lx, ev.clientY - d.ly) < 1.5) continue;
        d.lx = ev.clientX; d.ly = ev.clientY;
        const [dx, dy] = normPoint(ev, d.key);
        d.o.pts.push(toFrame(d.key, d.o.R, dx, dy));
      }
      scheduleCompose();
    } else if (d.kind === 'erase') {
      const [dx, dy] = normPoint(e, d.key);
      eraseAt(d, dx, dy);
    } else if (d.kind === 'shape') {
      const [dx, dy] = normPoint(e, d.key);
      const [X, Y] = toFrame(d.key, d.o.R, dx, dy);
      d.o.w = X - d.X0;
      d.o.h = Y - d.Y0;
      if (e.shiftKey && (d.o.kind === 'rect' || d.o.kind === 'ellipse')) {
        const s = Math.max(Math.abs(d.o.w), Math.abs(d.o.h));
        d.o.w = Math.sign(d.o.w || 1) * s; d.o.h = Math.sign(d.o.h || 1) * s;
      }
      scheduleCompose();
    } else if (d.kind === 'move' || d.kind === 'resize') {
      const ddx = e.clientX - d.x0, ddy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(ddx, ddy) < 4) return;
      d.moved = true;
      const o = V.sel.obj;
      const [fx, fy] = invDelta(cssMatrix(d.key, o.R || 0), ddx, ddy);
      const g = d.orig;
      if (d.kind === 'move') {
        if (o.type === 'ink') o.pts = g.pts.map((q) => [q[0] + fx, q[1] + fy]);
        else { o.x = g.x + fx; o.y = g.y + fy; }
      } else if (o.type === 'tbox') {
        if (g.auto) { g.w = layoutText(g).w; delete o.auto; }
        o.w = Math.max(o.size + 2 * PAD, g.w + fx);
      } else if (o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow')) {
        o.w = g.w + fx; o.h = g.h + fy;
      } else if (o.type === 'image' && !e.shiftKey) {
        const w = Math.max(10, g.w + fx);
        o.w = w; o.h = w * g.h / g.w; // mantiene le proporzioni
      } else {
        o.w = Math.max(4, g.w + fx); o.h = Math.max(4, g.h + fy);
      }
      scheduleCompose();
    }
  });

  function endPointer(e, cancelled) {
    const d = V.drag;
    if (!d || e.pointerId !== d.id) return;
    V.drag = null;
    if (d.kind === 'tap') {
      if (!cancelled && Date.now() - d.t0 < 800) handleTap(d.key, d.dx, d.dy);
      return;
    }
    if (d.kind === 'ink') {
      if (cancelled) { compose(d.key); return; }
      pushUndo();
      anns(d.key).push(d.o);
      changed([d.key]);
    } else if (d.kind === 'erase') {
      if (d.changed) changed([d.key]);
    } else if (d.kind === 'shape') {
      if (cancelled) { compose(d.key); return; }
      const o = d.o;
      const line = o.kind === 'line' || o.kind === 'arrow';
      if (Math.abs(o.w) < 4 && Math.abs(o.h) < 4) { o.w = 120; o.h = line ? 0 : 70; } // tocco singolo: dimensione predefinita
      if (!line) { if (o.w < 0) { o.x += o.w; o.w = -o.w; } if (o.h < 0) { o.y += o.h; o.h = -o.h; } }
      pushUndo();
      anns(d.key).push(o);
      changed([d.key]);
      setTool('select');
      select(d.key, o);
    } else if (d.kind === 'move' || d.kind === 'resize') {
      if (d.moved) { pushUndo(d.snap); changed([d.key]); }
      else if (d.kind === 'move' && V.sel && V.sel.obj.type === 'tbox') startEdit(d.key, V.sel.obj);
    }
  }
  ui.inner.addEventListener('pointerup', (e) => endPointer(e, false));
  ui.inner.addEventListener('pointercancel', (e) => endPointer(e, true));

  async function handleTap(key, dx, dy) {
    const wasEditing = !!V.editing;
    const hadSel = !!V.sel;
    commitEdit();
    if (V.tool === 'textbox') {
      const R = rotOf(key);
      const [X, Y] = toFrame(key, R, dx, dy);
      const d = fdims(key, R);
      const snap = snapshot();
      const st = V.style;
      const o = {
        type: 'tbox', R, x: X, y: Y, w: Math.max(60, Math.min(d.w * 0.5, d.w - X - 8)),
        size: st.size, font: st.font, bold: st.bold, italic: st.italic, underline: st.underline,
        color: st.color, hl: null, align: st.align, text: '',
      };
      anns(key).push(o);
      setTool('select');
      startEdit(key, o, { snapshot: snap });
      return;
    }
    const hit = hitObj(key, dx, dy);
    if (hit) {
      if (V.sel && V.sel.obj === hit && hit.type === 'tbox') startEdit(key, hit);
      else select(key, hit);
      return;
    }
    if (wasEditing || hadSel) { deselect(); return; } // il primo tocco toglie solo la selezione
    if (srcOf(key)) {
      const run = await runAt(key, dx, dy);
      if (run) { startReplace(key, run); return; }
    }
    deselect();
  }

  // ---------- Comandi sugli oggetti ----------
  function deleteSel() {
    if (V.editing) { const { key, o } = V.editing; ta.value = ''; o.text = ''; V.editing.styled = true; commitEdit(); compose(key); return; }
    if (!V.sel) { App.toast('Seleziona prima un elemento'); return; }
    const { key, obj } = V.sel;
    pushUndo();
    const list = anns(key);
    list.splice(list.indexOf(obj), 1);
    V.sel = null;
    changed([key]);
    syncRibbon();
  }
  function copySel() {
    const o = V.editing ? V.editing.o : V.sel && V.sel.obj;
    if (!o) { App.toast('Seleziona prima un elemento'); return false; }
    V.clip = clone(o);
    App.toast('Copiato');
    return true;
  }
  function offsetObj(o, d) {
    if (o.type === 'ink') o.pts = o.pts.map((q) => [q[0] + d, q[1] + d]);
    else { o.x += d; o.y += d; }
    delete o.whiteout;
  }
  function pasteClip() {
    if (!V.clip) { App.toast('Niente da incollare'); return; }
    commitEdit();
    const key = currentKey();
    if (!key) return;
    const o = clone(V.clip);
    offsetObj(o, 12);
    pushUndo();
    anns(key).push(o);
    changed([key]);
    select(key, o);
  }
  function duplicateSel() {
    commitEdit();
    if (!V.sel) { App.toast('Seleziona prima un elemento'); return; }
    const { key, obj } = V.sel;
    const o = clone(obj);
    offsetObj(o, 12);
    pushUndo();
    anns(key).push(o);
    changed([key]);
    select(key, o);
  }

  // ---------- Stile del testo ----------
  function textTarget() {
    if (V.editing) return V.editing.o;
    if (V.sel && V.sel.obj.type === 'tbox') return V.sel.obj;
    return null;
  }
  function applyText(patch) {
    const t = textTarget();
    if (t) {
      if (!V.editing) pushUndo();
      Object.assign(t, patch);
      if (V.editing) { V.editing.styled = true; styleEditor(); ta.focus({ preventScroll: true }); }
      else changed([V.sel.key]);
    }
    Object.assign(V.style, patch);
    App.store.set('textStyle', V.style);
    syncRibbon();
  }
  function shapeTarget() { return V.sel && V.sel.obj.type === 'shape' ? V.sel.obj : null; }
  function applyShape(patch) {
    const s = shapeTarget();
    if (s) { pushUndo(); Object.assign(s, patch); changed([V.sel.key]); }
    Object.assign(V.shape, patch);
    App.store.set('shapeStyle', V.shape);
    syncRibbon();
  }

  function setBar(el, color) {
    el.classList.toggle('none', !color);
    el.style.background = color || '';
  }
  function syncRibbon() {
    const t = textTarget() || V.style;
    ui.fFamily.value = t.font || 'sans';
    if (document.activeElement !== ui.fSize) ui.fSize.value = t.size;
    $('bBold').classList.toggle('on', !!t.bold);
    $('bItalic').classList.toggle('on', !!t.italic);
    $('bUnderline').classList.toggle('on', !!t.underline);
    document.querySelectorAll('[data-cmd="align"]').forEach((b) => b.classList.toggle('on', (t.align || 'left') === b.dataset.align));
    setBar(ui.fcBar, V.style.color);
    setBar(ui.hlBar, V.style.hl);
    const s = shapeTarget() || V.shape;
    setBar(ui.stBar, s.stroke);
    setBar(ui.flBar, s.fill);
  }

  // ---------- Strumenti ----------
  const TOOL_HINTS = {
    select: 'Tocca un testo del PDF per modificarlo, o un elemento per selezionarlo.',
    textbox: 'Tocca la pagina dove vuoi inserire la casella di testo.',
    pen: 'Disegna con un dito. Con due dita scorri o ingrandisci.',
    hl: 'Passa sopra il testo da evidenziare.',
    eraser: 'Passa sui tratti a mano da cancellare.',
    rect: 'Trascina sulla pagina per disegnare la forma.',
    ellipse: 'Trascina sulla pagina per disegnare la forma.',
    line: 'Trascina sulla pagina per disegnare la linea.',
    arrow: 'Trascina sulla pagina per disegnare la freccia.',
  };
  function setHint(t) { ui.sbHint.textContent = t || TOOL_HINTS[V.tool] || ''; }
  function setTool(tool) {
    V.tool = tool;
    ui.body.classList.toggle('tool-draw', V.editMode && tool !== 'select' && tool !== 'textbox');
    ui.body.classList.toggle('tool-text', V.editMode && tool === 'textbox');
    document.querySelectorAll('[data-cmd="tool"]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    document.querySelectorAll('[data-cmd="inkWidth"]').forEach((b) => {
      const t = tool === 'hl' ? 'hl' : 'pen';
      b.classList.toggle('on', Number(b.dataset.w) === V.ink[t].w);
    });
    renderInkSwatches();
    if (tool !== 'select') deselect();
    setHint();
  }
  function renderInkSwatches() {
    const t = V.tool === 'hl' ? 'hl' : 'pen';
    ui.inkSwatches.innerHTML = '';
    INK_COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.setAttribute('aria-label', 'Colore ' + c);
      b.classList.toggle('on', V.ink[t].color === c);
      b.addEventListener('click', () => {
        V.ink[t].color = c;
        App.store.set('ink', V.ink);
        if (V.tool !== 'pen' && V.tool !== 'hl') setTool(t);
        else renderInkSwatches();
      });
      ui.inkSwatches.appendChild(b);
    });
  }

  // ---------- Pagine ----------
  function currentKey() {
    if (V.sel) return V.sel.key;
    if (V.editing) return V.editing.key;
    return V.curKey || getOrder()[0];
  }
  function pageOp(fn) {
    commitEdit();
    deselect();
    const key = currentKey();
    if (!key) return;
    pushUndo();
    const res = fn(key);
    if (res === false) { V.undo.pop(); updateUndo(); return; }
    syncDom();
    changed([]);
    if (typeof res === 'string') setTimeout(() => scrollToKey(res), 50);
  }
  function rotatePage(dir) {
    pageOp((key) => {
      edits().rot[key] = norm360((edits().rot[key] || 0) + dir * 90);
      const p = V.pages[key];
      p.renderedKey = null;
      p.runs = null;
      return key;
    });
  }
  function movePage(dir) {
    pageOp((key) => {
      const o = getOrder();
      const i = o.indexOf(key), j = i + dir;
      if (j < 0 || j >= o.length) { App.toast(dir < 0 ? 'È già la prima pagina' : 'È già l\'ultima pagina'); return false; }
      [o[i], o[j]] = [o[j], o[i]];
      edits().order = o;
      return key;
    });
  }
  const newKey = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function insertBlank() {
    pageOp((key) => {
      const d = dispPt(key);
      const nk = newKey('b');
      edits().extra[nk] = { blank: { w: d.w, h: d.h } };
      const o = getOrder();
      o.splice(o.indexOf(key) + 1, 0, nk);
      edits().order = o;
      return nk;
    });
  }
  function duplicatePage() {
    pageOp((key) => {
      const nk = newKey('d');
      const ex = edits().extra[key];
      edits().extra[nk] = ex && ex.blank ? { blank: clone(ex.blank) } : { src: srcOf(key) };
      if (edits().rot[key]) edits().rot[nk] = edits().rot[key];
      if (edits().ann[key]) edits().ann[nk] = clone(edits().ann[key]);
      const o = getOrder();
      o.splice(o.indexOf(key) + 1, 0, nk);
      edits().order = o;
      return nk;
    });
  }
  function deletePage(key, del) {
    commitEdit();
    deselect();
    pushUndo();
    if (del) edits().del[key] = true; else delete edits().del[key];
    syncDom();
    changed([]);
    if (del) App.toast('Pagina eliminata. Puoi ripristinarla o usare Annulla.', 3000);
  }
  function scrollToKey(key) {
    const p = V.pages[key];
    if (p) ui.scroll.scrollTop = p.box.offsetTop - 6;
  }

  function updateStatus() {
    if (!V.built) return;
    const order = getOrder();
    const sc = ui.scroll;
    const mid = sc.scrollTop + sc.clientHeight * 0.35;
    let cur = order[0];
    for (const key of order) {
      const p = V.pages[key];
      if (p && p.box.offsetTop <= mid) cur = key; else break;
    }
    if (cur !== V.curKey) {
      if (V.curKey && V.pages[V.curKey]) V.pages[V.curKey].box.classList.remove('current');
      V.curKey = cur;
      if (V.pages[cur]) V.pages[cur].box.classList.add('current');
    }
    ui.sbPage.textContent = 'Pagina ' + (order.indexOf(cur) + 1) + ' di ' + order.length;
  }
  let statusRaf = false;
  ui.scroll.addEventListener('scroll', () => {
    if (statusRaf) return;
    statusRaf = true;
    requestAnimationFrame(() => { statusRaf = false; updateStatus(); });
  }, { passive: true });

  // ---------- Immagini ----------
  function saveImages() {
    if (S.bookKey) App.idb.put('imgs:' + S.bookKey, V.images).catch(() => {});
  }
  function insertImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Ridimensiona le foto grandi per non appesantire il PDF.
        const max = 1600;
        const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * sc));
        c.height = Math.max(1, Math.round(img.naturalHeight * sc));
        const g = c.getContext('2d');
        const png = /png|gif|svg/i.test(file.type);
        if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(img, 0, 0, c.width, c.height);
        const url = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
        const id = newKey('i');
        V.images[id] = url;
        saveImages();
        const key = currentKey();
        const R = rotOf(key);
        const d = fdims(key, R);
        let w = d.w * 0.5, h = w * c.height / c.width;
        if (h > d.h * 0.6) { h = d.h * 0.6; w = h * c.width / c.height; }
        const o = { type: 'image', R, img: id, x: (d.w - w) / 2, y: (d.h - h) / 3, w, h };
        pushUndo();
        anns(key).push(o);
        setTool('select');
        changed([key]);
        select(key, o);
      };
      img.onerror = () => App.toast('Formato immagine non supportato');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------- Esportazione PDF ----------
  function hexToRgb(hex) {
    let h = (hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  function hexA(hex, a) {
    let h = (hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  let lastBlob = null;
  let lastName = '';

  async function buildPdf() {
    await ensureMetrics();
    const { PDFDocument, degrees, LineCapStyle, BlendMode } = PDFLib;
    const order = getOrder().filter((k) => !edits().del[k]);
    if (!order.length) throw new Error('nessuna pagina');
    const src = await PDFDocument.load(S.bytes, { ignoreEncryption: true, updateMetadata: false });
    const N = src.getPageCount();
    const identity = order.every((k, i, a) => !edits().extra[k] && (i === 0 || Number(k) > Number(a[i - 1])));
    let doc;
    const pageOf = {};
    if (identity) {
      // Stesso ordine: si modifica il documento originale (segnalibri e link restano).
      doc = src;
      const pages = doc.getPages();
      order.forEach((k) => { pageOf[k] = pages[Number(k) - 1]; });
    } else {
      doc = await PDFDocument.create();
      const first = [];
      const seen = new Set();
      order.forEach((k) => { const s = srcOf(k); if (s && !seen.has(s)) { seen.add(s); first.push(s - 1); } });
      const copied = first.length ? await doc.copyPages(src, first) : [];
      const bySrc = {};
      first.forEach((ix, i) => { bySrc[ix + 1] = copied[i]; });
      const used = new Set();
      for (const k of order) {
        const s = srcOf(k);
        if (!s) { const b = edits().extra[k].blank; pageOf[k] = doc.addPage([b.w, b.h]); }
        else if (!used.has(s)) { used.add(s); pageOf[k] = doc.addPage(bySrc[s]); }
        else { const [c] = await doc.copyPages(src, [s - 1]); pageOf[k] = doc.addPage(c); }
      }
    }

    const fontCache = {};
    const getFont = async (name) => fontCache[name] || (fontCache[name] = await doc.embedFont(name));
    const imgCache = {};
    const getImg = async (id) => {
      if (imgCache[id]) return imgCache[id];
      const url = V.images[id];
      if (!url) return null;
      imgCache[id] = /^data:image\/png/.test(url) ? await doc.embedPng(url) : await doc.embedJpg(url);
      return imgCache[id];
    };

    for (const k of order) {
      const page = pageOf[k];
      const cb = page.getCropBox();
      const extraRot = edits().rot[k] || 0;
      const total = norm360((page.getRotation().angle || 0) + extraRot);
      if (extraRot) page.setRotation(degrees(total));
      const W = cb.width, H = cb.height;
      const toUser = (R, X, Y) => {
        const d = R % 180 ? { w: H, h: W } : { w: W, h: H };
        const uv = fromDisp(X / d.w, Y / d.h, R);
        return [cb.x + uv[0] * W, cb.y + (1 - uv[1]) * H];
      };
      const svg = (R, path, opts) => {
        const [ox, oy] = toUser(R, 0, 0);
        page.drawSvgPath(path, Object.assign({ x: ox, y: oy, rotate: degrees(R) }, opts));
      };
      for (const o of (edits().ann[k] || [])) {
        const R = o.R || 0;
        if (o.type === 'ink' && o.pts.length) {
          const opts = { borderColor: hexToRgb(o.color), borderWidth: o.width, borderLineCap: LineCapStyle.Round };
          if (o.tool === 'hl') { opts.borderOpacity = HL_OPACITY; opts.blendMode = BlendMode.Multiply; }
          svg(R, inkPath(o), opts);
        } else if (o.type === 'shape') {
          const opts = {};
          const line = o.kind === 'line' || o.kind === 'arrow';
          if (o.fill && !line) opts.color = hexToRgb(o.fill);
          if (o.stroke && o.sw > 0) { opts.borderColor = hexToRgb(o.stroke); opts.borderWidth = o.sw; opts.borderLineCap = LineCapStyle.Round; }
          else opts.borderWidth = 0;
          if (opts.color || opts.borderColor) svg(R, shapePath(o), opts);
        } else if (o.type === 'image') {
          const img = await getImg(o.img);
          if (!img) continue;
          const [x, y] = toUser(R, o.x, o.y + o.h);
          page.drawImage(img, { x, y, width: o.w, height: o.h, rotate: degrees(R) });
        } else if (o.type === 'tbox') {
          const L = layoutText(o);
          const font = await getFont(L.name);
          if (o.hl) for (const l of L.lines) if (l.width > 0) svg(R, rectPath(l.x, l.top, l.width, o.size * LH), { color: hexToRgb(o.hl), borderWidth: 0 });
          const color = hexToRgb(o.color || '#000000');
          for (const l of L.lines) {
            for (const s of l.segs) {
              if (!s.t) continue;
              const [x, y] = toUser(R, s.x, l.base);
              page.drawText(s.t, { x, y, size: o.size, font, color, rotate: degrees(R) });
            }
            if (o.underline && l.width > 0) svg(R, rectPath(l.x, l.base + o.size * 0.1, l.width, Math.max(0.5, o.size * 0.06)), { color, borderWidth: 0 });
          }
        }
      }
    }
    if (identity) {
      const keep = new Set(order.map(Number));
      for (let n = N; n >= 1; n--) if (!keep.has(n)) doc.removePage(n - 1);
    }
    return doc.save();
  }

  async function exportPdf(share) {
    if (!S.pdf) return;
    commitEdit();
    if (!getOrder().some((k) => !edits().del[k])) { alert('Hai eliminato tutte le pagine: ripristinane almeno una.'); return; }
    App.showLoading('Creo il PDF…');
    try {
      const bytes = await buildPdf();
      lastBlob = new Blob([bytes], { type: 'application/pdf' });
      lastName = S.bookName.replace(/\.pdf$/i, '') + ' (modificato).pdf';
      App.hideLoading();
      const pages = getOrder().filter((k) => !edits().del[k]).length;
      const mb = (lastBlob.size / 1048576).toFixed(1);
      ui.saveInfo.textContent = '«' + lastName + '» — ' + pages + (pages === 1 ? ' pagina' : ' pagine') + ', ' + mb + ' MB. Il file originale non viene toccato.';
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([lastBlob], lastName, { type: 'application/pdf' })] }));
      ui.shareBtn.classList.toggle('hidden', !canShare);
      if (share && canShare) { shareBlob(); return; }
      ui.saveDialog.returnValue = '';
      ui.saveDialog.showModal();
    } catch (err) {
      App.hideLoading();
      console.error(err);
      alert('Non è stato possibile creare il PDF. Il file potrebbe essere protetto.');
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
  function shareBlob() {
    const file = new File([lastBlob], lastName, { type: 'application/pdf' });
    navigator.share({ files: [file], title: lastName }).catch((err) => { if (err && err.name !== 'AbortError') downloadBlob(); });
  }
  ui.saveDialog.addEventListener('close', () => {
    if (!lastBlob) return;
    if (ui.saveDialog.returnValue === 'download') downloadBlob();
    else if (ui.saveDialog.returnValue === 'share') shareBlob();
  });

  // ---------- Zoom ----------
  function setZoom(z, anchor) {
    z = clampZoom(z);
    if (Math.abs(z - V.zoom) < 0.001) return;
    const sc = ui.scroll;
    const rect = sc.getBoundingClientRect();
    const ax = anchor ? anchor.x - rect.left : sc.clientWidth / 2;
    const ay = anchor ? anchor.y - rect.top : sc.clientHeight / 2;
    const cx = sc.scrollLeft + ax, cy = sc.scrollTop + ay;
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
  function fitPage() {
    const key = currentKey();
    if (!key) return;
    const d = dispPt(key);
    const avail = ui.scroll.clientHeight - 50;
    setZoom(avail / (baseWidth() * d.h / d.w));
    setTimeout(() => scrollToKey(key), 30);
  }

  // Due dita: pizzico per lo zoom e trascinamento per scorrere (anche mentre si disegna).
  let pinch = null;
  const tdist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const tmid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  ui.scroll.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    const mid = tmid(e.touches);
    const rect = ui.scroll.getBoundingClientRect();
    pinch = { d0: tdist(e.touches), mid0: mid, mid, ratio: 1 };
    ui.inner.style.transformOrigin =
      (ui.scroll.scrollLeft + mid.x - rect.left - ui.inner.offsetLeft) + 'px ' +
      (ui.scroll.scrollTop + mid.y - rect.top - ui.inner.offsetTop) + 'px';
  }, { passive: true });
  ui.scroll.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    pinch.ratio = Math.min(ZOOM_MAX / V.zoom, Math.max(ZOOM_MIN / V.zoom, tdist(e.touches) / pinch.d0));
    pinch.mid = tmid(e.touches);
    const tx = pinch.mid.x - pinch.mid0.x, ty = pinch.mid.y - pinch.mid0.y;
    ui.inner.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + pinch.ratio + ')';
    ui.zoomLabel.textContent = ui.sbZoomVal.textContent = Math.round(V.zoom * pinch.ratio * 100) + '%';
  }, { passive: false });
  const endPinch = (e) => {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch;
    pinch = null;
    ui.inner.style.transform = '';
    if (Math.abs(p.ratio - 1) > 0.02) setZoom(V.zoom * p.ratio, p.mid0);
    else layoutAll();
    ui.scroll.scrollLeft -= p.mid.x - p.mid0.x;
    ui.scroll.scrollTop -= p.mid.y - p.mid0.y;
  };
  ui.scroll.addEventListener('touchend', endPinch);
  ui.scroll.addEventListener('touchcancel', endPinch);

  // ---------- Tavolozza colori ----------
  let paletteFor = null;
  function openPalette(kind, anchor) {
    paletteFor = kind;
    const colors = kind === 'hl' ? HL_PALETTE : PALETTE;
    const title = { font: 'Colore carattere', hl: 'Colore evidenziazione', stroke: 'Contorno forma', fill: 'Riempimento forma' }[kind];
    let html = '<h3>' + title + '</h3><div class="pgrid">';
    colors.forEach((c) => { html += '<button type="button" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>'; });
    html += '</div>';
    if (kind !== 'font') html += '<button type="button" class="pnone" data-color="">' + (kind === 'hl' ? 'Nessun colore' : kind === 'fill' ? 'Nessun riempimento' : 'Nessun contorno') + '</button>';
    ui.palette.innerHTML = html;
    ui.palette.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const pw = 232;
    ui.palette.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left - pw / 2)) + 'px';
    ui.palette.style.top = (r.bottom + 4) + 'px';
  }
  function closePalette() { ui.palette.classList.add('hidden'); paletteFor = null; }
  ui.palette.addEventListener('pointerdown', (e) => e.preventDefault());
  ui.palette.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    const c = b.dataset.color || null;
    const kind = paletteFor;
    closePalette();
    if (kind === 'font') { V.style.color = c; applyText({ color: c }); }
    else if (kind === 'hl') { V.style.hl = c; applyText({ hl: c }); }
    else if (kind === 'stroke') applyShape({ stroke: c, sw: c ? (V.shape.sw || 2) : 0 });
    else if (kind === 'fill') applyShape({ fill: c });
  });
  document.addEventListener('pointerdown', (e) => {
    if (!ui.palette.classList.contains('hidden') && !e.target.closest('#palette, [data-pop]')) closePalette();
  });

  // ---------- Barra multifunzione ----------
  // I pulsanti non rubano il fuoco alla casella di testo in modifica.
  $('editorTop').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') && !e.target.closest('select, input')) e.preventDefault();
  });
  ui.tabs.forEach((t) => t.addEventListener('click', () => {
    ui.tabs.forEach((x) => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', String(x === t)); });
    document.querySelectorAll('.rpanel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
    App.store.set('ribbonTab', t.dataset.tab);
  }));

  const COMMANDS = {
    save: () => exportPdf(false),
    share: () => exportPdf(true),
    open: () => { setEditMode(false); ui.fileInput.click(); },
    discard: () => {
      if (!confirm('Annullare tutte le modifiche a questo documento?')) return;
      commitEdit();
      pushUndo();
      restore(JSON.stringify(App.emptyEdits()));
      App.toast('Modifiche annullate. Puoi ancora usare Annulla.');
    },
    close: () => setEditMode(false),
    paste: pasteClip,
    cut: () => { if (copySel()) deleteSel(); },
    copy: copySel,
    duplicate: duplicateSel,
    grow: () => { const t = textTarget() || V.style; applyText({ size: Math.min(200, nextSize(t.size, 1)) }); },
    shrink: () => { const t = textTarget() || V.style; applyText({ size: Math.max(4, nextSize(t.size, -1)) }); },
    bold: () => applyText({ bold: !(textTarget() || V.style).bold }),
    italic: () => applyText({ italic: !(textTarget() || V.style).italic }),
    underline: () => applyText({ underline: !(textTarget() || V.style).underline }),
    fontColor: () => applyText({ color: V.style.color }),
    hlColor: () => { const t = textTarget(); applyText({ hl: t && t.hl ? null : V.style.hl }); },
    align: (b) => applyText({ align: b.dataset.align }),
    delete: deleteSel,
    tool: (b) => { commitEdit(); setTool(b.dataset.tool); },
    image: () => { commitEdit(); ui.imgInput.click(); },
    shapeStroke: () => applyShape({ stroke: V.shape.stroke || '#0070c0', sw: V.shape.sw || 2 }),
    shapeFill: () => applyShape({ fill: V.shape.fill || '#ffc000' }),
    inkWidth: (b) => {
      const t = V.tool === 'hl' ? 'hl' : 'pen';
      V.ink[t].w = Number(b.dataset.w);
      App.store.set('ink', V.ink);
      setTool(V.tool === 'hl' || V.tool === 'pen' ? V.tool : 'pen');
    },
    rotL: () => rotatePage(-1),
    rotR: () => rotatePage(1),
    moveUp: () => movePage(-1),
    moveDown: () => movePage(1),
    blankPage: insertBlank,
    dupPage: duplicatePage,
    delPage: () => { const k = currentKey(); if (k) deletePage(k, true); },
    zoomIn: () => zoomStep(1),
    zoomOut: () => zoomStep(-1),
    fitWidth: () => setZoom(1),
    fitPage,
    readMode: () => { setEditMode(false); App.showView('viewListen'); },
  };
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
  function nextSize(s, dir) {
    if (dir > 0) return SIZES.find((x) => x > s + 0.01) || s + 12;
    return SIZES.slice().reverse().find((x) => x < s - 0.01) || Math.max(4, s - 1);
  }

  ui.ribbon.addEventListener('click', (e) => {
    const pop = e.target.closest('[data-pop]');
    if (pop) { openPalette(pop.dataset.pop, pop); return; }
    const b = e.target.closest('[data-cmd]');
    if (!b || !COMMANDS[b.dataset.cmd]) return;
    COMMANDS[b.dataset.cmd](b);
  });
  ui.fFamily.addEventListener('change', () => applyText({ font: ui.fFamily.value }));
  ui.fSize.addEventListener('change', () => {
    const v = parseFloat(String(ui.fSize.value).replace(',', '.'));
    if (v >= 4 && v <= 200) applyText({ size: v });
    else syncRibbon();
  });
  ui.imgInput.addEventListener('change', () => { const f = ui.imgInput.files[0]; ui.imgInput.value = ''; insertImage(f); });

  ctxBar.addEventListener('pointerdown', (e) => e.stopPropagation());
  ctxBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ctx]');
    if (!b || !V.sel) return;
    const a = b.dataset.ctx;
    if (a === 'edit') startEdit(V.sel.key, V.sel.obj);
    else if (a === 'copy') copySel();
    else if (a === 'duplicate') duplicateSel();
    else if (a === 'delete') deleteSel();
  });

  ui.edUndo.addEventListener('click', undo);
  ui.edRedo.addEventListener('click', redo);
  ui.edSave.addEventListener('click', () => exportPdf(false));
  ui.edClose.addEventListener('click', () => setEditMode(false));
  ui.sbZoom.addEventListener('input', () => setZoom(Number(ui.sbZoom.value) / 100));
  ui.sbZoomIn.addEventListener('click', () => zoomStep(1));
  ui.sbZoomOut.addEventListener('click', () => zoomStep(-1));

  // Tocco sullo sfondo grigio: toglie la selezione.
  ui.scroll.addEventListener('click', (e) => {
    if (V.editMode && !e.target.closest('.pagearea')) { commitEdit(); deselect(); }
  });

  document.addEventListener('keydown', (e) => {
    if (!V.editMode || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const inText = e.target === ta;
    const inField = !inText && e.target.matches('input, select, textarea');
    const k = e.key.toLowerCase();
    if (mod && k === 'b') { e.preventDefault(); COMMANDS.bold(); return; }
    if (mod && k === 'i') { e.preventDefault(); COMMANDS.italic(); return; }
    if (mod && k === 'u') { e.preventDefault(); COMMANDS.underline(); return; }
    if (mod && k === 's') { e.preventDefault(); exportPdf(false); return; }
    if (e.key === 'Escape') { if (V.editing) commitEdit(); else deselect(); closePalette(); return; }
    if (inText || inField) return;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && k === 'c') { e.preventDefault(); copySel(); }
    else if (mod && k === 'x') { e.preventDefault(); if (copySel()) deleteSel(); }
    else if (mod && k === 'v') { e.preventDefault(); pasteClip(); }
    else if (mod && k === 'd') { e.preventDefault(); duplicateSel(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && V.sel) { e.preventDefault(); deleteSel(); }
  });

  // ---------- Modalità modifica ----------
  async function setEditMode(on) {
    if (on === V.editMode) return;
    if (on) {
      V.editMode = true;
      if (App.state.mode === 'playing') App.pause();
      ui.body.classList.add('editor-mode');
      ui.edDocName.textContent = S.bookName.replace(/\.pdf$/i, '');
      const tab = App.store.get('ribbonTab', 'home');
      const btn = document.querySelector('.rtab[data-tab="' + tab + '"]') || ui.tabs[1];
      btn.click();
      setTool('select');
      syncRibbon();
      updateUndo();
      ensureMetrics();
      if (S.view !== 'viewPages') App.showView('viewPages');
      setTimeout(() => { layoutAll(); updateStatus(); }, 30);
    } else {
      commitEdit();
      deselect();
      closePalette();
      V.editMode = false;
      ui.body.classList.remove('editor-mode', 'tool-draw', 'tool-text');
      setTimeout(() => { layoutAll(); }, 30);
    }
  }

  // ---------- Lettura ----------
  function markReading() {
    if (!V.built) return;
    Object.values(V.pages).forEach((p) => p.box.classList.toggle('reading', p.key === String(S.page) && S.mode !== 'stopped'));
    ui.miniInfo.textContent = 'Pag. ' + S.page + '/' + pageCount();
  }

  ui.inner.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const key = b.closest('.pagebox').dataset.key;
    if (b.dataset.act === 'read') {
      const n = srcOf(key);
      if (!n) return;
      App.goToPage(n).then(() => App.play());
      App.toast('Lettura dalla pagina ' + n);
    } else if (b.dataset.act === 'restore') deletePage(key, false);
  });

  ui.zoomIn.addEventListener('click', () => zoomStep(1));
  ui.zoomOut.addEventListener('click', () => zoomStep(-1));
  ui.miniPlay.addEventListener('click', () => App.togglePlay());
  ui.editToggle.addEventListener('click', () => setEditMode(true));

  App.events.addEventListener('bookloaded', () => {
    setEditMode(false);
    V.built = false;
    V.needsScroll = true;
    V.undo = [];
    V.redo = [];
    V.sel = null;
    V.curKey = null;
    V.images = {};
    V.imgEls = {};
    if (V.observer) V.observer.disconnect();
    Object.values(V.pages).forEach(freePage);
    ui.inner.innerHTML = '';
    V.pages = {};
    const key = S.bookKey;
    App.idb.get('imgs:' + key).then((imgs) => {
      if (imgs && S.bookKey === key) { V.images = imgs; redrawVisible(); }
    }).catch(() => {});
  });

  App.events.addEventListener('viewchange', async (e) => {
    const on = e.detail.view === 'viewPages';
    ui.bar.classList.toggle('hidden', !on);
    if (!on) { if (V.editMode) setEditMode(false); return; }
    if (!V.built) await build();
    else if (ui.scroll.clientWidth !== V.lastWidth) layoutAll();
    markReading();
    if (V.needsScroll) { V.needsScroll = false; scrollToKey(String(S.page)); }
    updateStatus();
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
      if (!V.built || S.view !== 'viewPages' || ui.scroll.clientWidth === V.lastWidth) {
        positionSel();
        if (V.editing) styleEditor();
        return;
      }
      const sc = ui.scroll;
      const ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
      layoutAll();
      sc.scrollTop = ratio * sc.scrollHeight;
    }, 200);
  });

  // Carica in anticipo le metriche dei caratteri (servono per i testi).
  setTimeout(() => ensureMetrics(), 1500);
  ui.zoomLabel.textContent = Math.round(V.zoom * 100) + '%';
  syncRibbon();

  // Utile per i test automatici.
  App.editor = { V, getOrder, buildPdf, setEditMode, layoutText };
})();
