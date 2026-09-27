/* VIGÍA · live.js — tiempo real con alcance honesto.
 * Adaptadores: (1) cámara web local vía getUserMedia (en vivo real);
 * (2) emulación en vivo desde archivo (reproduce una grabación en bucle con reloj del navegador;
 *     el contenido NO es de este momento y así se etiqueta); (3) RTSP: configurable pero no
 *     conectable desde el navegador (requiere agente de borde, fase posterior).
 * Cada adaptador captura 1 cuadro/s a un búfer circular de 5 min, con marca de captura, edad del
 * cuadro y estado de conexión; opcionalmente analiza (movimiento + IA) y evalúa reglas. */
(function () {
  'use strict';
  const V = window.V;
  const L = V.live = { adapters: new Map() };
  const BUF_S = 300, SEG_S = 10, SEG_N = 6;

  class Adapter {
    constructor(cam, token) { this.cam = cam; this.org = cam.org; this.token = token; this.estado = 'conectando'; this.ring = []; this.segs = []; this.analisis = true; this.md = new V.media.MotionDetector(cam.mascaras); this.listeners = new Set(); }
    get cameraId() { return this.cam.id; }
    async _startCapture() {
      this.canvas = document.createElement('canvas');
      this.timer = setInterval(() => this._tick().catch(e => console.warn(e)), 1000);
      this._startSegments();
      this.estado = 'conectada'; this.conectadaEn = Date.now(); L._changed();
    }
    async _tick() {
      const v = this.video;
      // Un <video> retirado del documento se pausa (norma HTML): se reanuda para no interrumpir la transmisión
      if (v && v.paused && !this.stopped) { if (!v.isConnected) L._keep().appendChild(v); v.play().catch(() => { }); } if (!v || v.readyState < 2) { if (this.estado === 'conectada' && Date.now() - (this.last ? this.last.ts : this.conectadaEn) > 5000) { this.estado = 'sin_senal'; L._changed(); } return; }
      if (this.estado === 'sin_senal') { this.estado = 'conectada'; L._changed(); }
      const c = V.media.draw(v, 480, this.canvas);
      const blob = await V.media.toBlob(c, 'image/jpeg', 0.75);
      const f = { ts: Date.now(), blob, w: c.width, h: c.height, pos: this.tipo === 'emulacion' ? v.currentTime : null, mov: null, dets: [] };
      if (this.analisis) {
        const m = this.md.step(c); f.mov = m;
        if (V.ia.estado === 'listo' && !this._busy) { this._busy = true; try { f.dets = (await V.ia.detectar(c)) || []; f.motor = V.ia.motorId; } finally { this._busy = false; } }
        await this._rules(f);
      }
      this.last = f; this.ring.push(f); while (this.ring.length > BUF_S) this.ring.shift();
      this.listeners.forEach(fn => fn(f));
    }
    _startSegments() {
      if (!window.MediaRecorder || !this.stream) return;
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
      const next = () => {
        if (this.stopped) return;
        let r; try { r = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 2e6 }); } catch (e) { return; }
        const chunks = []; const inicio = Date.now();
        r.ondataavailable = e => e.data.size && chunks.push(e.data);
        r.onstop = () => { if (chunks.length) { this.segs.push({ inicio, fin: Date.now(), blob: new Blob(chunks, { type: 'video/webm' }), mime }); while (this.segs.length > SEG_N) this.segs.shift(); } next(); };
        r.start(); this.segRec = r; setTimeout(() => { try { r.state !== 'inactive' && r.stop(); } catch (_) { } }, SEG_S * 1000);
      };
      next();
    }
    async _rules(f) {
      const rules = (await V.app.api.db.by('rules', 'cameraId', this.cam.id)).filter(r => r.org === this.org && r.estado === 'activa' && Date.now() < r.hasta);
      for (const r of rules) {
        const clases = r.clase === 'movimiento' ? null : V.GRUPOS_CLASE[r.clase];
        const hit = r.clase === 'movimiento' ? (f.mov && f.mov.movimiento) : f.dets.some(d => clases.includes(d.clase) && d.score >= 0.5);
        if (!hit) continue;
        if (r.ultimoDisparo && Date.now() - r.ultimoDisparo < 30000) continue;
        const id = V.id('alimg');
        const h = V.app.api._workerHandle();
        const blobKey = await h.putBlob(this.org, 'alertas', id, f.blob);
        const det = r.clase === 'movimiento' ? { clase: 'movimiento', score: f.mov.score } : f.dets.filter(d => clases.includes(d.clase)).sort((a, b) => b.score - a.score)[0];
        await V.app.api._fireAlert(this.org, r, { blobKey, capturaTs: f.ts, detalle: det, motor: r.clase === 'movimiento' ? 'movimiento-v1' : V.ia.motorId, fuente: this.tipo });
      }
    }
    snapshot() { return this.last || null; }
    stop() {
      this.stopped = true; clearInterval(this.timer);
      try { this.segRec && this.segRec.state !== 'inactive' && this.segRec.stop(); } catch (_) { }
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      if (this.video) V.media.closeVideo(this.video);
      this.estado = 'desconectada'; L._changed();
    }
  }

  class WebcamAdapter extends Adapter {
    async start() {
      this.tipo = 'webcam';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new V.VigiaError('NO_SOPORTADO', 'Este navegador no permite acceder a la cámara web.');
      try { this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false }); }
      catch (e) { this.estado = 'error'; L._changed(); throw new V.VigiaError('PERMISO_CAMARA', 'No se obtuvo acceso a la cámara web: ' + e.message); }
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = this.stream; await v.play(); this.video = v;
      await this._startCapture();
    }
  }
  class FileEmulationAdapter extends Adapter {
    async start(recordingId) {
      this.tipo = 'emulacion';
      const api = V.app.api;
      const recs = await api.listRecordings(this.token, this.cam.id);
      const rec = recordingId ? recs.find(r => r.id === recordingId) : recs.find(r => r.indexado) || recs[0];
      if (!rec) { this.estado = 'desconectada'; throw new V.VigiaError('SIN_FUENTE', 'La cámara no tiene grabaciones para emular una transmisión.'); }
      this.rec = rec;
      const { blob } = await api.mediaURL(this.token, 'original', rec.id, 'ver');
      const v = await V.media.openVideo(blob); v.loop = true; await v.play(); this.video = v;
      this.stream = v.captureStream ? v.captureStream() : null;
      await this._startCapture();
    }
  }

  L.start = async function (token, cam, opts) {
    L.stop(cam.id);
    const A = cam.tipo === 'webcam' ? WebcamAdapter : cam.tipo === 'archivo' ? FileEmulationAdapter : null;
    if (!A) throw new V.VigiaError('NO_SOPORTADO', 'RTSP no puede abrirse directamente desde un navegador. Requiere el agente de borde (fase posterior, ver ARCHITECTURE.md).');
    const a = new A(cam, token); L.adapters.set(cam.id, a); L._changed();
    try { await a.start(opts && opts.recordingId); } catch (e) { L.adapters.delete(cam.id); L._changed(); throw e; }
    await V.app.api._audit(V.app.api._ctx(token), 'vivo.conectar', 'camara', cam.id, { tipo: a.tipo });
    return a;
  };
  L.stop = function (cameraId) { const a = L.adapters.get(cameraId); if (a) { a.stop(); L.adapters.delete(cameraId); L._changed(); } };
  L.stopAll = () => Array.from(L.adapters.keys()).forEach(L.stop);
  L.get = id => L.adapters.get(id) || null;
  L.status = org => Array.from(L.adapters.values()).filter(a => a.org === org).map(a => ({ cameraId: a.cameraId, estado: a.estado, tipo: a.tipo, ultimo: a.last ? a.last.ts : null }));
  L._changed = () => V.emit('live:changed');
  L._keep = () => { let k = document.getElementById('live-keep'); if (!k) { k = document.createElement('div'); k.id = 'live-keep'; k.setAttribute('aria-hidden', 'true'); k.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-10px;top:-10px'; document.body.appendChild(k); } return k; };

  /** Respuesta honesta a "¿qué sucede ahora?" para una cámara. */
  L.now = function (cam) {
    const a = L.get(cam.id);
    if (!a || a.org !== cam.org) return { conectada: false, motivo: cam.tipo === 'rtsp' ? 'Fuente RTSP configurada; el navegador no puede conectarse a RTSP sin agente de borde.' : 'No hay transmisión activa para esta cámara.' };
    const f = a.snapshot();
    if (!f) return { conectada: true, estado: a.estado, sinCuadros: true, tipo: a.tipo };
    return { conectada: true, estado: a.estado, tipo: a.tipo, frame: f, edadS: (Date.now() - f.ts) / 1000, rec: a.rec || null, segmentos: a.segs.length, analisis: a.analisis };
  };
  /** Cuadros del búfer en vivo dentro de los últimos N segundos. */
  L.recent = function (cam, segundos) { const a = L.get(cam.id); if (!a || a.org !== cam.org) return []; const lim = Date.now() - segundos * 1000; return a.ring.filter(f => f.ts >= lim); };
  L.contextClip = async function (token, cam) {
    const a = L.get(cam.id); if (!a || !a.segs.length) throw new V.VigiaError('SIN_BUFER', 'Aún no hay búfer suficiente (se graban segmentos de ' + SEG_S + ' s).');
    const s = a.segs[a.segs.length - 1];
    return V.app.api.saveDerivative(token, null, s.blob, {
      tipo: 'clip', cameraId: cam.id, fuente: a.tipo, nombre: 'vivo_' + cam.codigo + '_' + new Date(s.inicio).toISOString().replace(/[:.]/g, '-') + '.webm',
      inicio: null, fin: null, tAbs: s.inicio, tAbsFin: s.fin, metodo: 'Búfer en vivo: segmento MediaRecorder (' + s.mime + ') de ' + ((s.fin - s.inicio) / 1000).toFixed(1) + ' s',
      transformacion: 'Codificado en el navegador a partir del flujo en vivo' + (a.tipo === 'emulacion' ? ' (EMULACIÓN desde archivo: la hora es de reproducción, no de captura original)' : ''),
      comandoEquivalente: 'n/a (captura en vivo)'
    });
  };
})();
