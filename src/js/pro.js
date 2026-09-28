/* VIGÍA · funciones avanzadas de procesamiento:
 *  - Sinopsis de video (resumen condensado: objetos de distintos momentos mostrados a la vez sobre el fondo)
 *  - Redacción de privacidad (pixelado de personas) en imágenes y clips
 *  - Paquete de evidencia verificable (ZIP + manifiesto + SHA256SUMS + cadena de custodia)
 * Todo se ejecuta en el navegador; ningún binario sale del equipo. */
(function () {
  'use strict';
  const V = window.V;
  const M = V.media;
  const iou = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.w * a.h + b.w * b.h - i || 1); };

  // ============================ SINOPSIS ============================
  const S = V.sinopsis = {};
  const muestras = p => (p.trayectoria || []).filter(q => q.length >= 7).map(q => ({ t: q[0], bbox: { x: q[3], y: q[4], w: q[5], h: q[6] } }));

  /** Filtra pistas por grupo, color y ventana. */
  S.filtrar = function (pistas, f) {
    f = f || {};
    return (pistas || []).filter(p => {
      const g = p.grupo || (V.GRUPOS_CLASE.persona.includes(p.clase) ? 'persona' : V.GRUPOS_CLASE.vehiculo.includes(p.clase) ? 'vehiculo' : 'otro');
      if (f.grupos && f.grupos.length && !f.grupos.includes(g)) return false;
      if (f.superior && !(p.atributos && p.atributos.superior === f.superior)) return false;
      if (f.inferior && !(p.atributos && p.atributos.inferior === f.inferior)) return false;
      if (f.desde != null && p.fin < f.desde) return false;
      if (f.hasta != null && p.inicio > f.hasta) return false;
      return muestras(p).length >= 2;
    });
  };

  /**
   * Coloca cada pista en la línea de tiempo condensada con el menor desplazamiento que no la superponga
   * (IoU > umbral) con las ya colocadas. Resultado: duración de la sinopsis y desplazamiento de cada pista.
   */
  S.planificar = function (pistas, opts) {
    opts = opts || {};
    const umbral = opts.umbral != null ? opts.umbral : 0.2; const tolerancia = opts.tolerancia != null ? opts.tolerancia : 0.35; // superposición leve aceptada (como en los productos comerciales)
    const ocup = new Map(); // segundo de sinopsis → cajas colocadas
    const items = [];
    const ord = pistas.slice().sort((a, b) => a.inicio - b.inicio);
    const maxDur = Math.max(1, ...ord.map(p => Math.ceil(p.fin - p.inicio) + 1));
    const limite = Math.max(opts.maxLen || 0, maxDur * 3, 30);
    for (const p of ord) {
      const ms = muestras(p).map(m => ({ s: Math.round(m.t - p.inicio), bbox: m.bbox }));
      const dur = ms.length ? ms[ms.length - 1].s : 0;
      let mejor = { o: 0, c: Infinity };
      for (let o = 0; o + dur <= limite; o++) {
        let c = 0;
        for (const m of ms) { const occ = ocup.get(o + m.s); if (occ) for (const b of occ) { const u = iou(b, m.bbox); if (u > umbral) c += u; } }
        if (c < mejor.c) mejor = { o, c };
        if (c <= tolerancia) { mejor = { o, c }; break; }
      }
      for (const m of ms) { const k = mejor.o + m.s; if (!ocup.has(k)) ocup.set(k, []); ocup.get(k).push(m.bbox); }
      items.push({ pista: p, offset: mejor.o, dur, muestras: ms, colision: +mejor.c.toFixed(3) });
    }
    const len = items.reduce((a, it) => Math.max(a, it.offset + it.dur + 1), 0);
    const original = ord.length ? Math.ceil(Math.max(...ord.map(p => p.fin)) - Math.min(...ord.map(p => p.inicio))) + 1 : 0;
    return { len, original, items, compresion: len ? +(original / len).toFixed(1) : null };
  };

  /** Fondo por mediana de N fotogramas (elimina objetos en movimiento). */
  S.fondo = async function (v, W, n) {
    const dur = v.duration; const H = Math.round(W * v.videoHeight / v.videoWidth);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
    const datos = [];
    for (let i = 0; i < n; i++) { await M.seek(v, (i + 0.5) * dur / n); g.drawImage(v, 0, 0, W, H); datos.push(g.getImageData(0, 0, W, H).data); }
    const out = g.createImageData(W, H); const tmp = new Uint8Array(n); const mid = n >> 1;
    for (let i = 0; i < out.data.length; i++) {
      if ((i & 3) === 3) { out.data[i] = 255; continue; }
      for (let k = 0; k < n; k++) tmp[k] = datos[k][i];
      tmp.sort(); out.data[i] = tmp[mid];
    }
    g.putImageData(out, 0, 0); return c;
  };

  /** Recorta cada muestra de cada pista desde el video original (una búsqueda por segundo distinto). */
  S.preparar = async function (blob, plan, opts) {
    opts = opts || {}; const W = opts.ancho || 640;
    const v = await M.openVideo(blob);
    try {
      const fondo = await S.fondo(v, W, opts.nFondo || 15);
      const H = fondo.height;
      const porT = new Map();
      plan.items.forEach(it => muestras(it.pista).forEach((m, j) => { const k = +m.t.toFixed(3); if (!porT.has(k)) porT.set(k, []); porT.get(k).push({ it, j, bbox: m.bbox }); }));
      const tiempos = [...porT.keys()].sort((a, b) => a - b).slice(0, opts.maxBusquedas || 2400);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      plan.items.forEach(it => { it.recortes = new Array(it.muestras.length).fill(null); });
      for (let i = 0; i < tiempos.length; i++) {
        const t = tiempos[i]; await M.seek(v, t + 0.001); g.drawImage(v, 0, 0, W, H);
        for (const { it, j, bbox } of porT.get(t)) {
          const px = { x: Math.max(0, Math.floor((bbox.x - bbox.w * 0.06) * W)), y: Math.max(0, Math.floor((bbox.y - bbox.h * 0.04) * H)) };
          px.w = Math.min(W - px.x, Math.ceil(bbox.w * 1.12 * W)); px.h = Math.min(H - px.y, Math.ceil(bbox.h * 1.08 * H));
          if (px.w < 2 || px.h < 2) continue;
          const r = document.createElement('canvas'); r.width = px.w; r.height = px.h; r.getContext('2d').drawImage(c, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
          it.recortes[j] = { c: r, x: px.x / W, y: px.y / H, w: px.w / W, h: px.h / H };
        }
        if (opts.onProgress && (i % 5 === 0 || i === tiempos.length - 1)) opts.onProgress((i + 1) / tiempos.length);
      }
      return { fondo, W, H };
    } finally { M.closeVideo(v); }
  };

  const COLORES = ['#19c2ad', '#f2a33a', '#e5484d', '#3987e5', '#b36ae2', '#46a758', '#e36f9e', '#d6b31c'];
  /** Dibuja el instante s (segundos de sinopsis, admite fracciones) y devuelve las cajas visibles (para clic). */
  S.dibujar = function (ctx, prep, plan, s, opts) {
    opts = opts || {}; const { W, H } = prep; const visibles = [];
    ctx.drawImage(prep.fondo, 0, 0, W, H);
    plan.items.forEach((it, idx) => {
      const u = s - it.offset; if (u < 0 || u > it.dur + 0.999) return;
      let j = 0; while (j + 1 < it.muestras.length && it.muestras[j + 1].s <= u) j++;
      const a = it.muestras[j], b = it.muestras[Math.min(j + 1, it.muestras.length - 1)];
      const rc = it.recortes[j] || it.recortes.find(Boolean); if (!rc) return;
      const k = b.s > a.s ? V.clamp((u - a.s) / (b.s - a.s), 0, 1) : 0;
      const dx = (b.bbox.x - a.bbox.x) * k, dy = (b.bbox.y - a.bbox.y) * k; // desplazamiento interpolado entre muestras de 1 s
      const x = (rc.x + dx) * W, y = (rc.y + dy) * H, w = rc.w * W, h = rc.h * H;
      ctx.globalAlpha = 0.92; ctx.drawImage(rc.c, x, y, w, h); ctx.globalAlpha = 1;
      const col = COLORES[idx % COLORES.length];
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      const tReal = it.pista.inicio + a.s;
      const lab = opts.etiqueta ? opts.etiqueta(it.pista, tReal) : V.fmtDur(tReal);
      ctx.font = '600 11px system-ui, sans-serif'; const tw = ctx.measureText(lab).width + 8;
      ctx.fillStyle = col; ctx.fillRect(x, Math.max(0, y - 15), tw, 15); ctx.fillStyle = '#081016'; ctx.fillText(lab, x + 4, Math.max(11, y - 4));
      visibles.push({ it, x: x / W, y: y / H, w: w / W, h: h / H, tReal });
    });
    if (opts.marca) { ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H - 20, W, 20); ctx.fillStyle = '#fff'; ctx.fillText(opts.marca, 8, H - 6); }
    return visibles;
  };

  /** Imagen estroboscópica: todas las pistas en su mejor muestra sobre el fondo (ideal para informes). */
  S.estroboscopica = function (prep, plan, opts) {
    const c = document.createElement('canvas'); c.width = prep.W; c.height = prep.H; const g = c.getContext('2d');
    g.drawImage(prep.fondo, 0, 0);
    const alt = { W: prep.W, H: prep.H, fondo: c };
    const falso = { items: plan.items.map(it => { const j = Math.max(0, it.muestras.findIndex(m => Math.abs(it.pista.inicio + m.s - ((it.pista.mejor && it.pista.mejor.t) || it.pista.inicio)) < 0.6)); return Object.assign({}, it, { offset: -it.muestras[j].s, muestras: it.muestras, recortes: it.recortes }); }) };
    S.dibujar(g, alt, falso, 0, opts);
    return c;
  };

  /** Graba la sinopsis como WebM (recodificada: es un derivado sintético, no evidencia original). */
  S.grabar = async function (prep, plan, opts) {
    opts = opts || {}; const fps = 10, vel = opts.velocidad || 2;
    const c = document.createElement('canvas'); c.width = prep.W; c.height = prep.H; const g = c.getContext('2d');
    S.dibujar(g, prep, plan, 0, opts);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!mime || !c.captureStream) throw new V.VigiaError('NO_SOPORTADO', 'Este navegador no puede grabar video desde un lienzo.');
    const st = c.captureStream(fps); const rec = new MediaRecorder(st, { mimeType: mime, videoBitsPerSecond: 3e6 }); const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data); const fin = new Promise(r => rec.onstop = r);
    rec.start(500);
    const total = Math.ceil(plan.len * fps / vel);
    for (let f = 0; f <= total; f++) {
      S.dibujar(g, prep, plan, f * vel / fps, opts);
      if (opts.onProgress) opts.onProgress(f / total);
      await new Promise(r => setTimeout(r, 1000 / fps));
    }
    rec.stop(); await fin; st.getTracks().forEach(t => t.stop());
    return new Blob(chunks, { type: 'video/webm' });
  };

  // ============================ PRIVACIDAD ============================
  const PV = V.privacidad = {};
  /** Pixelado irreversible de una región (bbox normalizada). modo: 'cuerpo' | 'cabeza'. */
  PV.pixelar = function (g, W, H, bbox, modo) {
    const m = 0.08; let x = (bbox.x - bbox.w * m) * W, y = (bbox.y - bbox.h * m * 0.5) * H, w = bbox.w * (1 + 2 * m) * W, h = bbox.h * (1 + m) * H;
    if (modo === 'cabeza') h = h * 0.32;
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y)); w = Math.min(W - x, Math.ceil(w)); h = Math.min(H - y, Math.ceil(h));
    if (w < 2 || h < 2) return;
    const bloque = Math.max(6, Math.round(Math.max(w, h) / 10));
    const t = document.createElement('canvas'); t.width = Math.max(1, Math.round(w / bloque)); t.height = Math.max(1, Math.round(h / bloque));
    const tg = t.getContext('2d'); tg.drawImage(g.canvas, x, y, w, h, 0, 0, t.width, t.height);
    g.save(); g.imageSmoothingEnabled = false; g.drawImage(t, 0, 0, t.width, t.height, x, y, w, h); g.restore();
  };
  /** Cajas a ocultar en el instante t: detecciones del segundo anterior y posterior (cubre el movimiento entre muestras). */
  PV.cajasEn = function (cajas, t, ventana) {
    const v = ventana != null ? ventana : 1.01; return cajas.filter(c => Math.abs(c.t - t) <= v).map(c => c.bbox);
  };
  PV.redactarImagen = async function (blob, bboxes, modo) {
    const img = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); img.close && img.close();
    bboxes.forEach(b => PV.pixelar(g, c.width, c.height, b, modo));
    return M.toBlob(c, 'image/png');
  };
  /**
   * Genera una versión con privacidad de un clip (recodificada; se registra como transformación con su propio hash).
   * Usa las detecciones de persona de la grabación de origen (requiere haber analizado con IA).
   */
  PV.redactarClip = async function (api, token, derivId, opts) {
    opts = opts || {};
    const d = await api.getDerivative(token, derivId);
    if (!d.recordingId) throw new V.VigiaError('VALIDACION', 'El clip no tiene grabación de origen.');
    const cajas = await api.privacyBoxes(token, d.recordingId, opts.clases);
    if (!cajas.length) throw new V.VigiaError('SIN_DETECCIONES', 'No hay detecciones de personas en la grabación de origen. Analice la grabación con el motor IA para poder ocultarlas.');
    const src = (await api.mediaURL(token, 'derivado', d.id, 'ver')).blob;
    const v = await M.openVideo(src);
    try {
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext('2d');
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
      const st = c.captureStream(25); const rec = new MediaRecorder(st, { mimeType: mime, videoBitsPerSecond: 4e6 }); const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data); const fin = new Promise(r => rec.onstop = r);
      const base = d.inicio || 0; let ocultas = 0;
      const pintar = () => { g.drawImage(v, 0, 0, c.width, c.height); const bs = PV.cajasEn(cajas, base + v.currentTime); ocultas = Math.max(ocultas, bs.length); bs.forEach(b => PV.pixelar(g, c.width, c.height, b, opts.modo)); };
      await M.seek(v, 0); pintar(); rec.start(500); await v.play();
      const limite = performance.now() + (v.duration * 3000) + 10000;
      await new Promise((res, rej) => { const tick = () => { if (v.error) return rej(new V.VigiaError('DECODIFICACION', 'Error al decodificar el clip.')); pintar(); if (opts.onProgress) opts.onProgress(v.currentTime / v.duration); if (v.ended || v.currentTime >= v.duration - 0.02 || performance.now() > limite) res(); else setTimeout(tick, 33); }; tick(); });
      v.pause(); rec.stop(); await fin; st.getTracks().forEach(t => t.stop());
      const out = new Blob(chunks, { type: 'video/webm' });
      return api.saveDerivative(token, d.recordingId, out, {
        tipo: 'clip', nombre: V.safeName(d.nombre).replace(/\.\w+$/, '') + '_privacidad.webm', inicio: d.inicio, fin: d.fin, privacidad: true, origenDerivado: d.id, origenDerivadoSha256: d.sha256,
        metodo: 'redacción de privacidad (' + (opts.modo === 'cabeza' ? 'cabezas' : 'personas completas') + ' pixeladas) y recodificación WebM',
        transformacion: 'redacción de privacidad: pixelado irreversible de personas según detecciones IA (±1 s); recodificado', tAbs: d.tAbs, detalle: { cajas: cajas.length, maxSimultaneas: ocultas }
      });
    } finally { M.closeVideo(v); }
  };

  // ============================ PAQUETE DE EVIDENCIA ============================
  const PK = V.paquete = {};
  const csv = rows => rows.map(r => r.map(x => { const s = x == null ? '' : String(x); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
  PK.construir = async function (api, token, caseId, opts) {
    opts = opts || {}; const priv = !!opts.privacidad;
    const prog = (p, m) => opts.onProgress && opts.onProgress(p, m);
    prog(0.02, 'reuniendo evidencias');
    const d = await api.casePackage(token, caseId, { incluirOriginales: !!opts.incluirOriginales && !priv, privacidad: priv });
    const files = []; const manifiesto = []; const omitidos = [];
    let informe = null; try { prog(0.1, 'generando informe'); informe = await V.reports.generar(api, token, caseId); } catch (e) { omitidos.push({ archivo: 'informe.html', motivo: V.errMsg(e) }); }
    const cajasPorRec = new Map();
    const cajasDe = async recId => { if (!cajasPorRec.has(recId)) cajasPorRec.set(recId, await api.privacyBoxes(token, recId).catch(() => [])); return cajasPorRec.get(recId); };
    let n = 0;
    for (const it of d.items) {
      n++; prog(0.15 + 0.7 * n / Math.max(1, d.items.length), 'evidencia ' + n + ' de ' + d.items.length);
      const e = it.evidencia; const pref = 'evidencias/' + String(n).padStart(2, '0') + '_' + e.tipo + '_';
      if (it.error) { omitidos.push({ evidencia: e.id, motivo: it.error }); continue; }
      if (!it.archivos.length) manifiesto.push({ evidencia: e.id, tipo: e.tipo, clasificacion: e.clasificacion, archivo: null, nota: e.tipo === 'grabacion' ? 'Original no incluido (' + (priv ? 'modo privacidad' : 'active «incluir originales»') + '); se referencia por su SHA-256.' : 'Sin binario asociado', sha256Referencia: e.sha256 || (it.ref && it.ref.sha256) || null });
      for (const a of it.archivos) {
        let blob = a.blob, nombre = pref + V.safeName(a.nombre), trans = null;
        const esImagen = /image\//.test(blob.type) || /\.(jpe?g|png)$/i.test(a.nombre);
        if (priv && (a.rol === 'clip' || a.rol === 'original') && !(it.ref && it.ref.privacidad)) { omitidos.push({ evidencia: e.id, archivo: a.nombre, motivo: 'Modo privacidad: el video sin redactar no se exporta. Genere «versión con privacidad» del clip y añádala al expediente.' }); continue; }
        if (priv && esImagen && it.grabacion) {
          const t = a.frame ? a.frame.t : (it.ref && it.ref.inicio != null ? it.ref.inicio : null);
          const bbs = t != null ? V.privacidad.cajasEn(await cajasDe(it.grabacion.id), t, 0.51) : [];
          if (it.ref && it.ref.bbox && V.GRUPOS_CLASE.persona.includes(it.ref.clase)) bbs.push(it.ref.bbox);
          blob = await V.privacidad.redactarImagen(blob, bbs, opts.modo); nombre = nombre.replace(/\.\w+$/, '') + '_privacidad.png'; trans = 'pixelado de ' + bbs.length + ' región(es) de persona';
        }
        const sha = await V.sha256Blob(blob);
        files.push({ nombre, datos: blob });
        manifiesto.push({ evidencia: e.id, tipo: e.tipo, rol: a.rol, clasificacion: e.clasificacion, archivo: nombre, bytes: blob.size, sha256: sha, sha256Registrado: a.sha256 || null, coincideRegistro: trans ? null : (a.sha256 ? a.sha256 === sha : null), transformacion: trans || (it.ref && it.ref.transformacion) || 'ninguna', grabacionOrigen: it.grabacion ? { id: it.grabacion.id, archivo: it.grabacion.nombreArchivo, sha256: it.grabacion.sha256 } : null, intervalo: it.ref && it.ref.inicio != null ? { inicio: it.ref.inicio, fin: it.ref.fin } : null, metodo: it.ref && it.ref.metodo || null, comandoEquivalente: it.ref && it.ref.comandoEquivalente || null });
      }
    }
    prog(0.88, 'cadena de custodia y auditoría');
    const cab = ['secuencia', 'fecha_utc', 'usuario', 'accion', 'recurso', 'recurso_id', 'hash', 'hash_anterior'];
    files.push({ nombre: 'custodia/cadena_de_custodia.csv', datos: '﻿' + csv([cab, ...d.auditoria.map(a => [a.seq || '', new Date(a.ts).toISOString(), a.email, a.accion, a.recurso, a.recursoId, a.hash, a.prev])]) });
    files.push({ nombre: 'custodia/auditoria.json', datos: JSON.stringify(d.auditoria, null, 2) });
    files.push({ nombre: 'expediente/expediente.json', datos: JSON.stringify({ caso: d.caso, evidencias: d.evidencias, notas: d.notas, informes: d.informes.map(r => ({ version: r.version, formato: r.formato, sha256: r.sha256, en: r.en, por: r.creadoPor })) }, null, 2) });
    if (informe) files.push({ nombre: 'expediente/informe_v' + (informe.version || 1) + '.html', datos: informe.html || '' });
    const meta = { paquete: 'VIGÍA · paquete de evidencia', version: 1, organizacion: d.orgNombre, expediente: { id: d.caso.id, codigo: d.caso.codigo, titulo: d.caso.titulo, estado: d.caso.estado, aprobacion: d.caso.aprobacion }, exportadoPor: d.exportadoPor, exportadoEn: new Date(d.exportadoEn).toISOString(), modoPrivacidad: priv ? (opts.modo === 'cabeza' ? 'cabezas pixeladas' : 'personas pixeladas') : 'desactivado', originalesIncluidos: !!opts.incluirOriginales && !priv, evidencias: manifiesto, omitidos, advertencia: 'Informe preliminar. Los hallazgos sugeridos por motores automáticos requieren revisión humana. Este paquete no afirma admisibilidad legal.' };
    files.push({ nombre: 'manifiesto.json', datos: JSON.stringify(meta, null, 2) });
    files.push({ nombre: 'LEEME.txt', datos: [
      'VIGÍA · Paquete de evidencia ' + d.caso.codigo, '',
      'Contenido:', '  manifiesto.json          evidencias, hashes SHA-256, origen, intervalo y transformaciones',
      '  SHA256SUMS.txt           hashes de todos los archivos del paquete', '  evidencias/              clips, fotogramas y demás binarios',
      '  expediente/              expediente, notas e informe HTML', '  custodia/                cadena de custodia (CSV) y auditoría encadenada (JSON)', '',
      'Verificación de integridad:', '  Linux/macOS:  sha256sum -c SHA256SUMS.txt      (macOS: shasum -a 256 -c SHA256SUMS.txt)',
      '  Windows:      Get-FileHash -Algorithm SHA256 <archivo>   y compare con SHA256SUMS.txt', '',
      'Cadena de auditoría: cada registro incluye hash = SHA-256(hash_anterior | contenido). Una alteración rompe la cadena.',
      priv ? 'MODO PRIVACIDAD: las imágenes de personas están pixeladas (transformación irreversible); los videos sin redactar se omitieron.' : '',
      '', 'Exportado por ' + d.exportadoPor + ' el ' + new Date(d.exportadoEn).toISOString() + '.'].join('\r\n') });
    prog(0.93, 'calculando SHA-256');
    const sums = []; for (const f of files) { const b = typeof f.datos === 'string' ? new Blob([f.datos]) : f.datos; sums.push((await V.sha256Blob(b)) + '  ' + f.nombre); }
    files.push({ nombre: 'SHA256SUMS.txt', datos: sums.join('\n') + '\n' });
    prog(0.97, 'empaquetando');
    const zip = await V.zip(files.map(f => Object.assign({ fecha: d.exportadoEn }, f)));
    const sha = await V.sha256Blob(zip);
    try { await api._audit(api._ctx(token), 'expediente.paquete_generado', 'expediente', caseId, { sha256: sha, bytes: zip.size, archivos: files.length, privacidad: priv }); } catch (_) { }
    prog(1, 'listo');
    return { blob: zip, sha256: sha, nombre: V.safeName(d.caso.codigo + (priv ? '_privacidad' : '') + '_paquete') + '.zip', archivos: files.length, omitidos, manifiesto: meta };
  };
})();
