/* Codifica MP3 in background (lamejs, LGPL-3.0): riceve campioni a 16 bit e restituisce l'MP3. */
'use strict';
importScripts('lame.min.js');
/* global lamejs */
self.onmessage = (e) => {
  const { id, pcm, sampleRate, kbps } = e.data;
  try {
    const enc = new lamejs.Mp3Encoder(1, sampleRate, kbps || 48);
    const parts = [];
    let size = 0;
    const BLOCK = 1152 * 8;
    for (let i = 0; i < pcm.length; i += BLOCK) {
      const b = enc.encodeBuffer(pcm.subarray(i, i + BLOCK));
      if (b.length) { parts.push(b); size += b.length; }
    }
    const f = enc.flush();
    if (f.length) { parts.push(f); size += f.length; }
    const out = new Uint8Array(size);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    self.postMessage({ id, mp3: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
