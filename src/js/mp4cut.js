/* VIGÍA · mp4cut.js
 * Corte de MP4 SIN RECODIFICAR (copia de flujo), equivalente a:
 *   ffmpeg -ss <inicio_clave> -i original.mp4 -t <dur> -c copy -map 0:v -map 0:a clip.mp4
 * - Usa mp4box.js (BSD-3) sólo para LEER las tablas de muestras del 'moov'.
 * - Copia BYTE A BYTE la caja 'stsd' original (configuración del códec) y los datos de muestra.
 * - El inicio se alinea al fotograma clave (sync sample) anterior al instante pedido: el clip real
 *   puede empezar antes de lo solicitado; los límites reales se devuelven y se registran.
 * - No soporta MP4 fragmentado (moof); en ese caso lanza NO_SOPORTADO y la app usa la ruta alternativa.
 * Funciona en navegador y en Node (se exporta en module.exports para pruebas). */
(function (root) {
  'use strict';

  function MP4CutError(code, message) { const e = new Error(message); e.code = code; return e; }

  // ---------- lectura de cajas de nivel superior ----------
  async function scanTopLevel(reader) {
    const boxes = []; let pos = 0;
    while (pos + 8 <= reader.size) {
      const h = await reader.read(pos, Math.min(16, reader.size - pos));
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      let size = dv.getUint32(0); const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
      let hdr = 8;
      if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; }
      else if (size === 0) { size = reader.size - pos; }
      if (size < hdr) throw MP4CutError('MP4_INVALIDO', 'Caja MP4 con tamaño inválido en ' + pos);
      boxes.push({ type, start: pos, size, hdr });
      pos += size;
      if (boxes.length > 10000) break;
    }
    return boxes;
  }

  function getMP4Box() {
    if (root.MP4Box) return root.MP4Box;
    if (typeof require === 'function') return require('mp4box');
    throw MP4CutError('DEPENDENCIA', 'mp4box.js no disponible');
  }

  // Analiza ftyp+moov y devuelve pistas con muestras (offsets absolutos del archivo original)
  async function parseMovie(reader) {
    const boxes = await scanTopLevel(reader);
    if (boxes.some(b => b.type === 'moof')) throw MP4CutError('NO_SOPORTADO', 'MP4 fragmentado (moof): el corte sin recodificar no está soportado');
    const ftyp = boxes.find(b => b.type === 'ftyp');
    const moov = boxes.find(b => b.type === 'moov');
    if (!ftyp || !moov) throw MP4CutError('MP4_INVALIDO', 'El archivo no contiene ftyp/moov');
    if (moov.size > 256 * 1024 * 1024) throw MP4CutError('MP4_INVALIDO', 'moov demasiado grande');
    const ftypBytes = await reader.read(ftyp.start, ftyp.size);
    const moovBytes = await reader.read(moov.start, moov.size);
    const synth = new Uint8Array(ftypBytes.length + moovBytes.length);
    synth.set(ftypBytes, 0); synth.set(moovBytes, ftypBytes.length);
    const MP4Box = getMP4Box();
    const f = MP4Box.createFile(false);
    let info = null; let err = null;
    f.onReady = i => { info = i; };
    f.onError = e => { err = e; };
    const ab = synth.buffer.slice(0); ab.fileStart = 0;
    f.appendBuffer(ab); f.flush();
    if (err) throw MP4CutError('MP4_INVALIDO', String(err));
    if (!info) throw MP4CutError('MP4_INVALIDO', 'No se pudo leer el índice (moov)');
    const tracks = [];
    for (const t of info.tracks) {
      const trak = f.getTrackById(t.id);
      const handler = trak.mdia.hdlr.handler;
      if (handler !== 'vide' && handler !== 'soun') continue;
      const stsd = trak.mdia.minf.stbl.stsd;
      const hdlr = trak.mdia.hdlr;
      tracks.push({
        id: t.id, handler, codec: t.codec, timescale: t.timescale,
        width: t.track_width || (t.video && t.video.width) || 0,
        height: t.track_height || (t.video && t.video.height) || 0,
        samples: trak.samples.map(s => ({ dts: s.dts, cts: s.cts, dur: s.duration, size: s.size, offset: s.offset, sync: !!s.is_sync, desc: s.description_index })),
        stsdRaw: synth.slice(stsd.start, stsd.start + stsd.size),
        hdlrRaw: synth.slice(hdlr.start, hdlr.start + hdlr.size),
        language: trak.mdia.mdhd.language || 'und',
        presShift: editShift(trak, t.timescale, info.timescale)
      });
    }
    return { info, tracks, ftypBytes, brand: info.brands, created: info.created, duration: info.duration / info.timescale };
  }

  // Desplazamiento de presentación por lista de edición original (en unidades de la pista):
  // tiempo_presentación = (cts - media_time) + vacío_inicial
  function editShift(trak, ts, movieTs) {
    try {
      const e = trak.edts && trak.edts.elst && trak.edts.elst.entries;
      if (!e || !e.length) return 0;
      let empty = 0;
      for (const x of e) {
        if (x.media_time === -1) { empty += x.segment_duration / movieTs * ts; continue; }
        return x.media_time - empty;
      }
    } catch (_) { }
    return 0;
  }

  // ---------- escritor binario ----------
  class W {
    constructor() { this.parts = []; this.len = 0; }
    bytes(u8) { this.parts.push(u8); this.len += u8.length; return this; }
    u8(v) { return this.bytes(new Uint8Array([v & 255])); }
    u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return this.bytes(b); }
    u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return this.bytes(b); }
    i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v | 0); return this.bytes(b); }
    u64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(Math.round(v))); return this.bytes(b); }
    str(s) { return this.bytes(new Uint8Array([...s].map(c => c.charCodeAt(0)))); }
    zeros(n) { return this.bytes(new Uint8Array(n)); }
    out() { const o = new Uint8Array(this.len); let p = 0; for (const x of this.parts) { o.set(x, p); p += x.length; } return o; }
  }
  function box(type, fill) { const w = new W(); fill(w); const body = w.out(); const o = new W(); o.u32(body.length + 8).str(type).bytes(body); return o.out(); }
  function fullbox(type, version, flags, fill) { return box(type, w => { w.u8(version).u8(flags >> 16).u8(flags >> 8).u8(flags); fill(w); }); }
  function concat(arrs) { const w = new W(); arrs.forEach(a => w.bytes(a)); return w.out(); }
  const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  function langCode(l) { l = (l && l.length === 3) ? l : 'und'; return ((l.charCodeAt(0) - 0x60) << 10) | ((l.charCodeAt(1) - 0x60) << 5) | (l.charCodeAt(2) - 0x60); }

  // ---------- selección de muestras ----------
  function selectVideo(tr, a, b) {
    const ts = tr.timescale, sh = tr.presShift || 0;
    const S = tr.samples.map(x => Object.assign({}, x, { pc: x.cts - sh }));
    if (!S.length) throw MP4CutError('SIN_MUESTRAS', 'La pista de video no tiene muestras');
    let s = -1;
    for (let i = 0; i < S.length; i++) { if (S[i].sync && S[i].pc / ts <= a + 1e-6) s = i; }
    if (s < 0) s = S.findIndex(x => x.sync);
    if (s < 0) s = 0;
    let e = s;
    for (let i = s; i < S.length; i++) { if (S[i].pc / ts < b - 1e-6) e = i; }
    // incluir todo lo necesario en orden de decodificación
    const sel = S.slice(s, e + 1);
    const minCts = Math.min(...sel.map(x => x.cts));
    const maxEnd = Math.max(...sel.map(x => x.cts + x.dur));
    return { sel, baseDts: S[s].dts, minCts, maxEnd, t0: (minCts - sh) / ts, t1: (maxEnd - sh) / ts, decodeStart: (S[s].dts - sh) / ts };
  }
  function selectAudio(tr, t0, t1) {
    const ts = tr.timescale, sh = tr.presShift || 0;
    const sel = tr.samples.filter(x => (x.dts - sh) / ts >= t0 - 1e-6 && (x.dts - sh) / ts < t1 - 1e-6);
    return { sel, baseDts: sel.length ? sel[0].dts : 0 };
  }

  function sttsEntries(sel) { const out = []; for (const s of sel) { const l = out[out.length - 1]; if (l && l[1] === s.dur) l[0]++; else out.push([1, s.dur]); } return out; }
  function cttsEntries(sel, baseDts, baseCts) {
    const out = []; for (const s of sel) { const off = (s.cts - baseCts) - (s.dts - baseDts); const l = out[out.length - 1]; if (l && l[1] === off) l[0]++; else out.push([1, off]); } return out;
  }

  function buildTrak(t, movieTs, trackDurMovie, mediaDur, chunkOffset, useCo64, sel, opts) {
    const isV = t.handler === 'vide';
    const tkhd = fullbox('tkhd', 0, 3, w => { w.u32(0).u32(0).u32(t.newId).u32(0).u32(trackDurMovie).zeros(8).u16(0).u16(0).u16(isV ? 0 : 0x0100).u16(0); MATRIX.forEach(m => w.u32(m)); w.u32((t.width || 0) * 65536).u32((t.height || 0) * 65536); });
    const edts = (isV && opts.elstMediaTime >= 0) ? box('edts', w => w.bytes(fullbox('elst', 0, 0, x => { x.u32(1).u32(trackDurMovie).i32(opts.elstMediaTime).u16(1).u16(0); }))) : new Uint8Array(0);
    const mdhd = fullbox('mdhd', 0, 0, w => { w.u32(0).u32(0).u32(t.timescale).u32(mediaDur).u16(langCode(t.language)).u16(0); });
    const xmhd = isV ? fullbox('vmhd', 0, 1, w => w.zeros(8)) : fullbox('smhd', 0, 0, w => w.zeros(4));
    const dinf = box('dinf', w => w.bytes(fullbox('dref', 0, 0, x => { x.u32(1).bytes(fullbox('url ', 0, 1, () => {})); })));
    const stts = fullbox('stts', 0, 0, w => { const e = sttsEntries(sel); w.u32(e.length); e.forEach(([c, d]) => w.u32(c).u32(d)); });
    const ce = cttsEntries(sel, opts.baseDts, opts.baseDts);
    const needCtts = ce.some(([, o]) => o !== 0);
    const neg = ce.some(([, o]) => o < 0);
    const ctts = needCtts ? fullbox('ctts', neg ? 1 : 0, 0, w => { w.u32(ce.length); ce.forEach(([c, o]) => { w.u32(c); neg ? w.i32(o) : w.u32(o); }); }) : new Uint8Array(0);
    const allSync = sel.every(s => s.sync);
    const stss = (isV && !allSync) ? fullbox('stss', 0, 0, w => { const idx = []; sel.forEach((s, i) => { if (s.sync) idx.push(i + 1); }); w.u32(idx.length); idx.forEach(i => w.u32(i)); }) : new Uint8Array(0);
    const stsc = fullbox('stsc', 0, 0, w => { w.u32(1).u32(1).u32(sel.length).u32(1); });
    const stsz = fullbox('stsz', 0, 0, w => { w.u32(0).u32(sel.length); sel.forEach(s => w.u32(s.size)); });
    const stco = useCo64 ? fullbox('co64', 0, 0, w => { w.u32(1).u64(chunkOffset); }) : fullbox('stco', 0, 0, w => { w.u32(1).u32(chunkOffset); });
    const stbl = box('stbl', w => w.bytes(concat([t.stsdRaw, stts, ctts, stss, stsc, stsz, stco])));
    const minf = box('minf', w => w.bytes(concat([xmhd, dinf, stbl])));
    const mdia = box('mdia', w => w.bytes(concat([mdhd, t.hdlrRaw, minf])));
    return box('trak', w => w.bytes(concat([tkhd, edts, mdia])));
  }

  /**
   * Corta [inicio, fin] (segundos de posición en el archivo).
   * reader: { size, read(offset, length) -> Promise<Uint8Array> }
   * Devuelve { parts: Uint8Array[], bytes, real: {inicio, fin}, solicitado, pistas, alineacion }
   */
  async function cutMP4(reader, inicio, fin, onProgress) {
    if (!(fin > inicio)) throw MP4CutError('INTERVALO_INVALIDO', 'El fin debe ser mayor que el inicio');
    const mv = await parseMovie(reader);
    const vtr = mv.tracks.find(t => t.handler === 'vide');
    if (!vtr) throw MP4CutError('SIN_VIDEO', 'El archivo no tiene pista de video');
    const V = selectVideo(vtr, Math.max(0, inicio), fin);
    const plan = [];
    plan.push({ t: vtr, sel: V.sel, baseDts: V.baseDts, elstMediaTime: V.minCts - V.baseDts, mediaDur: V.sel.reduce((a, s) => a + s.dur, 0), presDur: (V.maxEnd - V.minCts) / vtr.timescale });
    for (const at of mv.tracks.filter(t => t.handler === 'soun')) {
      const A = selectAudio(at, V.t0, V.t1); // el audio arranca donde empieza la presentación del video (lista de edición), no en su decodificación
      if (A.sel.length) plan.push({ t: at, sel: A.sel, baseDts: A.baseDts, elstMediaTime: -1, mediaDur: A.sel.reduce((a, s) => a + s.dur, 0), presDur: A.sel.reduce((a, s) => a + s.dur, 0) / at.timescale });
    }
    plan.forEach((p, i) => { p.t.newId = i + 1; });
    const movieTs = 1000;
    const totalData = plan.reduce((a, p) => a + p.sel.reduce((x, s) => x + s.size, 0), 0);
    const useCo64 = totalData > 0xF0000000;
    const durMovie = Math.round(Math.max(...plan.map(p => p.presDur)) * movieTs);
    const build = (offsets) => {
      const mvhd = fullbox('mvhd', 0, 0, w => { w.u32(0).u32(0).u32(movieTs).u32(durMovie).u32(0x00010000).u16(0x0100).zeros(10); MATRIX.forEach(m => w.u32(m)); w.zeros(24).u32(plan.length + 1); });
      const traks = plan.map((p, i) => buildTrak(p.t, movieTs, Math.round(p.presDur * movieTs), p.mediaDur, offsets[i], useCo64, p.sel, p));
      const udta = box('udta', w => w.bytes(box('©too', x => { x.str('VIGIA mp4cut (copia de flujo, sin recodificar)'); })));
      return box('moov', w => w.bytes(concat([mvhd, ...traks, udta])));
    };
    const ftyp = mv.ftypBytes;
    let moov = build(plan.map(() => 0));
    const mdatHdr = useCo64 ? 16 : 8;
    const offsets = []; let acc = ftyp.length + moov.length + mdatHdr;
    for (const p of plan) { offsets.push(acc); acc += p.sel.reduce((x, s) => x + s.size, 0); }
    moov = build(offsets);
    const hw = new W();
    if (useCo64) hw.u32(1).str('mdat').u64(totalData + 16); else hw.u32(totalData + 8).str('mdat');
    const parts = [ftyp, moov, hw.out()];
    // lectura de datos por rangos contiguos (≤ 8 MB)
    let done = 0;
    for (const p of plan) {
      let i = 0; const S = p.sel;
      while (i < S.length) {
        let j = i, start = S[i].offset, end = S[i].offset + S[i].size;
        while (j + 1 < S.length && S[j + 1].offset === end && (end - start) < 8 * 1024 * 1024) { j++; end += S[j].size; }
        parts.push(await reader.read(start, end - start));
        done += end - start; if (onProgress) onProgress(done / totalData);
        i = j + 1;
      }
    }
    const vt = plan[0].t.timescale;
    return {
      parts, bytes: parts.reduce((a, x) => a + x.length, 0),
      solicitado: { inicio, fin },
      real: { inicio: V.t0, fin: V.t1 },
      alineacion: 'inicio alineado al fotograma clave anterior (' + (V.t0).toFixed(3) + ' s); sin recodificar',
      pistas: plan.map(p => ({ tipo: p.t.handler === 'vide' ? 'video' : 'audio', codec: p.t.codec, muestras: p.sel.length, timescale: p.t.timescale })),
      fotogramasVideo: V.sel.length, timescaleVideo: vt,
      metodo: 'mp4cut v1 · copia de flujo (stream copy) de muestras y stsd originales',
      comandoEquivalente: 'ffmpeg -ss ' + V.t0.toFixed(3) + ' -i <original> -t ' + (V.t1 - V.t0).toFixed(3) + ' -c copy -map 0:v:0 -map 0:a? clip.mp4'
    };
  }

  const api = { cutMP4, parseMovie, scanTopLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VIGIA_MP4CUT = api;
})(typeof window !== 'undefined' ? window : globalThis);
