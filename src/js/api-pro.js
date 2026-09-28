/* VIGÍA · API v1 — funciones avanzadas (central de alarmas, plano del sitio, búsqueda por apariencia,
 * paquete de evidencia). Extiende V.Api con las mismas reglas: token → organización y rol; nunca se confía
 * en el llamador para campos de custodia; todo queda en la auditoría encadenada. */
(function () {
  'use strict';
  const V = window.V;
  const E = (code, msg, d) => new V.VigiaError(code, msg, d);
  const P = V.Api.prototype;

  // ======================= central de alarmas =======================
  // Prioridad, SLA de reconocimiento y procedimiento operativo (SOP) por tipo, al estilo de un centro de monitoreo (PSIM/VMS).
  const PRIORIDAD = {
    humo: 'critica', intrusion: 'alta', manipulacion: 'alta', objeto_abandonado: 'alta', merodeo: 'media', ingreso_grupal: 'media',
    aglomeracion: 'media', puerta_abierta: 'media', persona: 'media', vehiculo: 'baja', mal_parqueado: 'baja', movimiento: 'baja'
  };
  const SLA_S = { critica: 60, alta: 120, media: 300, baja: 900 };
  const ORDEN = { critica: 0, alta: 1, media: 2, baja: 3 };
  const SOP_BASE = ['Verificar el evento en la imagen y en el video en vivo o grabado', 'Registrar observaciones en la alarma'];
  const SOP = {
    humo: ['Verificar visualmente humo o fuego en la cámara y cámaras vecinas', 'Si se confirma: activar protocolo de emergencia y llamar a bomberos (123 / 119 según país)', 'Notificar al jefe de seguridad y coordinar evacuación del área', 'Preservar clip del evento y abrir expediente'],
    intrusion: ['Verificar la presencia de la persona en la zona restringida', 'Seguirla en cámaras adyacentes (búsqueda por apariencia)', 'Despachar guarda o patrulla y comunicar por radio', 'Si procede: contactar a la policía y preservar evidencia'],
    manipulacion: ['Comprobar si la cámara está cubierta, desenfocada o movida', 'Revisar el último fotograma válido y las cámaras cercanas', 'Enviar técnico o guarda a la ubicación', 'Registrar posible sabotaje en expediente'],
    objeto_abandonado: ['Localizar el objeto y revisar quién lo dejó (retroceder en la grabación)', 'Aislar el área sin manipular el objeto', 'Informar al supervisor; si es sospechoso, activar protocolo de artefacto'],
    merodeo: ['Verificar la permanencia de la persona en la zona', 'Seguimiento en cámaras vecinas', 'Enviar guarda para verificación preventiva'],
    ingreso_grupal: ['Verificar si dos o más personas ingresaron con una sola autorización', 'Contrastar con el control de acceso', 'Informar al supervisor de acceso'],
    aglomeracion: ['Verificar el número de personas y el aforo permitido', 'Comunicar al responsable del área para regular el ingreso'],
    puerta_abierta: ['Verificar si la puerta está abierta sin autorización', 'Enviar a una persona a cerrarla y revisar el acceso'],
    mal_parqueado: ['Verificar el vehículo en zona prohibida', 'Comunicar a vigilancia o tránsito interno'],
    persona: ['Verificar la presencia de la persona y si está autorizada'],
    vehiculo: ['Verificar el vehículo y si está autorizado'],
    movimiento: ['Verificar la causa del movimiento (persona, vehículo, animal, clima)']
  };
  const RESOLUCIONES = { real: 'Evento real', falsa: 'Falsa alarma', prueba: 'Prueba / simulacro', duplicada: 'Duplicada' };
  V.alarmas = {
    PRIORIDAD, SLA_S, SOP, RESOLUCIONES, ORDEN,
    prioridadDe: clase => PRIORIDAD[clase] || 'media',
    inicial(clase, prioridad) {
      const pr = prioridad && SLA_S[prioridad] ? prioridad : (PRIORIDAD[clase] || 'media');
      return { prioridad: pr, slaS: SLA_S[pr], pasos: (SOP[clase] || SOP_BASE).map(texto => ({ texto, hecho: false })), historial: [] };
    },
    /** Estado normalizado (compatibilidad con alertas antiguas «vista»). */
    estado: a => a.estado === 'vista' ? 'reconocida' : a.estado,
    slaVencido: (a, ahora) => V.alarmas.estado(a) === 'nueva' && ((ahora || Date.now()) - a.ts) > (a.slaS || SLA_S[a.prioridad || 'media']) * 1000
  };

  P.updateAlert = async function (token, id, op) {
    const ctx = this._ctx(token); this._need(ctx, 'alarmas.gestionar');
    const a = await this._own('alerts', id, ctx);
    if (!a.prioridad) Object.assign(a, V.alarmas.inicial(a.clase));
    const est = V.alarmas.estado(a); const ahora = Date.now(); op = op || {};
    const hist = (accion, detalle) => { a.historial = (a.historial || []).concat([{ ts: ahora, email: ctx.email, accion, detalle: detalle || null }]).slice(-200); };
    switch (op.accion) {
      case 'reconocer':
        if (est !== 'nueva') throw E('CONFLICTO', 'La alarma ya fue reconocida.');
        a.estado = 'reconocida'; a.reconocidaPor = ctx.email; a.reconocidaEn = ahora; a.dentroSLA = ahora - a.ts <= a.slaS * 1000; hist('reconocer'); break;
      case 'asignar': {
        if (est === 'cerrada') throw E('CONFLICTO', 'La alarma está cerrada.');
        const para = String(op.asignadoA || ctx.email).trim().toLowerCase().slice(0, 120);
        if (para !== ctx.email) { const u = (await this.db.all('users')).find(x => x.email === para); const m = u && (await this.db.by('memberships', 'userId', u.id)).find(x => x.org === ctx.org); if (!m) throw E('VALIDACION', 'El usuario no pertenece a la organización.'); }
        if (est === 'nueva') { a.reconocidaPor = ctx.email; a.reconocidaEn = ahora; a.dentroSLA = ahora - a.ts <= a.slaS * 1000; }
        a.estado = 'en_atencion'; a.asignadoA = para; hist('asignar', { asignadoA: para }); break;
      }
      case 'paso': {
        const i = Math.floor(+op.indice); if (!a.pasos || !a.pasos[i]) throw E('VALIDACION', 'Paso inexistente.');
        if (est === 'cerrada') throw E('CONFLICTO', 'La alarma está cerrada.');
        a.pasos[i].hecho = !!op.hecho; a.pasos[i].por = ctx.email; a.pasos[i].en = ahora; hist('paso', { indice: i, hecho: !!op.hecho }); break;
      }
      case 'nota': {
        const t = String(op.texto || '').trim().slice(0, 1000); if (!t) throw E('VALIDACION', 'La nota está vacía.');
        hist('nota', { texto: t }); break;
      }
      case 'cerrar': {
        if (est === 'cerrada') throw E('CONFLICTO', 'La alarma ya está cerrada.');
        if (!RESOLUCIONES[op.resolucion]) throw E('VALIDACION', 'Indique la resolución: ' + Object.keys(RESOLUCIONES).join(', '));
        const nota = String(op.nota || '').trim().slice(0, 1000);
        if (op.resolucion === 'real' && nota.length < 5) throw E('VALIDACION', 'Un evento real requiere una nota de cierre (qué se hizo).');
        if (est === 'nueva') { a.reconocidaPor = ctx.email; a.reconocidaEn = ahora; a.dentroSLA = ahora - a.ts <= a.slaS * 1000; }
        a.estado = 'cerrada'; a.resolucion = op.resolucion; a.notaCierre = nota; a.cerradaPor = ctx.email; a.cerradaEn = ahora; hist('cerrar', { resolucion: op.resolucion }); break;
      }
      case 'reabrir':
        this._need(ctx, 'incidentes.confirmar');
        if (est !== 'cerrada') throw E('CONFLICTO', 'Sólo se reabre una alarma cerrada.');
        a.estado = 'en_atencion'; a.resolucion = null; hist('reabrir'); break;
      default: throw E('VALIDACION', 'Acción de alarma inválida.');
    }
    await this.db.put('alerts', a);
    await this._audit(ctx, 'alarma.' + op.accion, 'alerta', id, { estado: a.estado, resolucion: a.resolucion || null });
    V.emit('alerts:changed', { org: ctx.org });
    return a;
  };

  /** Escala un hallazgo (indexado o de analítica) a la central de alarmas, con una copia de su fotograma. */
  P.alarmFromFinding = async function (token, findingId, prioridad) {
    const ctx = this._ctx(token); this._need(ctx, 'alarmas.gestionar');
    const f = await this._own('findings', findingId, ctx);
    const dup = (await this.db.by('alerts', 'org', ctx.org)).find(a => a.findingId === f.id && V.alarmas.estado(a) !== 'cerrada');
    if (dup) return dup;
    let blobKey = null;
    if (f.frameId) { const fr = await this.db.get('frames', f.frameId); if (fr && fr.org === ctx.org) { const b = await this._getBlob(ctx, fr.blobKey).catch(() => null); if (b) blobKey = await this._putBlob(ctx, 'alertas', V.id('alimg'), b); } }
    const a = Object.assign({ id: V.id('alerta'), org: ctx.org, ruleId: null, findingId: f.id, recordingId: f.recordingId, cameraId: f.cameraId, clase: f.clase, fuente: 'hallazgo', estado: 'nueva', ts: Date.now(), blobKey, capturaTs: f.tAbs || null, detalle: { etiqueta: f.etiqueta, inicio: f.inicio, fin: f.fin, score: f.score }, escaladaPor: ctx.email }, V.alarmas.inicial(f.clase, prioridad));
    await this.db.put('alerts', a);
    await this._audit(ctx, 'alarma.escalar_hallazgo', 'hallazgo', f.id, { alerta: a.id, prioridad: a.prioridad });
    V.emit('alerts:new', a);
    return a;
  };

  /** Indicadores operativos de la central: MTTA, MTTR, cumplimiento de SLA, tasa de falsas alarmas. */
  P.alarmStats = async function (token, desdeMs) {
    const ctx = this._ctx(token); this._need(ctx, 'indicadores.ver');
    const all = (await this.db.by('alerts', 'org', ctx.org)).filter(a => !desdeMs || a.ts >= desdeMs);
    const ahora = Date.now(); const por = { nueva: 0, reconocida: 0, en_atencion: 0, cerrada: 0 }; const prio = { critica: 0, alta: 0, media: 0, baja: 0 };
    let ack = 0, ackN = 0, res = 0, resN = 0, sla = 0, slaN = 0, falsas = 0, cerradas = 0, vencidas = 0;
    for (const a of all) {
      const e = V.alarmas.estado(a); por[e] = (por[e] || 0) + 1; const p = a.prioridad || V.alarmas.prioridadDe(a.clase); prio[p] = (prio[p] || 0) + 1;
      if (a.reconocidaEn) { ack += a.reconocidaEn - a.ts; ackN++; slaN++; if (a.dentroSLA) sla++; }
      if (a.cerradaEn) { res += a.cerradaEn - a.ts; resN++; cerradas++; if (a.resolucion === 'falsa') falsas++; }
      if (V.alarmas.slaVencido(a, ahora)) vencidas++;
    }
    return { total: all.length, porEstado: por, porPrioridad: prio, abiertas: all.length - cerradas, vencidas, mttaS: ackN ? Math.round(ack / ackN / 1000) : null, mttrS: resN ? Math.round(res / resN / 1000) : null, cumplimientoSLA: slaN ? +(sla / slaN).toFixed(3) : null, tasaFalsas: cerradas ? +(falsas / cerradas).toFixed(3) : null };
  };

  // ======================= plano del sitio =======================
  const IMG_OK = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
  P.getPlan = async function (token) {
    const ctx = this._ctx(token); this._need(ctx, 'camaras.ver');
    return (await this.db.get('plans', 'plano_' + ctx.org)) || null;
  };
  P.savePlan = async function (token, data) {
    const ctx = this._ctx(token); this._need(ctx, 'camaras.gestionar');
    const prev = await this.db.get('plans', 'plano_' + ctx.org);
    let imagen = data.imagen === undefined ? (prev ? prev.imagen : null) : data.imagen;
    if (imagen != null) { if (typeof imagen !== 'string' || !IMG_OK.test(imagen)) throw E('VALIDACION', 'El plano debe ser una imagen PNG, JPEG o WebP.'); if (imagen.length > 4.5e6) throw E('DEMASIADO_GRANDE', 'La imagen del plano supera 3 MB.'); }
    const camIds = new Set((await this.db.by('cameras', 'org', ctx.org)).map(c => c.id));
    const camaras = {};
    for (const [id, p] of Object.entries(data.camaras || {})) {
      if (!camIds.has(id)) continue; // nunca se aceptan cámaras de otra organización
      camaras[id] = { x: V.clamp(+p.x || 0, 0, 1), y: V.clamp(+p.y || 0, 0, 1), ang: ((Math.round(+p.ang || 0) % 360) + 360) % 360, fov: V.clamp(Math.round(+p.fov || 70), 20, 180), alcance: V.clamp(+p.alcance || 0.12, 0.03, 0.5) };
    }
    const plan = { id: 'plano_' + ctx.org, org: ctx.org, nombre: String(data.nombre || (prev && prev.nombre) || 'Plano principal').slice(0, 80), imagen, camaras, actualizadoPor: ctx.email, actualizadoEn: Date.now() };
    await this.db.put('plans', plan);
    await this._audit(ctx, 'plano.guardar', 'plano', plan.id, { camaras: Object.keys(camaras).length, imagen: !!imagen });
    return plan;
  };

  // ======================= búsqueda por apariencia =======================
  /** Personas con apariencia de ropa similar en todas las cámaras de la organización (no es reconocimiento facial). */
  P.searchAppearance = async function (token, q) {
    const ctx = this._ctx(token); this._need(ctx, 'medios.ver');
    const AN = V.analitica; if (!AN) throw E('NO_SOPORTADO', 'Motor de analítica no disponible.');
    let firma = q.firma || null, ref = null;
    if (q.findingId) { ref = await this._own('findings', q.findingId, ctx); firma = ref.firma; }
    if (!firma || !Array.isArray(firma) || firma.length !== AN.FIRMA_BINS * 2) throw E('SIN_FIRMA', 'El hallazgo de referencia no tiene firma de apariencia. Requiere una persona seguida por el motor IA (analice o reanalice la grabación con IA).');
    const umbral = V.clamp(+q.umbral || 0.8, 0.5, 0.99), lim = V.clamp(Math.floor(+q.limit) || 30, 1, 200);
    const camSet = q.cameraIds && q.cameraIds.length ? new Set(q.cameraIds) : null;
    const cands = (await this.db.by('findings', 'org', ctx.org)).filter(f => f.firma && f.trackId != null && (!ref || f.id !== ref.id) && (!camSet || camSet.has(f.cameraId)) && f.estado !== 'descartado');
    const res = cands.map(f => ({ f, s: AN.similitud(firma, f.firma) })).filter(x => x.s >= umbral).sort((a, b) => b.s - a.s);
    await this._audit(ctx, 'busqueda.apariencia', 'hallazgo', ref ? ref.id : null, { umbral, candidatos: cands.length, resultados: res.length });
    return { referencia: ref, umbral, candidatos: cands.length, total: res.length, items: res.slice(0, lim).map(x => Object.assign({}, x.f, { similitud: x.s })), metodo: 'Histograma HSV de torso y piernas (sin piel) · coeficiente de Bhattacharyya. Describe ropa, no identidad; la iluminación y el ángulo lo afectan.' };
  };

  // ======================= paquete de evidencia =======================
  /** Reúne binarios y metadatos de un expediente para exportarlo como paquete verificable (ZIP + SHA-256). */
  P.casePackage = async function (token, caseId, opts) {
    const ctx = this._ctx(token); this._need(ctx, 'evidencia.descargar');
    opts = opts || {};
    const { caso, evidencias, notas, informes } = await this.getCase(token, caseId);
    const items = [];
    for (const e of evidencias) {
      const it = { evidencia: e, archivos: [] };
      try {
        if (e.tipo === 'grabacion') {
          const r = await this._own('recordings', e.refId, ctx); it.ref = r;
          if (opts.incluirOriginales) it.archivos.push({ rol: 'original', nombre: r.nombreArchivo, sha256: r.sha256, blob: await this._getBlob(ctx, r.blobKey) });
        } else if (e.tipo === 'clip' || e.tipo === 'fotograma' || e.tipo === 'sinopsis') {
          const d = await this._own('derivatives', e.refId, ctx); it.ref = d;
          it.archivos.push({ rol: d.tipo, nombre: d.nombre, sha256: d.sha256, blob: await this._getBlob(ctx, d.blobKey) });
        } else if (e.tipo === 'hallazgo') {
          const f = await this._own('findings', e.refId, ctx); it.ref = f;
          const fr = f.frameId ? await this.db.get('frames', f.frameId) : null;
          if (fr && fr.org === ctx.org) { const b = await this._getBlob(ctx, fr.blobKey); it.archivos.push({ rol: 'fotograma_hallazgo', nombre: 'hallazgo_' + f.id + '.jpg', sha256: await V.sha256Blob(b), blob: b, frame: fr }); }
        }
        const recId = it.ref && (it.ref.recordingId || (e.tipo === 'grabacion' ? it.ref.id : null));
        if (recId) it.grabacion = await this.db.get('recordings', recId);
      } catch (err) { it.error = V.errMsg(err); }
      items.push(it);
    }
    const ids = new Set([caseId, ...evidencias.map(e => e.refId), ...items.map(i => i.grabacion && i.grabacion.id).filter(Boolean)]);
    const auditoria = (await this.db.by('audit', 'org', ctx.org)).filter(a => ids.has(a.recursoId)).sort((a, b) => (a.seq || 0) - (b.seq || 0) || a.ts - b.ts);
    await this._audit(ctx, 'expediente.exportar_paquete', 'expediente', caseId, { evidencias: evidencias.length, originales: !!opts.incluirOriginales, privacidad: !!opts.privacidad });
    return { caso, evidencias, notas, informes, items, auditoria, exportadoPor: ctx.email, exportadoEn: Date.now(), org: ctx.org, orgNombre: (await this.db.get('orgs', ctx.org) || {}).nombre || ctx.org };
  };

  /** Detecciones de personas (y opcionalmente vehículos) de una grabación, para redacción de privacidad. */
  P.privacyBoxes = async function (token, recordingId, clases) {
    const ctx = this._ctx(token); this._need(ctx, 'medios.ver');
    await this._own('recordings', recordingId, ctx);
    const cl = new Set(clases && clases.length ? clases : V.GRUPOS_CLASE.persona);
    return (await this.db.by('detections', 'recordingId', recordingId)).filter(d => d.org === ctx.org && d.bbox && cl.has(d.clase) && d.score >= 0.35).map(d => ({ t: d.t, bbox: d.bbox, clase: d.clase, frameId: d.frameId }));
  };
})();
