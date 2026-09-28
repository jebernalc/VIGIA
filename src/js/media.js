/* VIGÍA · media.js — ingesta, metadatos, fotogramas, detección visual, clips y trabajador asíncrono */
(function () {
  'use strict';
  const V = window.V;
  const M = V.media = {};

  // ---------------- utilidades de video ----------------
  M.blobReader = blob => ({ size: blob.size, read: async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()) });

  M.openVideo = async function (blob) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    const url = URL.createObjectURL(blob); v.src = url;
    v._url = url;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new V.VigiaError('DECODIFICACION', 'El navegador no pudo abrir el video (tiempo agotado).')), 20000);
      v.onloadedmetadata = () => { clearTimeout(to); res(); };
      v.onerror = () => { clearTimeout(to); rej(new V.VigiaError('DECODIFICACION', 'Este navegador no puede decodificar el video (códec no soportado). Pruebe con Chrome/Edge o convierta a H.264.')); };
    });
    if (!isFinite(v.duration)) { // WebM de MediaRecorder sin duración
      await new Promise(res => { const to = setTimeout(res, 5000); v.ondurationchange = () => { if (isFinite(v.duration)) { clearTimeout(to); res(); } }; v.currentTime = 1e7; });
      await M.seek(v, 0);
    }
    return v;
  };
  M.closeVideo = v => { try { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(v._url); } catch (_) { } };
  M.seek = function (v, t) {
    return new Promise((res) => {
      t = V.clamp(t, 0, Math.max(0, (v.duration || 0) - 0.001));
      if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res();
      const to = setTimeout(() => { v.removeEventListener('seeked', ok); res(); }, 8000);
      function ok() { clearTimeout(to); v.removeEventListener('seeked', ok); res(); }
      v.addEventListener('seeked', ok); v.currentTime = t;
    });
  };
  M.draw = function (v, w, canvas) {
    const vw = v.videoWidth || 640, vh = v.videoHeight || 360;
    const W = Math.min(w || vw, vw), H = Math.round(W * vh / vw);
    const c = canvas || document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, W, H); return c;
  };
  M.toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type || 'image/jpeg', q || 0.72));

  /** Metadatos: elemento de video + índice MP4 (si aplica). Nunca deduce hora de captura de la carga. */
  M.probe = async function (blob, contenedor) {
    const out = { duracion: null, ancho: null, alto: null, fps: null, codec: null, audio: null, horaContenedor: null, notas: [] };
    if (contenedor === 'mp4' && window.VIGIA_MP4CUT) {
      try {
        const mv = await window.VIGIA_MP4CUT.parseMovie(M.blobReader(blob));
        const vt = mv.info.videoTracks[0], at = mv.info.audioTracks[0];
        out.duracion = mv.duration;
        if (vt) { out.codec = vt.codec; out.ancho = vt.video ? vt.video.width : vt.track_width; out.alto = vt.video ? vt.video.height : vt.track_height; out.fps = vt.nb_samples && vt.duration ? +(vt.nb_samples / (vt.duration / vt.timescale)).toFixed(3) : null; }
        if (at) out.audio = at.codec + (at.audio ? ' · ' + at.audio.sample_rate + ' Hz' : '');
        const c = mv.created instanceof Date ? mv.created.getTime() : null;
        if (c && c > Date.UTC(2000, 0, 1) && c < Date.now() + 86400e3) out.horaContenedor = c;
        out.fragmentado = false;
      } catch (e) { out.notas.push('Índice MP4 no legible: ' + e.message); out.fragmentado = e.code === 'NO_SOPORTADO'; }
    }
    const v = await M.openVideo(blob);
    out.duracion = out.duracion || v.duration; out.ancho = out.ancho || v.videoWidth; out.alto = out.alto || v.videoHeight;
    if (!out.codec) out.codec = contenedor === 'webm' ? 'webm (VP8/VP9/AV1)' : 'desconocido';
    M.closeVideo(v);
    return out;
  };

  // ---------------- detector de movimiento (determinista, sin IA) ----------------
  class MotionDetector {
    constructor(mascaras) { this.prev = null; this.W = 160; this.mascaras = mascaras || []; }
    gray(canvas) {
      const W = this.W, H = Math.round(W * canvas.height / canvas.width);
      const c = this._c || (this._c = document.createElement('canvas')); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data; const out = new Float32Array(W * H);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const b = new Float32Array(W * H); // desenfoque 3x3
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += out[(y + dy) * W + x + dx]; b[y * W + x] = s / 9; }
      return { d: b, W, H };
    }
    /** Devuelve {movimiento, score, ratio, cajas:[{x,y,w,h} fracciones]} */
    step(canvas) {
      const g = this.gray(canvas); const p = this.prev; this.prev = g;
      if (!p || p.W !== g.W || p.H !== g.H) return { movimiento: false, score: 0, ratio: 0, cajas: [] };
      const { W, H } = g; const mask = new Uint8Array(W * H);
      for (const m of this.mascaras) { const x0 = Math.floor(m.x * W), y0 = Math.floor(m.y * H), x1 = Math.ceil((m.x + m.w) * W), y1 = Math.ceil((m.y + m.h) * H); for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) mask[y * W + x] = 1; }
      const CS = 8, CW = Math.ceil(W / CS), CH = Math.ceil(H / CS); const cnt = new Uint16Array(CW * CH), tot = new Uint16Array(CW * CH);
      let changed = 0, valid = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x; if (mask[i]) continue; valid++;
        const ci = Math.floor(y / CS) * CW + Math.floor(x / CS); tot[ci]++;
        if (Math.abs(g.d[i] - p.d[i]) > 22) { cnt[ci]++; changed++; }
      }
      const act = new Uint8Array(CW * CH); for (let i = 0; i < act.length; i++) act[i] = tot[i] && cnt[i] / tot[i] > 0.25 ? 1 : 0;
      const seen = new Uint8Array(CW * CH); const comps = [];
      for (let i = 0; i < act.length; i++) {
        if (!act[i] || seen[i]) continue; const st = [i]; seen[i] = 1; let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        while (st.length) { const k = st.pop(); n++; const cx = k % CW, cy = Math.floor(k / CW); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) return; const j = ny * CW + nx; if (act[j] && !seen[j]) { seen[j] = 1; st.push(j); } }); }
        comps.push({ n, x0, y0, x1, y1 });
      }
      const big = comps.filter(c => c.n >= 2); const largest = comps.reduce((m, c) => Math.max(m, c.n), 0);
      const ratio = valid ? changed / valid : 0;
      const movimiento = largest >= 3;
      const cajas = big.map(c => ({ x: c.x0 * CS / W, y: c.y0 * CS / H, w: (c.x1 - c.x0 + 1) * CS / W, h: (c.y1 - c.y0 + 1) * CS / H }));
      return { movimiento, score: Math.min(1, ratio * 15 + largest / 60), ratio, cajas };
    }
  }
  M.MotionDetector = MotionDetector;

  // ---------------- motor IA opcional (COCO-SSD local) ----------------
  const IA = V.ia = { estado: 'no_cargado', error: null, modelo: null, nombre: 'COCO-SSD (TensorFlow.js) · 80 clases COCO', motorId: 'coco-ssd-v2', base: 'motor-ia/' };
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se encontró ' + src)); document.head.appendChild(s); }); }
  IA.cargar = async function (onEtapa) {
    if (IA.estado === 'listo') return true;
    if (IA._p) return IA._p;
    IA.estado = 'cargando'; V.emit('ia:estado', IA);
    IA._p = (async () => {
      try {
        const et = s => { IA.etapa = s; V.emit('ia:estado', IA); if (onEtapa) onEtapa(s); };
        if (!window.tf) { et('Cargando TensorFlow.js local…'); await loadScript(IA.base + 'tf.min.js'); }
        if (!window.cocoSsd) { et('Cargando COCO-SSD…'); await loadScript(IA.base + 'coco-ssd.min.js'); }
        if (!window.VIGIA_MODELO_COCO) { et('Cargando pesos del modelo (≈24 MB, local)…'); await loadScript(IA.base + 'modelo-coco-ssd.js'); }
        et('Decodificando pesos…'); await V.sleep(20);
        const Mo = window.VIGIA_MODELO_COCO; const bin = atob(Mo.weightDataB64); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const h = await V.sha256Blob(new Blob([u]));
        if (h !== Mo.sha256) throw new Error('Integridad de pesos no coincide (SHA-256).');
        et('Inicializando backend (' + (await tf.ready(), tf.getBackend()) + ')…');
        IA.modelo = await cocoSsd.load({ base: 'mobilenet_v2', modelUrl: tf.io.fromMemory({ modelTopology: Mo.modelTopology, weightSpecs: Mo.weightSpecs, weightData: u.buffer }) });
        const c = document.createElement('canvas'); c.width = 64; c.height = 64; await IA.modelo.detect(c);
        delete Mo.weightDataB64;
        IA.backend = tf.getBackend(); IA.estado = 'listo'; IA.pesosSha256 = h; V.emit('ia:estado', IA); return true;
      } catch (e) { IA.estado = 'error'; IA.error = e.message + ' — ¿Existe la carpeta motor-ia junto a VIGIA.html?'; IA._p = null; V.emit('ia:estado', IA); throw e; }
    })();
    return IA._p;
  };
  IA.detectar = async function (canvas) {
    if (IA.estado !== 'listo') return null;
    const r = await IA.modelo.detect(canvas, 20, 0.5);
    return r.map(d => ({ clase: d.class, score: d.score, bbox: { x: d.bbox[0] / canvas.width, y: d.bbox[1] / canvas.height, w: d.bbox[2] / canvas.width, h: d.bbox[3] / canvas.height } }));
  };

  // ---------------- agrupación de detecciones en hallazgos ----------------
  M.groupFindings = function (dets, gap) {
    gap = gap || 2.6; const byClass = {}; dets.forEach(d => (byClass[d.clase] = byClass[d.clase] || []).push(d));
    const out = [];
    for (const [clase, arr] of Object.entries(byClass)) {
      arr.sort((a, b) => a.t - b.t); let cur = null;
      for (const d of arr) {
        if (cur && d.t - cur.fin <= gap) { cur.fin = d.t; cur.n++; if (d.score > cur.score) { cur.score = d.score; cur.best = d; } }
        else { if (cur) out.push(cur); cur = { clase, inicio: d.t, fin: d.t, n: 1, score: d.score, best: d, motor: d.motor }; }
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  // ---------------- trabajador de indexación ----------------
  const W = V.worker = { activo: false, actual: null };
  W.start = function (api) {
    if (W.api) return; W.api = api; W.h = api._workerHandle();
    W.h.resetStuck().then(() => W.kick());
    V.on('jobs:changed', () => W.kick());
  };
  W.kick = async function () {
    if (W.activo) return; W.activo = true;
    try {
      let job; while ((job = await W.h.nextJob())) await W.run(job);
    } finally { W.activo = false; }
  };
  W.run = async function (job, handle) {
    const h = handle || W.h, db = h.db; const t0 = performance.now();
    W.actual = job;
    await h.update(job, { estado: 'en_curso', etapa: 'metadatos', progreso: 0.01, iniciadoEn: Date.now() });
    let v = null;
    try {
      const rec = await db.get('recordings', job.recordingId);
      if (!rec) throw new Error('Grabación no encontrada');
      const cam = await db.get('cameras', rec.cameraId);
      const blob = await h.getBlob(job.org, rec.blobKey);
      // 1) metadatos
      if (rec.duracion == null || job.opciones.reanalisis) {
        const p = await M.probe(blob, rec.contenedor);
        Object.assign(rec, { duracion: p.duracion, ancho: p.ancho, alto: p.alto, fps: p.fps, codec: p.codec, audio: p.audio, fragmentado: !!p.fragmentado, notasMetadatos: p.notas });
        if (rec.horaInicio == null && p.horaContenedor) { rec.horaInicio = p.horaContenedor; rec.horaInicioFuente = 'metadatos_contenedor'; }
        rec.estado = 'indexando'; await db.put('recordings', rec);
      }
      const usarIA = job.opciones.ia && IA.estado === 'listo';
      const existentes = await db.by('frames', 'recordingId', rec.id);
      const hacerMiniaturas = !existentes.length;
      const hacerMov = !(rec.motores || []).includes('movimiento-v1');
      const AN = V.analitica;
      const hacerAna = !!AN && (!(rec.motores || []).includes('analitica-v1') || !!job.opciones.analitica || usarIA);
      if (!hacerMiniaturas && !hacerMov && !usarIA && !hacerAna) {
        await h.update(job, { estado: 'completado', progreso: 1, etapa: job.opciones.ia ? 'sin cambios: el motor IA no está cargado' : 'sin cambios', finalizadoEn: Date.now(), duracionMs: Math.round(performance.now() - t0), videoS: 0 });
        return;
      }
      // detecciones IA previas (para reanalizar la analítica sin volver a ejecutar la IA)
      const previasIA = new Map();
      if (hacerAna && !usarIA) (await db.by('detections', 'recordingId', rec.id)).filter(d => d.motor && d.motor.startsWith('coco')).forEach(d => { const k = d.t; if (!previasIA.has(k)) previasIA.set(k, []); previasIA.get(k).push(d); });
      const hayIA = usarIA || previasIA.size > 0;
      await h.update(job, { etapa: 'muestreo de fotogramas' + (usarIA ? ' + IA' : '') + (hacerMov ? ' + movimiento' : '') + (hacerAna ? ' + analítica' : ''), progreso: 0.03 });
      v = await M.openVideo(blob);
      const paso = rec.duracion > 3600 ? 2 : 1; // perfil estándar: 1 fps (2 s en archivos > 1 h)
      const md = new MotionDetector(cam ? cam.mascaras : []);
      const motor = hacerAna ? new AN.Motor(cam) : null;
      const frames = []; const dets = [];
      const byT = new Map(existentes.map(f => [f.t, f]));
      const N = Math.floor(rec.duracion / paso) + 1;
      const cIA = document.createElement('canvas');
      for (let k = 0; k < N; k++) {
        const t = Math.min(k * paso, Math.max(0, rec.duracion - 0.05));
        await M.seek(v, t + 0.001);
        const tAbs = rec.horaInicio != null ? rec.horaInicio + t * 1000 : null;
        let fr = byT.get(t);
        const c = M.draw(v, 320);
        if (!fr) {
          const id = V.id('frm');
          const b = await M.toBlob(c, 'image/jpeg', 0.7);
          const blobKey = await h.putBlob(job.org, 'miniaturas', id, b);
          fr = { id, org: job.org, recordingId: rec.id, cameraId: rec.cameraId, t, tAbs, blobKey, w: c.width, h: c.height, mov: 0, cajasMov: [] };
          frames.push(fr);
        }
        if (hacerMov) {
          const m = md.step(c); fr.mov = +m.score.toFixed(3); fr.cajasMov = m.cajas.slice(0, 6);
          if (m.movimiento) dets.push({ id: V.id('det'), org: job.org, recordingId: rec.id, cameraId: rec.cameraId, frameId: fr.id, t, tAbs, clase: 'movimiento', score: +m.score.toFixed(3), bbox: m.cajas[0] || null, motor: 'movimiento-v1' });
          if (!frames.includes(fr)) frames.push(fr);
        }
        let iaFrame = null;
        if (usarIA) {
          M.draw(v, 640, cIA);
          const r = await IA.detectar(cIA);
          let img = null;
          iaFrame = (r || []).map(d => {
            const det = { id: V.id('det'), org: job.org, recordingId: rec.id, cameraId: rec.cameraId, frameId: fr.id, t, tAbs, clase: d.clase, score: +d.score.toFixed(3), bbox: d.bbox, motor: IA.motorId };
            if (AN && d.clase === 'person' && d.score >= 0.5) { img = img || cIA.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cIA.width, cIA.height); det.atributos = AN.atributosPersona(img, d.bbox); }
            return det;
          });
          iaFrame.forEach(d => dets.push(d));
        } else if (previasIA.size) iaFrame = previasIA.get(t) || [];
        if (motor) motor.frame({ t, frameId: fr.id, canvas: c, dets: hayIA ? (iaFrame || []) : null });
        if (k % 10 === 0 || k === N - 1) {
          await db.putMany('frames', frames.splice(0));
          await h.update(job, { progreso: 0.05 + 0.85 * (k + 1) / N, etapa: 'analizando ' + V.fmtDur(t) + ' / ' + V.fmtDur(rec.duracion) });
        }
      }
      await db.putMany('frames', frames);
      await db.putMany('detections', dets);
      // 3) hallazgos sugeridos
      await h.update(job, { etapa: 'agrupando hallazgos y eventos', progreso: 0.93 });
      const esSeguible = c => AN && (V.GRUPOS_CLASE.persona.includes(c) || V.GRUPOS_CLASE.vehiculo.includes(c));
      const conSeguimiento = !!motor && hayIA;
      if (motor) {
        // reemplazar resultados previos de analítica (sólo los no revisados y no vinculados a expedientes)
        const evid = new Set((await db.by('evidence', 'org', job.org)).map(e => e.refId));
        for (const f of await db.by('findings', 'recordingId', rec.id)) {
          const reemplazable = f.estado === 'sugerido' && !evid.has(f.id) && (f.categoria === 'analitica' || (conSeguimiento && (f.trackId != null || (f.motor && f.motor.startsWith('coco') && esSeguible(f.clase)))));
          if (reemplazable) await db.del('findings', f.id);
        }
        for (const a of await db.by('analysis', 'recordingId', rec.id)) await db.del('analysis', a.id);
      }
      // Clases COCO relevantes para vigilancia; el resto (p. ej. «tv», «corbata») queda en detecciones pero no genera hallazgos
      const RELEVANTES = new Set(['movimiento', 'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle', 'cat', 'dog', 'horse', 'bird', 'backpack', 'handbag', 'suitcase', 'knife', 'umbrella', 'cell phone', 'bottle', 'fire hydrant', 'train', 'boat', 'airplane']);
      const grupos = M.groupFindings(dets.filter(d => RELEVANTES.has(d.clase) && !(conSeguimiento && esSeguible(d.clase))));
      const finds = grupos.map(g => ({
        id: V.id('hal'), org: job.org, recordingId: rec.id, cameraId: rec.cameraId, fuente: 'grabacion', clase: g.clase, etiqueta: V.claseEs(g.clase),
        inicio: g.inicio, fin: g.fin, n: g.n, score: +g.score.toFixed(3), frameId: g.best.frameId, tMejor: g.best.t, bbox: g.best.bbox, motor: g.motor,
        tAbs: rec.horaInicio != null ? rec.horaInicio + g.inicio * 1000 : null, estado: 'sugerido', creadoEn: Date.now()
      }));
      let resAna = null;
      if (motor) {
        resAna = motor.finish();
        const frameDe = t => { const all = [...byT.values()]; return motor.frameIds[t] || (all.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0] || {}).id; };
        const tDeFrame = {}; Object.entries(motor.frameIds).forEach(([t, id]) => tDeFrame[id] = +t);
        if (conSeguimiento) for (const p of resAna.pistas) finds.push({
          id: V.id('hal'), org: job.org, recordingId: rec.id, cameraId: rec.cameraId, fuente: 'grabacion', clase: p.clase, trackId: p.trackId,
          etiqueta: V.claseEs(p.clase) + ' #' + p.trackId,
          inicio: p.inicio, fin: p.fin, n: p.muestras, score: +p.mejor.score.toFixed(3), frameId: p.mejor.frameId, tMejor: p.mejor.t, bbox: p.mejor.bbox, motor: IA.motorId + '+seguimiento', atributos: p.atributos,
          tAbs: rec.horaInicio != null ? rec.horaInicio + p.inicio * 1000 : null, estado: 'sugerido', creadoEn: Date.now()
        });
        for (const e of resAna.eventos) {
          const fid = e.frameId || frameDe(e.inicio);
          finds.push({
            id: V.id('hal'), org: job.org, recordingId: rec.id, cameraId: rec.cameraId, fuente: 'grabacion', categoria: 'analitica', clase: e.tipo,
            etiqueta: e.etiqueta + (e.sentido ? ' · ' + e.sentido : '') + (e.zona ? ' · ' + e.zona : e.linea ? ' · ' + e.linea : e.puerta ? ' · ' + e.puerta : ''),
            inicio: e.inicio, fin: e.fin, n: 1, score: +(e.score || 0.7).toFixed(3), frameId: fid, tMejor: tDeFrame[fid] != null ? tDeFrame[fid] : e.inicio, bbox: e.bbox || null,
            motor: 'analitica-v1', experimental: !!e.experimental, detalle: Object.assign({}, e.detalle || {}, { zona: e.zona, linea: e.linea, puerta: e.puerta, sentido: e.sentido, trackId: e.trackId }),
            tAbs: rec.horaInicio != null ? rec.horaInicio + e.inicio * 1000 : null, estado: 'sugerido', creadoEn: Date.now()
          });
        }
        await db.put('analysis', { id: V.id('ana'), org: job.org, recordingId: rec.id, cameraId: rec.cameraId, creadoEn: Date.now(), configuracion: cam && cam.analitica || null, resultado: { motor: resAna.motor, ia: resAna.ia, conteos: resAna.conteos, ocupacion: resAna.ocupacion, puertas: resAna.puertas, calor: resAna.calor, parametros: resAna.parametros, muestras: resAna.muestras, pistas: resAna.pistas.map(p => ({ trackId: p.trackId, clase: p.clase, inicio: p.inicio, fin: p.fin, atributos: p.atributos, trayectoria: p.trayectoria })) } });
      }
      await db.putMany('findings', finds);
      rec.motores = Array.from(new Set([...(rec.motores || []), ...(hacerMov ? ['movimiento-v1'] : []), ...(usarIA ? [IA.motorId] : []), ...(motor ? ['analitica-v1'] : [])]));
      rec.indexado = true; rec.estado = 'indexado'; rec.indexadoEn = Date.now();
      rec.ultimoIndice = { frames: N, paso, detecciones: dets.length, hallazgos: finds.length, eventos: resAna ? resAna.eventos.length : 0 };
      await db.put('recordings', rec);
      const ms = Math.round(performance.now() - t0);
      await h.update(job, { estado: 'completado', progreso: 1, etapa: 'completado · ' + finds.length + ' hallazgos' + (resAna ? ' (' + resAna.eventos.length + ' eventos de analítica)' : '') + (job.opciones.ia && !usarIA ? ' (motor IA no cargado: sólo movimiento)' : ''), finalizadoEn: Date.now(), duracionMs: ms, videoS: rec.duracion, resumen: { detecciones: dets.length, hallazgos: finds.length, ia: usarIA } });
      await h.audit(job.org, 'indexacion.completar', 'grabacion', rec.id, { ms, detecciones: dets.length, hallazgos: finds.length, motores: rec.motores });
      V.emit('data:changed', { org: job.org });
    } catch (e) {
      console.error(e);
      await h.update(job, { estado: 'fallido', etapa: 'error', error: e.message, finalizadoEn: Date.now() });
      const rec = await db.get('recordings', job.recordingId); if (rec) { rec.estado = 'error'; rec.error = e.message; await db.put('recordings', rec); }
    } finally { if (v) M.closeVideo(v); W.actual = null; }
  };

  // ---------------- extracción de fotograma original ----------------
  M.extractFrame = async function (api, token, recordingId, t) {
    const rec = await api.getRecording(token, recordingId);
    const { blob, url } = await api.mediaURL(token, 'original', recordingId, 'ver');
    URL.revokeObjectURL(url);
    const v = await M.openVideo(blob);
    try {
      await M.seek(v, t);
      const c = M.draw(v); // resolución nativa
      const png = await M.toBlob(c, 'image/png');
      return api.saveDerivative(token, recordingId, png, {
        tipo: 'fotograma', nombre: 'fotograma_' + V.safeName(rec.nombreArchivo) + '_' + t.toFixed(3) + 's.png',
        inicio: v.currentTime, fin: v.currentTime, solicitado: { inicio: t, fin: t }, ancho: c.width, alto: c.height,
        tAbs: rec.horaInicio != null ? rec.horaInicio + v.currentTime * 1000 : null,
        metodo: 'Decodificación del navegador (HTMLVideoElement.seek) + canvas PNG sin pérdida a resolución nativa',
        comandoEquivalente: 'ffmpeg -ss ' + t.toFixed(3) + ' -i <original> -frames:v 1 fotograma.png', transformacion: 'ninguna (decodificación a RGB sin mejoras)'
      });
    } finally { M.closeVideo(v); }
  };

  // ---------------- clips ----------------
  M.makeClip = async function (api, token, recordingId, a, b, extra, onProgress) {
    const t0 = performance.now();
    const rec = await api.getRecording(token, recordingId);
    if (!api.can(token, 'clips.crear')) throw new V.VigiaError('PROHIBIDO', 'Su rol no permite crear clips.');
    a = Math.max(0, a); b = Math.min(rec.duracion || b, b);
    if (!(b > a)) throw new V.VigiaError('INTERVALO_INVALIDO', 'Intervalo de clip vacío después de ajustarlo a la grabación (' + V.fmtDur(rec.duracion) + ').');
    if (b - a > V.CFG.maxClipS) throw new V.VigiaError('LIMITE', 'El clip supera ' + V.CFG.maxClipS + ' s.');
    const { blob, url } = await api.mediaURL(token, 'original', recordingId, 'ver'); URL.revokeObjectURL(url);
    const base = { tipo: 'clip', solicitado: { inicio: a, fin: b }, origenNombre: rec.nombreArchivo };
    Object.assign(base, extra || {});
    if (rec.contenedor === 'mp4' && !rec.fragmentado) {
      try {
        const r = await window.VIGIA_MP4CUT.cutMP4(M.blobReader(blob), a, b, onProgress);
        const out = new Blob(r.parts, { type: 'video/mp4' });
        return api.saveDerivative(token, recordingId, out, Object.assign(base, {
          nombre: 'clip_' + V.safeName(rec.nombreArchivo).replace(/\.\w+$/, '') + '_' + r.real.inicio.toFixed(2) + '-' + r.real.fin.toFixed(2) + '.mp4',
          inicio: r.real.inicio, fin: r.real.fin, metodo: r.metodo, alineacion: r.alineacion, comandoEquivalente: r.comandoEquivalente, pistas: r.pistas,
          transformacion: 'ninguna (copia de flujo sin recodificar)', duracionMs: Math.round(performance.now() - t0),
          tAbs: rec.horaInicio != null ? rec.horaInicio + r.real.inicio * 1000 : null
        }));
      } catch (e) { if (e.code !== 'NO_SOPORTADO') throw e; }
    }
    // Ruta alternativa: recodificación en tiempo real con MediaRecorder (etiquetada como transformación)
    const v = await M.openVideo(blob);
    try {
      const stream = v.captureStream ? v.captureStream() : v.mozCaptureStream();
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
      const rec2 = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4e6 });
      const chunks = []; rec2.ondataavailable = e => e.data.size && chunks.push(e.data);
      await M.seek(v, a);
      const done = new Promise(res => rec2.onstop = res);
      rec2.start(500); await v.play();
      await new Promise(res => { const tick = () => { if (onProgress) onProgress((v.currentTime - a) / (b - a)); if (v.currentTime >= b || v.ended) res(); else requestAnimationFrame(tick); }; tick(); });
      v.pause(); rec2.stop(); await done;
      const out = new Blob(chunks, { type: 'video/webm' });
      return api.saveDerivative(token, recordingId, out, Object.assign(base, {
        nombre: 'clip_' + V.safeName(rec.nombreArchivo).replace(/\.\w+$/, '') + '_' + a.toFixed(2) + '-' + b.toFixed(2) + '.webm', inicio: a, fin: v.currentTime,
        metodo: 'Recodificación en tiempo real con MediaRecorder (' + mime + ')', transformacion: 'RECODIFICADO: no es copia bit a bit del original; usar sólo como referencia visual',
        comandoEquivalente: 'ffmpeg -ss ' + a.toFixed(3) + ' -i <original> -t ' + (b - a).toFixed(3) + ' -c:v libvpx-vp9 clip.webm',
        tAbs: rec.horaInicio != null ? rec.horaInicio + a * 1000 : null
      }));
    } finally { M.closeVideo(v); }
  };

  // ---------------- video de demostración embebido ----------------
  M.cargarMuestra = async function (cual) {
    const g = cual === 'casos' ? 'VIGIA_MUESTRA_CASOS' : 'VIGIA_MUESTRA';
    if (!window[g]) await loadScript(cual === 'casos' ? 'muestras/muestra_casos_h264.js' : 'muestras/muestra_cam01_h264.js');
    const m = window[g]; const bin = atob(m.b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], m.nombre, { type: 'video/mp4' });
  };
})();
