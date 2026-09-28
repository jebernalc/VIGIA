/* VIGÍA · util.js — utilidades comunes (tiempo, hash, ids, HTML seguro, eventos) */
(function () {
  'use strict';
  const V = window.V = window.V || {};

  // ---------- identificadores estables (ULID-like, ordenables) ----------
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  V.id = function (prefix) {
    let t = Date.now(), ts = '';
    for (let i = 0; i < 10; i++) { ts = B32[t % 32] + ts; t = Math.floor(t / 32); }
    const r = crypto.getRandomValues(new Uint8Array(10));
    let rs = ''; for (const b of r) rs += B32[b % 32];
    return (prefix ? prefix + '_' : '') + ts + rs;
  };
  V.randomSecret = function (n) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const r = crypto.getRandomValues(new Uint8Array(n || 14));
    return Array.from(r, b => abc[b % abc.length]).join('');
  };

  // ---------- HTML seguro ----------
  V.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  };
  V.$ = (sel, el) => (el || document).querySelector(sel);
  V.$$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // ---------- eventos ----------
  const listeners = {};
  V.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => { listeners[ev] = listeners[ev].filter(f => f !== fn); }; };
  V.emit = (ev, data) => { (listeners[ev] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); };

  V.sleep = ms => new Promise(r => setTimeout(r, ms));
  V.nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

  // ---------- tiempo ----------
  V.fmtDur = function (s, withMs) {
    if (s == null || !isFinite(s)) return '—';
    const neg = s < 0; s = Math.abs(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    let out = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    if (withMs) out += '.' + String(Math.floor((s % 1) * 1000)).padStart(3, '0');
    return (neg ? '-' : '') + out;
  };
  V.fmtBytes = function (b) {
    if (b == null) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return b.toFixed(i ? 1 : 0) + ' ' + u[i];
  };
  V.tzOffsetLabel = function (date, tz) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(date);
      const n = p.find(x => x.type === 'timeZoneName'); return n ? n.value.replace('GMT', 'UTC') : tz;
    } catch (_) { return tz; }
  };
  V.fmtDateTime = function (ms, tz, opts) {
    if (ms == null) return '—';
    tz = tz || V.defaultTZ();
    const d = new Date(ms);
    try {
      const s = new Intl.DateTimeFormat('es-CO', Object.assign({ timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }, opts || {})).format(d);
      return s + ' ' + V.tzOffsetLabel(d, tz);
    } catch (_) { return d.toISOString(); }
  };
  V.fmtTime = (ms, tz) => V.fmtDateTime(ms, tz, { year: undefined, month: undefined, day: undefined });
  V.defaultTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };
  V.validTZ = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; } };
  V.TZS = ['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Caracas', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'UTC'];
  V.ago = function (ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 1.5) return 'hace 1 s'; if (s < 60) return 'hace ' + Math.round(s) + ' s';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min'; if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    return 'hace ' + Math.round(s / 86400) + ' d';
  };

  // ---------- SHA-256 incremental (para archivos grandes) + WebCrypto ----------
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  class Sha256 {
    constructor() { this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); this.buf = new Uint8Array(64); this.bl = 0; this.len = 0; this.w = new Uint32Array(64); }
    _block(b, o) {
      const w = this.w, h = this.h;
      for (let i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) { const x = w[i - 15], y = w[i - 2]; const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3); const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)); const ch = (e & f) ^ (~e & g); const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)); const mj = (a & bb) ^ (a & c) ^ (bb & c); const t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    update(d) {
      let i = 0; this.len += d.length;
      if (this.bl) { while (this.bl < 64 && i < d.length) this.buf[this.bl++] = d[i++]; if (this.bl === 64) { this._block(this.buf, 0); this.bl = 0; } }
      while (i + 64 <= d.length) { this._block(d, i); i += 64; }
      while (i < d.length) this.buf[this.bl++] = d[i++];
      return this;
    }
    hex() {
      const bits = this.len * 8; const pad = new Uint8Array(((this.bl < 56) ? 56 : 120) - this.bl + 8); pad[0] = 0x80;
      const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0; const n = pad.length;
      pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi; pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
      this.update(pad);
      return Array.from(this.h, x => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }
  }
  V.Sha256 = Sha256;
  const toHex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  /** Hash SHA-256 de Blob/File. WebCrypto hasta 256 MB; por encima, incremental por bloques (memoria acotada). */
  V.sha256Blob = async function (blob, onProgress) {
    if (blob.size <= 256 * 1024 * 1024 && crypto.subtle) {
      const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      if (onProgress) onProgress(1); return toHex(d);
    }
    const h = new Sha256(); const CH = 8 * 1024 * 1024;
    for (let p = 0; p < blob.size; p += CH) {
      h.update(new Uint8Array(await blob.slice(p, p + CH).arrayBuffer()));
      if (onProgress) onProgress(Math.min(1, (p + CH) / blob.size));
      await V.sleep(0);
    }
    return h.hex();
  };
  V.sha256Text = async function (txt) {
    const u = new TextEncoder().encode(txt);
    if (crypto.subtle) return toHex(await crypto.subtle.digest('SHA-256', u));
    return new Sha256().update(u).hex();
  };
  V.toHex = toHex;

  // ---------- descargas ----------
  // En el visor de claude.ai las descargas pasan por la capacidad «downloads» (el visor pide confirmación);
  // fuera de él (archivo local o GitHub Pages) se usa un enlace de descarga normal.
  let _dl = null; const dlCap = () => (_dl = _dl || (window.claude && window.claude.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null)));
  V.downloadBlob = async function (blob, name) {
    const d = await dlCap();
    if (d) { try { await d.save({ filename: name, data: blob }); return true; } catch (e) { if (e && e.code === 'declined') return false; if (V.toast) V.toast('No se pudo guardar el archivo: ' + (e && (e.message || e.code)), 'warn'); return false; } }
    const a = document.createElement('a'); const u = URL.createObjectURL(blob);
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  };
  V.safeName = s => String(s || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'archivo';

  // ---------- normalización texto español ----------
  V.norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  V.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  V.pct = x => Math.round(x * 100) + '%';
  // ---------- horarios de vigilancia (reglas y zonas) ----------
  // h = { dias: [0..6] (0 = domingo), desde: 'HH:MM', hasta: 'HH:MM' }. Si desde > hasta, la franja cruza la medianoche
  // y pertenece al día en que empieza (p. ej. viernes 22:00 → sábado 06:00 cuenta como «viernes»).
  const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  V.DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  V.horario = {
    validar(h) {
      if (!h) return null;
      const dias = Array.from(new Set((Array.isArray(h.dias) ? h.dias : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort();
      if (!HM.test(h.desde || '') || !HM.test(h.hasta || '')) throw new V.VigiaError('VALIDACION', 'Horario inválido: use HH:MM (24 h).');
      if (h.desde === h.hasta) throw new V.VigiaError('VALIDACION', 'El horario debe tener duración (desde ≠ hasta).');
      if (!dias.length) throw new V.VigiaError('VALIDACION', 'El horario debe incluir al menos un día.');
      return { dias, desde: h.desde, hasta: h.hasta };
    },
    /** Día de la semana y minutos desde medianoche en la zona horaria de la cámara. */
    partes(ms, tz) {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
      const g = k => (p.find(x => x.type === k) || {}).value;
      return { dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), min: (+g('hour') % 24) * 60 + +g('minute') };
    },
    activo(h, ms, tz) {
      if (!h) return true; if (ms == null) return null; // sin hora de captura: no se puede evaluar
      const { dia, min } = V.horario.partes(ms, tz);
      const a = +h.desde.slice(0, 2) * 60 + +h.desde.slice(3), b = +h.hasta.slice(0, 2) * 60 + +h.hasta.slice(3);
      if (a < b) return h.dias.includes(dia) && min >= a && min < b;
      if (min >= a) return h.dias.includes(dia);
      if (min < b) return h.dias.includes((dia + 6) % 7);
      return false;
    },
    texto(h) {
      if (!h) return 'siempre';
      const d = h.dias.length === 7 ? 'todos los días' : h.dias.join(',') === '1,2,3,4,5' ? 'lunes a viernes' : h.dias.join(',') === '0,6' ? 'fines de semana' : h.dias.map(x => V.DIAS[x]).join(', ');
      return d + ' ' + h.desde + '–' + h.hasta;
    }
  };

  // ---------- CRC-32 y ZIP (método «stored», sin compresión: los medios ya están comprimidos) ----------
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  V.crc32 = function (u8, crc) { let c = (crc === undefined ? 0 : crc) ^ 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  /** files: [{ nombre, datos: Blob|Uint8Array|string, fecha?: ms }] → Blob application/zip (UTF-8, ZIP 2.0; hasta 4 GB). */
  V.zip = async function (files) {
    const enc = new TextEncoder(); const partes = []; const central = []; let off = 0;
    const dosTime = ms => { const d = new Date(ms || Date.now()); return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; };
    const vistos = new Set();
    for (const f of files) {
      let nombre = String(f.nombre).replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(x => x && x !== '..' && x !== '.').join('/');
      if (!nombre || vistos.has(nombre)) throw new V.VigiaError('VALIDACION', 'Nombre de archivo inválido o repetido en el paquete: ' + f.nombre); vistos.add(nombre);
      const datos = typeof f.datos === 'string' ? enc.encode(f.datos) : f.datos instanceof Blob ? new Uint8Array(await f.datos.arrayBuffer()) : f.datos;
      if (off + datos.length > 0xFFFFFFFF - 1e6) throw new V.VigiaError('DEMASIADO_GRANDE', 'El paquete supera 4 GB; exporte por partes.');
      const nb = enc.encode(nombre), crc = V.crc32(datos), dt = dosTime(f.fecha);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dt.t, true); lh.setUint16(12, dt.d, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, datos.length, true); lh.setUint32(22, datos.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dt.t, true); ch.setUint16(14, dt.d, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, datos.length, true); ch.setUint32(24, datos.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
      partes.push(new Uint8Array(lh.buffer), nb, datos); central.push(new Uint8Array(ch.buffer), nb);
      off += 30 + nb.length + datos.length;
    }
    const cdLen = central.reduce((a, x) => a + x.length, 0);
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true); eo.setUint32(12, cdLen, true); eo.setUint32(16, off, true);
    return new Blob([...partes, ...central, new Uint8Array(eo.buffer)], { type: 'application/zip' });
  };
})();
