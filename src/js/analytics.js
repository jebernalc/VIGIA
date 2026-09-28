/* VIGÍA · analytics.js — motor de analítica de video «analitica-v1».
 * Casos de uso inspirados en las plataformas líderes (cruce de línea, conteo, ocupación, tiempo en zona,
 * intrusión, estacionamiento indebido, puerta abierta, objeto abandonado, manipulación de cámara,
 * aglomeración, ingreso en grupo (tailgating), búsqueda por color de prenda, mapa de calor, humo experimental).
 * Principios: determinista, explicable, sin servicios externos. Cada evento conserva el motivo, los
 * parámetros y el fotograma que lo respalda. Lo experimental se etiqueta como tal. */
(function () {
  'use strict';
  const V = window.V; const AN = V.analitica = {};

  // ---------------- catálogo ----------------
  // ia: requiere detector de objetos · cfg: requiere configurar zona/línea/puerta · exp: experimental
  AN.TIPOS = {
    cruce_linea: { nombre: 'Cruce de línea (entrada/salida)', ia: true, cfg: 'linea', icono: '↔', desc: 'Cuenta personas o vehículos que cruzan una línea virtual y su sentido.' },
    ingreso_grupal: { nombre: 'Ingreso en grupo (tailgating)', ia: true, cfg: 'linea', icono: '⇉', desc: 'Dos o más ingresos por la misma línea en menos de N segundos.' },
    intrusion: { nombre: 'Intrusión en zona restringida', ia: true, cfg: 'zona:restringida', icono: '⛔', desc: 'Una persona entra a una zona restringida.' },
    merodeo: { nombre: 'Merodeo (tiempo en zona)', ia: true, cfg: 'zona:restringida', icono: '⏱', desc: 'Una persona permanece en la zona más de N segundos.' },
    mal_parqueado: { nombre: 'Vehículo mal estacionado', ia: true, cfg: 'zona:no_parqueo', icono: '🚫', desc: 'Un vehículo permanece en zona de no estacionar más de N segundos.' },
    aglomeracion: { nombre: 'Aglomeración / ocupación máxima', ia: true, cfg: 'zona:ocupacion', icono: '👥', desc: 'La ocupación de la zona alcanza el umbral configurado.' },
    puerta_abierta: { nombre: 'Puerta abierta', ia: false, cfg: 'puerta', icono: '🚪', desc: 'Más de la mitad de la región de la puerta difiere de su estado de referencia (cerrada) durante más de N segundos.' },
    objeto_abandonado: { nombre: 'Objeto abandonado / nuevo objeto estático', ia: false, cfg: null, icono: '🎒', desc: 'Aparece un objeto estático que permanece N segundos sin personas ni vehículos encima.' },
    manipulacion: { nombre: 'Manipulación de cámara', ia: false, cfg: null, icono: '🛠', desc: 'Cámara cubierta/oscurecida, desenfocada o movida (cambio de escena).' },
    humo: { nombre: 'Posible humo (EXPERIMENTAL)', ia: false, cfg: null, exp: true, icono: '💨', desc: 'Región difusa, gris y creciente que reduce el contraste del fondo. No sustituye detectores certificados.' }
  };
  AN.ETIQUETA = Object.fromEntries(Object.entries(AN.TIPOS).map(([k, v]) => [k, v.nombre]));
  const GRUPO = c => V.GRUPOS_CLASE.persona.includes(c) ? 'persona' : V.GRUPOS_CLASE.vehiculo.includes(c) ? 'vehiculo' : null;

  AN.PARAM_DEF = { merodeoS: 20, parqueoS: 30, puertaS: 10, abandonoS: 15, umbralAglomeracion: 5, tailgatingS: 3, umbralPuerta: 0.5 };
  AN.configVacia = () => ({ zonas: [], lineas: [], puertas: [], parametros: Object.assign({}, AN.PARAM_DEF) });

  // ---------------- color de prendas ----------------
  function hsv(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; }
  AN.nombreColor = function (r, g, b) {
    const [h, s, v] = hsv(r, g, b);
    if (v < 0.22) return 'negro';
    if (s < 0.16) return v > 0.72 ? 'blanco' : 'gris';
    if (h >= 10 && h < 40 && v < 0.55) return 'marrón';
    if (h < 12 || h >= 345) return 'rojo'; if (h < 40) return 'naranja'; if (h < 68) return 'amarillo'; if (h < 165) return 'verde';
    if (h < 255) return 'azul'; if (h < 290) return 'morado'; return 'rosado';
  };
  /** Regla clásica de piel en RGB (Kovac et al.): excluye rostro y manos del color de la prenda. */
  function esPiel(r, g, b) { const mx = Math.max(r, g, b), sat = mx ? (mx - Math.min(r, g, b)) / mx : 0; return sat <= 0.6 && r > 95 && g > 40 && b > 20 && (Math.max(r, g, b) - Math.min(r, g, b)) > 15 && Math.abs(r - g) > 15 && r > g && r > b && r - b > 30 && g > b * 0.8 && r < 250; }
  AN.esPiel = esPiel;
  AN.COLORES = ['negro', 'blanco', 'gris', 'rojo', 'naranja', 'amarillo', 'verde', 'azul', 'morado', 'rosado', 'marrón'];
  /** Color dominante de la parte superior (torso) e inferior (piernas) de una persona. data = ImageData del lienzo. */
  AN.atributosPersona = function (data, bbox) {
    const W = data.width, H = data.height, px = data.data;
    const zona = (y0, y1) => {
      const x0 = Math.max(0, Math.floor((bbox.x + bbox.w * 0.25) * W)), x1 = Math.min(W, Math.ceil((bbox.x + bbox.w * 0.75) * W));
      const ya = Math.max(0, Math.floor((bbox.y + bbox.h * y0) * H)), yb = Math.min(H, Math.ceil((bbox.y + bbox.h * y1) * H));
      const cnt = {}; let n = 0;
      for (let y = ya; y < yb; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        if (esPiel(r, g, b)) continue; // la piel no es prenda
        const c = AN.nombreColor(r, g, b); cnt[c] = (cnt[c] || 0) + 1; n++;
      }
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]); if (n < 12) return null;
      return top.length ? { color: top[0][0], proporcion: +(top[0][1] / n).toFixed(2), segundo: top[1] ? top[1][0] : null } : null;
    };
    const sup = zona(0.2, 0.5), inf = zona(0.55, 0.92);
    return { superior: sup && sup.color, superiorP: sup && sup.proporcion, superior2: sup && sup.segundo, inferior: inf && inf.color, inferiorP: inf && inf.proporcion, metodo: 'color dominante HSV sin píxeles de piel (torso 20–50%, piernas 55–92% del recuadro)' };
  };

  // ---------------- geometría ----------------
  const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  function segInter(p1, p2, a, b) { const d1 = cross(a, b, p1), d2 = cross(a, b, p2), d3 = cross(p1, p2, a), d4 = cross(p1, p2, b); return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)); }
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const iou = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.w * a.h + b.w * b.h - i || 1); };
  const overlap = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  AN.geo = { cross, segInter, inRect, iou };
  /** Asignación de costo mínimo filas→columnas (Infinity = no permitido). Exacta hasta 7 filas, voraz si hay más. */
  AN.asignar = function (C) {
    const n = C.length, m = n ? C[0].length : 0; if (!n || !m) return [];
    const filas = C.map((r, i) => i).filter(i => C[i].some(isFinite));
    if (filas.length <= 7 && m <= 9) {
      let best = { c: Infinity, a: [] };
      const rec = (k, usadas, acc, par) => {
        if (acc - par.length * 1e-9 >= best.c + 1e-12 && par.length) return;
        if (k === filas.length) { const c = acc + (filas.length - par.length) * 10; if (c < best.c) best = { c, a: par.slice() }; return; }
        const i = filas[k];
        for (let j = 0; j < m; j++) if (!usadas.has(j) && isFinite(C[i][j])) { usadas.add(j); par.push([i, j]); rec(k + 1, usadas, acc + C[i][j], par); par.pop(); usadas.delete(j); }
        rec(k + 1, usadas, acc + 10, par); // fila sin asignar (penalizada)
      };
      rec(0, new Set(), 0, []); return best.a;
    }
    const pares = []; C.forEach((r, i) => r.forEach((c, j) => { if (isFinite(c)) pares.push([c, i, j]); })); pares.sort((a, b) => a[0] - b[0]);
    const ui = new Set(), uj = new Set(), out = []; for (const [, i, j] of pares) { if (ui.has(i) || uj.has(j)) continue; ui.add(i); uj.add(j); out.push([i, j]); } return out;
  };

  // ---------------- motor ----------------
  class Motor {
    constructor(cam, opts) {
      const cfg = (cam && cam.analitica) || AN.configVacia();
      this.cfg = { zonas: cfg.zonas || [], lineas: cfg.lineas || [], puertas: cfg.puertas || [], parametros: Object.assign({}, AN.PARAM_DEF, cfg.parametros || {}) };
      this.mascaras = (cam && cam.mascaras) || [];
      this.opts = opts || {};
      this.tracks = []; this.cerrados = []; this.nextId = 1; this.eventos = [];
      this.cruces = {}; this.cfg.lineas.forEach(l => this.cruces[l.id] = []);
      this.ocupacion = {}; this.cfg.zonas.filter(z => z.uso === 'ocupacion').forEach(z => this.ocupacion[z.id] = { max: 0, suma: 0, n: 0, serie: [] });
      this.puertas = this.cfg.puertas.map(p => ({ p, ref: null, abiertaDesde: null, serie: [] }));
      this.GW = 32; this.GH = 18; this.calor = new Float32Array(this.GW * this.GH);
      this.ia = false; this.n = 0; this.ultT = 0;
      // estado de píxeles
      this.ref = null; this.prevG = null; this.estable = null; this.cambioDesde = null; this.excl = null;
      this.base = []; this.tamper = { activo: null, tipo: null, cuenta: 0 };
      this.humo = { cuenta: 0, areaPrev: 0, inicio: null, mejor: null, max: 0, activos: [] };
      this.abandono = { reportadas: new Set() };
      this.frameIds = {};
    }
    // ---- lectura de lienzo a rejilla ----
    _grid(canvas) {
      const W = 160, H = 90; const c = this._c || (this._c = document.createElement('canvas')); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data; const gray = new Float32Array(W * H), sat = new Float32Array(W * H);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) { const r = d[i], gg = d[i + 1], b = d[i + 2]; gray[j] = 0.299 * r + 0.587 * gg + 0.114 * b; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); sat[j] = mx ? (mx - mn) / mx : 0; }
      // celdas 5x5 → 32x18
      const CW = this.GW, CH = this.GH, cs = 5; const m = new Float32Array(CW * CH), sd = new Float32Array(CW * CH), st = new Float32Array(CW * CH);
      for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
        let s = 0, s2 = 0, ss = 0, n = 0;
        for (let y = cy * cs; y < cy * cs + cs; y++) for (let x = cx * cs; x < cx * cs + cs; x++) { const v = gray[y * W + x]; s += v; s2 += v * v; ss += sat[y * W + x]; n++; }
        const k = cy * CW + cx; m[k] = s / n; sd[k] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)); st[k] = ss / n;
      }
      // nitidez global (laplaciano medio)
      let lap = 0; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; lap += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - W] - gray[i + W]); }
      let brillo = 0; for (let i = 0; i < gray.length; i++) brillo += gray[i];
      return { gray, W, H, m, sd, st, lap: lap / ((W - 2) * (H - 2)), brillo: brillo / gray.length };
    }
    _celdaEnMascara(k) { const cx = (k % this.GW + 0.5) / this.GW, cy = (Math.floor(k / this.GW) + 0.5) / this.GH; const m = 0.04; return this.mascaras.some(r => inRect({ x: cx, y: cy }, r)) || this.cfg.puertas.some(p => inRect({ x: cx, y: cy }, { x: p.rect.x - m, y: p.rect.y - m, w: p.rect.w + 2 * m, h: p.rect.h + 2 * m })); }
    _celdasDe(b) { const out = []; const x0 = Math.floor(b.x * this.GW), x1 = Math.ceil((b.x + b.w) * this.GW), y0 = Math.floor(b.y * this.GH), y1 = Math.ceil((b.y + b.h) * this.GH); for (let y = Math.max(0, y0); y < Math.min(this.GH, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.GW, x1); x++) out.push(y * this.GW + x); return out; }
    /** Aviso inmediato (uso en vivo): se emite una vez por episodio cuando se cumple la condición. */
    _alerta(tipo, info) { if (this.opts.onAlerta) try { this.opts.onAlerta(tipo, Object.assign({ tipo, etiqueta: AN.ETIQUETA[tipo] }, info)); } catch (e) { console.warn(e); } }
    _evento(tipo, inicio, fin, extra) { const e = Object.assign({ tipo, etiqueta: AN.ETIQUETA[tipo] || tipo, inicio, fin, experimental: !!(AN.TIPOS[tipo] && AN.TIPOS[tipo].exp) }, extra); this.eventos.push(e); return e; }

    /** Procesa una muestra. s = { t, frameId, canvas (≥320 px), dets: [{clase, score, bbox, atributos}] | null } */
    frame(s) {
      const t = s.t; this.n++; this.ultT = t; this.frameIds[t] = s.frameId;
      const P = this.cfg.parametros;
      const dets = (s.dets || []).filter(d => d.score >= 0.5 && GRUPO(d.clase));
      if (s.dets) this.ia = true;
      const G = this._grid(s.canvas);
      if (!this.ref) { this.ref = G; this.estable = new Float32Array(this.GW * this.GH); this.cambioDesde = new Float32Array(this.GW * this.GH).fill(-1); this.excl = new Float32Array(this.GW * this.GH).fill(-1e9); }

      // ---- manipulación de cámara ----
      if (this.base.length < 8 && G.brillo > 25) this.base.push({ b: G.brillo, l: G.lap });
      const baseB = this.base.length ? this.base.map(x => x.b).sort((a, b) => a - b)[this.base.length >> 1] : G.brillo;
      const baseL = this.base.length ? this.base.map(x => x.l).sort((a, b) => a - b)[this.base.length >> 1] : G.lap;
      let difCeldas = 0; for (let k = 0; k < G.m.length; k++) if (Math.abs(G.m[k] - this.ref.m[k]) > 30) difCeldas++;
      const tipoTamper = (G.brillo < 25 || G.brillo < baseB * 0.3) ? 'cubierta u oscurecida' : (this.base.length >= 5 && G.lap < baseL * 0.25) ? 'desenfocada' : (difCeldas / G.m.length > 0.7) ? 'movida (cambio de escena)' : null;
      const T = this.tamper;
      if (tipoTamper) { T.cuenta++; if (!T.activo && T.cuenta >= 2) { T.activo = t - (T.cuenta - 1); T.tipo = tipoTamper; T.frameId = s.frameId; this._alerta('manipulacion', { detalle: tipoTamper, t }); } }
      else { if (T.activo != null) { this._evento('manipulacion', T.activo, t, { detalle: { tipo: T.tipo, brillo: +G.brillo.toFixed(1), brilloBase: +baseB.toFixed(1) }, frameId: T.frameId, score: 0.9 }); T.activo = null; } T.cuenta = 0; }
      const enTamper = T.cuenta > 0;

      // ---- seguimiento de objetos (IA) ----
      if (s.dets) this._seguir(t, s.frameId, dets, P);

      // ---- puertas ----
      for (const pu of this.puertas) {
        const cel = this._celdasDe(pu.p.rect);
        if (!pu.ref) { pu.ref = cel.map(k => G.m[k]); pu.refSd = cel.map(k => G.sd[k]); pu.refT = t; }
        let d = 0; cel.forEach((k, i) => { if (Math.abs(G.m[k] - pu.ref[i]) > 20) d++; }); d /= Math.max(1, cel.length); // fracción de la puerta que cambió
        const abierta = !enTamper && d > (pu.p.umbral || P.umbralPuerta);
        pu.serie.push({ t, d: +d.toFixed(3), abierta });
        if (abierta && pu.abiertaDesde == null) { pu.abiertaDesde = t; pu.frameId = s.frameId; pu.dmax = d; }
        if (abierta) { pu.dmax = Math.max(pu.dmax, d); if (t - pu.abiertaDesde >= (pu.p.puertaS || P.puertaS) && !pu.alertada) { pu.alertada = true; this._alerta('puerta_abierta', { puerta: pu.p.nombre, duracionS: t - pu.abiertaDesde, t }); } } else pu.alertada = false;
        if (!abierta && pu.abiertaDesde != null) { this._cerrarPuerta(pu, t, P); }
      }

      // ---- exclusiones: celdas ocupadas por personas/vehículos (últimos 10 s) ----
      for (const d of dets) for (const k of this._celdasDe({ x: d.bbox.x - 0.06, y: d.bbox.y - 0.06, w: d.bbox.w + 0.12, h: d.bbox.h + 0.12 })) this.excl[k] = t;

      // ---- humo (experimental) y objeto abandonado ----
      if (!enTamper) { this._humo(t, s.frameId, G, dets); this._abandono(t, s.frameId, G, P); }
      this.prevG = G;
    }

    _seguir(t, frameId, dets, P) {
      const vivos = this.tracks;
      const usados = new Set();
      // costos de asociación (distancia a la posición predicha, penalizada por baja superposición)
      const cost = vivos.map(tr => dets.map(d => {
        if (GRUPO(d.clase) !== tr.grupo) return Infinity;
        const dt = t - tr.ult.t, vx = tr.vx || 0, vy = tr.vy || 0; // predicción con velocidad constante
        const pb = { x: tr.ult.bbox.x + vx * dt, y: tr.ult.bbox.y + vy * dt, w: tr.ult.bbox.w, h: tr.ult.bbox.h };
        const u = iou(pb, d.bbox); const c1 = { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 }, c2 = { x: d.bbox.x + d.bbox.w / 2, y: d.bbox.y + d.bbox.h / 2 };
        const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y); const lim = 0.12 + 0.06 * dt;
        return (u > 0.1 || dist < lim) ? dist - 0.05 * u : Infinity;
      }));
      // asignación óptima global (fuerza bruta acotada para grupos pequeños; voraz para multitudes)
      const asig = AN.asignar(cost);
      asig.forEach(([i, j]) => { usados.add(j); this._actualizar(vivos[i], t, frameId, dets[j], P); });
      dets.forEach((d, j) => { if (usados.has(j)) return; const tr = { id: this.nextId++, grupo: GRUPO(d.clase), clase: d.clase, pts: [], inicio: t, zonas: {}, atributos: [] }; vivos.push(tr); this._actualizar(tr, t, frameId, d, P); });
      // cerrar los que no se ven hace > 3 s
      for (let i = vivos.length - 1; i >= 0; i--) if (t - vivos[i].ult.t > 4) { this._cerrarTrack(vivos[i], P); this.cerrados.push(vivos[i]); vivos.splice(i, 1); }
      // ocupación por zona
      for (const z of this.cfg.zonas.filter(z => z.uso === 'ocupacion')) {
        const n = vivos.filter(tr => tr.grupo === 'persona' && tr.ult.t === t && inRect(tr.ult.pie, z.rect)).length;
        const o = this.ocupacion[z.id]; o.max = Math.max(o.max, n); o.suma += n; o.n++; o.serie.push({ t, n });
        const um = z.umbral || P.umbralAglomeracion;
        if (n >= um) { if (o.desde == null) { o.desde = t; o.frameId = frameId; o.pico = n; this._alerta('aglomeracion', { zona: z.nombre, personas: n, t }); } o.pico = Math.max(o.pico, n); }
        else if (o.desde != null) { this._evento('aglomeracion', o.desde, t, { zonaId: z.id, zona: z.nombre, detalle: { pico: o.pico, umbral: um }, frameId: o.frameId, score: 0.8 }); o.desde = null; }
      }
    }
    _actualizar(tr, t, frameId, d, P) {
      const pie = { x: d.bbox.x + d.bbox.w / 2, y: d.bbox.y + d.bbox.h };
      const prev = tr.ult;
      if (prev && t > prev.t) { const k = 0.6, dt = t - prev.t; tr.vx = k * ((d.bbox.x - prev.bbox.x) / dt) + (1 - k) * (tr.vx || 0); tr.vy = k * ((d.bbox.y - prev.bbox.y) / dt) + (1 - k) * (tr.vy || 0); }
      tr.ult = { t, frameId, bbox: d.bbox, pie, score: d.score, clase: d.clase };
      tr.pts.push({ t, pie, bbox: d.bbox, score: d.score, frameId });
      if (d.atributos) tr.atributos.push(d.atributos);
      if (!tr.mejor || d.score > tr.mejor.score) tr.mejor = { t, frameId, bbox: d.bbox, score: d.score };
      if (tr.grupo === 'persona') { const gx = Math.min(this.GW - 1, Math.floor(pie.x * this.GW)), gy = Math.min(this.GH - 1, Math.floor(Math.min(0.999, pie.y) * this.GH)); this.calor[gy * this.GW + gx]++; }
      // cruces de línea
      if (prev) for (const l of this.cfg.lineas) {
        if (l.clase && l.clase !== tr.grupo) continue; if (!l.clase && tr.grupo !== 'persona') continue;
        if (segInter(prev.pie, pie, l.a, l.b)) {
          const lado = Math.sign(cross(l.a, l.b, pie)); const sentido = lado === (l.sentidoEntrada || 1) ? 'entrada' : 'salida';
          const c = { t, trackId: tr.id, sentido, clase: tr.clase, frameId, bbox: d.bbox }; this.cruces[l.id].push(c);
          this._evento('cruce_linea', t, t, { lineaId: l.id, linea: l.nombre, trackId: tr.id, sentido, detalle: { sentido, clase: tr.clase }, frameId, bbox: d.bbox, score: d.score });
          if (sentido === 'entrada') {
            const P2 = this.cfg.parametros.tailgatingS; const prevE = this.cruces[l.id].filter(x => x.sentido === 'entrada' && x.trackId !== tr.id && t - x.t <= P2 && x.t <= t);
            if (prevE.length && !this.cruces[l.id].some(x => x.tailgating && t - x.t <= P2)) { c.tailgating = true; this._evento('ingreso_grupal', prevE[0].t, t, { lineaId: l.id, linea: l.nombre, detalle: { personas: prevE.length + 1, ventanaS: P2 }, frameId, bbox: d.bbox, score: 0.8 }); }
          }
        }
      }
      // zonas
      for (const z of this.cfg.zonas) {
        const dentro = inRect(pie, z.rect); const st = tr.zonas[z.id] || (tr.zonas[z.id] = { dentro: false });
        if (dentro && !st.dentro) { st.dentro = true; st.desde = t; st.frameId = frameId; st.bbox = d.bbox; st.reportado = {}; if (z.uso === 'restringida' && tr.grupo === 'persona') { this._evento('intrusion', t, t, { zonaId: z.id, zona: z.nombre, trackId: tr.id, frameId, bbox: d.bbox, score: d.score, detalle: { clase: tr.clase } }); this._alerta('intrusion', { zona: z.nombre, t }); } }
        if (dentro) {
          st.hasta = t; st.ultFrame = frameId; st.ultBbox = d.bbox; const dur = t - st.desde;
          if (z.uso === 'restringida' && tr.grupo === 'persona' && dur >= (z.merodeoS || P.merodeoS) && !st.reportado.merodeo) { st.reportado.merodeo = 1; this._alerta('merodeo', { zona: z.nombre, duracionS: dur, t }); }
          if (z.uso === 'no_parqueo' && tr.grupo === 'vehiculo' && dur >= (z.parqueoS || P.parqueoS) && !st.reportado.parqueo) { st.reportado.parqueo = 1; this._alerta('mal_parqueado', { zona: z.nombre, duracionS: dur, t }); }
        }
        if (!dentro && st.dentro) this._salirZona(tr, z, st, P);
      }
    }
    _salirZona(tr, z, st, P) {
      st.dentro = false; const dur = st.hasta - st.desde;
      if (z.uso === 'restringida' && tr.grupo === 'persona' && dur >= (z.merodeoS || P.merodeoS)) this._evento('merodeo', st.desde, st.hasta, { zonaId: z.id, zona: z.nombre, trackId: tr.id, frameId: st.ultFrame, bbox: st.ultBbox, score: 0.85, detalle: { duracionS: dur, umbralS: z.merodeoS || P.merodeoS } });
      if (z.uso === 'no_parqueo' && tr.grupo === 'vehiculo' && dur >= (z.parqueoS || P.parqueoS)) this._evento('mal_parqueado', st.desde, st.hasta, { zonaId: z.id, zona: z.nombre, trackId: tr.id, frameId: st.ultFrame, bbox: st.ultBbox, score: 0.85, detalle: { duracionS: dur, umbralS: z.parqueoS || P.parqueoS, clase: tr.clase } });
    }
    _cerrarTrack(tr, P) { for (const z of this.cfg.zonas) { const st = tr.zonas[z.id]; if (st && st.dentro) this._salirZona(tr, z, st, P); } tr.fin = tr.ult.t; }
    _cerrarPuerta(pu, t, P) {
      const dur = t - pu.abiertaDesde;
      if (dur >= (pu.p.puertaS || P.puertaS)) this._evento('puerta_abierta', pu.abiertaDesde, t, { puertaId: pu.p.id, puerta: pu.p.nombre, frameId: pu.frameId, bbox: pu.p.rect, score: Math.min(1, pu.dmax * 3), detalle: { duracionS: dur, umbralS: pu.p.puertaS || P.puertaS, diferenciaMax: +pu.dmax.toFixed(3) } });
      pu.abiertaDesde = null;
    }
    _humo(t, frameId, G, dets) {
      const R = this.ref; const cand = new Uint8Array(G.m.length); let n = 0;
      for (let k = 0; k < G.m.length; k++) {
        if (this._celdaEnMascara(k) || t - this.excl[k] < 4) continue;
        const aclara = G.m[k] - R.m[k] > 12 && G.m[k] > 110;         // se vuelve más claro/gris
        const pierdeTextura = G.sd[k] < R.sd[k] * 0.75 || G.sd[k] < 6; // pierde contraste
        const gris = G.st[k] < 0.18;                                   // baja saturación
        if (aclara && pierdeTextura && gris) { cand[k] = 1; n++; }
      }
      // mayor componente conexa
      const seen = new Uint8Array(cand.length); let best = [];
      for (let i = 0; i < cand.length; i++) { if (!cand[i] || seen[i]) continue; const st = [i], comp = []; seen[i] = 1; while (st.length) { const k = st.pop(); comp.push(k); const x = k % this.GW, y = Math.floor(k / this.GW); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= this.GW || ny >= this.GH) return; const j = ny * this.GW + nx; if (cand[j] && !seen[j]) { seen[j] = 1; st.push(j); } }); } if (comp.length > best.length) best = comp; }
      const H = this.humo; const area = best.length;
      if (area >= 8) {
        if (H.inicio == null) { H.inicio = t; H.cuenta = 0; H.creciente = 0; }
        H.cuenta++; if (area >= H.areaPrev) H.creciente++;
        if (area > H.max) { H.max = area; H.frameId = frameId; H.bbox = this._bboxCeldas(best); }
        H.areaPrev = area;
        if (H.cuenta >= 4 && H.creciente >= 3 && !H.alertado) { H.alertado = true; this._alerta('humo', { areaCeldas: area, t, experimental: true }); }
      } else if (H.inicio != null) {
        if (H.cuenta >= 4 && H.creciente >= 3) this._evento('humo', H.inicio, t, { frameId: H.frameId, bbox: H.bbox, score: Math.min(0.7, H.max / 60), detalle: { areaMaxCeldas: H.max, muestras: H.cuenta, advertencia: 'Heurística experimental; confirmar visualmente y con detectores certificados' } });
        H.inicio = null; H.cuenta = 0; H.max = 0; H.areaPrev = 0; H.alertado = false;
      }
      this._humoCeldas = cand;
      if (!this.humoT) this.humoT = new Float32Array(cand.length).fill(-1e9);
      if (H.inicio != null) for (let k = 0; k < cand.length; k++) { const x = k % this.GW, y = Math.floor(k / this.GW); if (cand[k]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < this.GW && ny < this.GH) this.humoT[ny * this.GW + nx] = t; } }
    }
    _bboxCeldas(cs) { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; cs.forEach(k => { const x = k % this.GW, y = Math.floor(k / this.GW); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); return { x: x0 / this.GW, y: y0 / this.GH, w: (x1 - x0 + 1) / this.GW, h: (y1 - y0 + 1) / this.GH }; }
    _abandono(t, frameId, G, P) {
      const R = this.ref, prev = this.prevG; const cand = [];
      for (let k = 0; k < G.m.length; k++) {
        const cambiado = Math.abs(G.m[k] - R.m[k]) > 22 || Math.abs(G.sd[k] - R.sd[k]) > 12;
        const quieto = prev ? Math.abs(G.m[k] - prev.m[k]) < 6 : false;
        const libre = t - this.excl[k] > 10 && !this._celdaEnMascara(k) && !(this.humoT && t - this.humoT[k] < 30);
        if (cambiado && quieto && libre) { if (this.cambioDesde[k] < 0) this.cambioDesde[k] = t; if (t - this.cambioDesde[k] >= P.abandonoS) cand.push(k); }
        else this.cambioDesde[k] = -1;
      }
      if (cand.length >= 2) {
        const key = cand.slice(0, 3).join(',');
        const bb = this._bboxCeldas(cand);
        if (!this.abandono.activo || !overlap(this.abandono.activo.bbox, bb)) {
          const desde = Math.min(...cand.map(k => this.cambioDesde[k]));
          this.abandono.activo = { desde, bbox: bb, frameId, key };
          this._alerta('objeto_abandonado', { t, bbox: bb });
          this._evento('objeto_abandonado', desde, t, { frameId, bbox: bb, score: 0.75, detalle: { celdas: cand.length, umbralS: P.abandonoS, criterio: 'cambio estático respecto al fondo sin personas ni vehículos cerca' } });
        } else { const e = this.eventos.filter(x => x.tipo === 'objeto_abandonado').pop(); if (e) e.fin = t; }
      } else this.abandono.activo = null;
    }

    // ---- estado instantáneo (uso en vivo) ----
    ocupacionActual() { return this.cfg.zonas.filter(z => z.uso === 'ocupacion').map(z => ({ zona: z.nombre, n: this.tracks.filter(tr => tr.grupo === 'persona' && this.ultT - tr.ult.t <= 1 && inRect(tr.ult.pie, z.rect)).length, max: this.ocupacion[z.id].max })); }
    crucesDesde() { return this.cfg.lineas.map(l => { const cs = this.cruces[l.id]; return { linea: l.nombre, lineaId: l.id, entradas: cs.filter(c => c.sentido === 'entrada').length, salidas: cs.filter(c => c.sentido === 'salida').length, cruces: cs.map(c => ({ t: c.t, sentido: c.sentido })) }; }); }
    estadoActual() { return { puertas: this.puertas.map(pu => ({ puerta: pu.p.nombre, abierta: pu.abiertaDesde != null, desdeS: pu.abiertaDesde != null ? this.ultT - pu.abiertaDesde : null })), ocupacion: this.ocupacionActual(), manipulacion: this.tamper.activo != null ? this.tamper.tipo : null, humo: this.humo.alertado || false }; }

    /** Cierra el análisis y devuelve eventos, pistas, conteos, ocupación y mapa de calor. */
    finish() {
      const t = this.ultT, P = this.cfg.parametros;
      this.tracks.forEach(tr => { this._cerrarTrack(tr, P); this.cerrados.push(tr); }); this.tracks = [];
      this.puertas.forEach(pu => { if (pu.abiertaDesde != null) this._cerrarPuerta(pu, t, P); });
      if (this.tamper.activo != null) this._evento('manipulacion', this.tamper.activo, t, { detalle: { tipo: this.tamper.tipo }, frameId: this.tamper.frameId, score: 0.9 });
      if (this.humo.inicio != null && this.humo.cuenta >= 4 && this.humo.creciente >= 3) this._evento('humo', this.humo.inicio, t, { frameId: this.humo.frameId, bbox: this.humo.bbox, score: Math.min(0.7, this.humo.max / 60), detalle: { areaMaxCeldas: this.humo.max, advertencia: 'Heurística experimental' } });
      const pistas = this.cerrados.filter(tr => tr.pts.length >= 2 || tr.mejor.score >= 0.7).map(tr => {
        const cnt = {}; const col = k => { const c = {}; tr.atributos.forEach(a => { if (a[k]) c[a[k]] = (c[a[k]] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; };
        const sup = col('superior'), inf = col('inferior');
        return { trackId: tr.id, grupo: tr.grupo, clase: tr.clase, inicio: tr.inicio, fin: tr.fin, muestras: tr.pts.length, mejor: tr.mejor, atributos: tr.grupo === 'persona' && tr.atributos.length ? { superior: sup && sup[0], inferior: inf && inf[0], muestras: tr.atributos.length } : null, trayectoria: tr.pts.map(p => [p.t, +p.pie.x.toFixed(3), +p.pie.y.toFixed(3)]) };
      });
      const conteos = this.cfg.lineas.map(l => { const cs = this.cruces[l.id]; return { lineaId: l.id, linea: l.nombre, clase: l.clase || 'persona', entradas: cs.filter(c => c.sentido === 'entrada').length, salidas: cs.filter(c => c.sentido === 'salida').length, cruces: cs.map(c => ({ t: c.t, sentido: c.sentido, trackId: c.trackId, tailgating: !!c.tailgating })) }; });
      const ocupacion = this.cfg.zonas.filter(z => z.uso === 'ocupacion').map(z => { const o = this.ocupacion[z.id]; return { zonaId: z.id, zona: z.nombre, max: o.max, media: o.n ? +(o.suma / o.n).toFixed(2) : 0, serie: o.serie.filter((x, i) => i % 5 === 0 || x.n) }; });
      const puertas = this.puertas.map(pu => ({ puertaId: pu.p.id, puerta: pu.p.nombre, serie: pu.serie.filter((x, i) => i % 5 === 0 || x.abierta) }));
      return { motor: 'analitica-v1', ia: this.ia, eventos: this.eventos, pistas, conteos, ocupacion, puertas, calor: { w: this.GW, h: this.GH, grid: Array.from(this.calor) }, parametros: P, muestras: this.n };
    }
  }
  AN.Motor = Motor;
  // Los tipos de analítica se integran al vocabulario de clases del resto del sistema
  Object.keys(AN.TIPOS).forEach(k => { V.GRUPOS_CLASE[k] = [k]; V.CLASES_ES[k] = AN.TIPOS[k].nombre; });
  AN.esEvento = c => !!AN.TIPOS[c];

  /** Configuración de ejemplo que corresponde al video de demostración de casos de uso. */
  AN.configDemo = () => ({
    zonas: [
      { id: 'z_salon', nombre: 'Salón (interior)', uso: 'ocupacion', rect: { x: 0.52, y: 0.3, w: 0.48, h: 0.7 }, umbral: 2 },
      { id: 'z_restringida', nombre: 'Zona restringida (bodega)', uso: 'restringida', rect: { x: 0.64, y: 0.6, w: 0.32, h: 0.22 }, merodeoS: 20 },
      { id: 'z_noparqueo', nombre: 'No estacionar (acceso)', uso: 'no_parqueo', rect: { x: 0.03, y: 0.55, w: 0.42, h: 0.45 }, parqueoS: 30 }
    ],
    lineas: [{ id: 'l_acceso', nombre: 'Acceso al salón', a: { x: 0.5, y: 0.3 }, b: { x: 0.5, y: 1.0 }, sentidoEntrada: -1 }],
    puertas: [{ id: 'p_bodega', nombre: 'Puerta de bodega', rect: { x: 0.745, y: 0.125, w: 0.185, h: 0.155 }, puertaS: 10 }],
    parametros: Object.assign({}, AN.PARAM_DEF, { umbralAglomeracion: 2 })
  });
})();
