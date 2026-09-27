/* VIGÍA · chat.js — planificador y ejecutor de consultas.
 * Flujo: interpretar → normalizar zona horaria → autorizar y comprobar cobertura → planificar →
 * ejecutar herramientas limitadas → ensamblar hallazgos → citar evidencia → responder.
 * Las respuestas sólo afirman lo que producen los motores; sin evidencia, lo dicen expresamente. */
(function () {
  'use strict';
  const V = window.V;
  const C = V.chat = {};
  const NLP = () => window.VIGIA_NLP;

  // ---------- zona horaria ----------
  V.tzOffsetMs = function (ms, tz) {
    const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUTC - Math.floor(ms / 1000) * 1000;
  };
  V.midnightIn = function (ms, tz) { const off = V.tzOffsetMs(ms, tz); const local = ms + off; const d = new Date(local); const lm = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return lm - V.tzOffsetMs(lm - off, tz); };
  V.secOfDay = (ms, tz) => { const m = V.midnightIn(ms, tz); return (ms - m) / 1000; };

  const CLS = g => (V.GRUPOS_CLASE[g] || [g]);
  const clasesCoco = grupos => grupos.flatMap(CLS);
  const grpTxt = gs => gs.map(g => ({ persona: 'personas', vehiculo: 'vehículos', movimiento: 'movimiento', animal: 'animales', objeto: 'objetos' }[g] || g)).join(' o ');

  /** Resuelve una ventana del plan a una ventana ejecutable para una cámara y su grabación de referencia. */
  C.resolverVentana = function (w, cam, recs) {
    if (!w) return null;
    const rec = recs.filter(r => r.duracion != null).sort((a, b) => (b.horaInicio || b.importadoEn) - (a.horaInicio || a.importadoEn))[0] || null;
    if (w.modo === 'hms') {
      // ¿Hora de reloj o posición en el archivo? Se decide con transparencia.
      if (rec && rec.horaInicio != null) {
        const s0 = V.secOfDay(rec.horaInicio, cam.tz), s1 = s0 + rec.duracion;
        if (w.b > s0 && w.a < s1) {
          const m = V.midnightIn(rec.horaInicio, cam.tz);
          return { modo: 'absoluta', a: m + w.a * 1000, b: m + w.b * 1000, texto: w.texto, interpretacion: 'hora de reloj (' + cam.tz + ') del día ' + V.fmtDateTime(rec.horaInicio, cam.tz, { hour: undefined, minute: undefined, second: undefined }), alternativa: 'posicion' };
        }
      }
      return { modo: 'posicion', recordingId: rec ? rec.id : null, a: w.a, b: w.b, texto: w.texto, interpretacion: 'posición dentro del archivo' + (rec ? ' «' + rec.nombreArchivo + '»' : '') + (rec && rec.horaInicio == null ? ' (el archivo no trae hora de captura)' : ' (no coincide con el horario del archivo)'), alternativa: rec && rec.horaInicio != null ? 'absoluta' : null };
    }
    if (w.modo === 'hoy' || w.modo === 'ayer') {
      const m = V.midnightIn(Date.now(), cam.tz) - (w.modo === 'ayer' ? 86400e3 : 0);
      return { modo: 'absoluta', a: m, b: w.modo === 'ayer' ? m + 86400e3 : Date.now(), texto: w.texto, interpretacion: w.modo + ' en ' + cam.tz };
    }
    if (w.modo === 'ultimos') return Object.assign({}, w, { interpretacion: 'últimos ' + V.fmtDur(w.segundos) + ' DISPONIBLES (para archivos: final de la grabación, no el reloj actual)' });
    if (w.modo === 'todo') return Object.assign({}, w, { interpretacion: 'toda la grabación disponible' });
    return Object.assign({}, w);
  };

  const ventanaTexto = (w, rec, tz) => {
    if (!w) return '—';
    if (rec && rec.horaInicio != null) return V.fmtDateTime(rec.horaInicio + w.a * 1000, tz) + ' → ' + V.fmtTime(rec.horaInicio + w.b * 1000, tz) + ' (pos. ' + V.fmtDur(w.a) + '–' + V.fmtDur(w.b) + ')';
    return 'posición ' + V.fmtDur(w.a) + ' – ' + V.fmtDur(w.b) + ' (sin hora de captura)';
  };

  /**
   * Ejecuta un mensaje del usuario. Devuelve { texto, tarjetas[], estado }.
   * ctx: { token, chatId, estado, seleccion, hallazgoSeleccionado, planEditado }
   */
  C.ejecutar = async function (api, texto, ctx) {
    const token = ctx.token;
    const cams = await api.listCameras(token), grupos = await api.listGroups(token);
    const estado = Object.assign({}, ctx.estado || {});
    const plan = ctx.planEditado || NLP().interpretar(texto, { camaras: cams, grupos, seleccion: ctx.seleccion, estado, hallazgoSeleccionado: ctx.hallazgoSeleccionado });
    const out = { texto: '', tarjetas: [], estado, plan };
    const say = s => { out.texto += (out.texto ? '\n' : '') + s; };
    const card = c => out.tarjetas.push(c);
    const camById = id => cams.find(c => c.id === id);

    if (plan.camarasInexistentes && plan.camarasInexistentes.length) {
      say('No existe la cámara ' + plan.camarasInexistentes.join(', ') + ' en su organización. Cámaras disponibles: ' + cams.map(c => c.numero + ' · ' + c.nombre).join('; ') + '.');
      card({ tipo: 'aclaracion', pregunta: '¿Qué cámara quiere consultar?', opciones: cams.map(c => ({ etiqueta: 'Cámara ' + c.numero + ' · ' + c.nombre, cameraId: c.id })) });
      return out;
    }
    if (plan.faltantes.includes('camara')) {
      say('¿Sobre qué cámara o grupo? No lo indicó y no hay una selección activa en el panel.');
      card({ tipo: 'aclaracion', pregunta: 'Elija la cámara', opciones: cams.map(c => ({ etiqueta: 'Cámara ' + c.numero + ' · ' + c.nombre, cameraId: c.id })).concat(grupos.map(g => ({ etiqueta: 'Grupo ' + g.nombre, cameraIds: g.cameraIds }))) });
      return out;
    }

    const recsPorCam = {};
    for (const c of cams) recsPorCam[c.id] = (await api.listRecordings(token, c.id));

    switch (plan.intent) {
      case 'ayuda': {
        say('Puedo consultar cámaras, mostrar fotogramas, buscar personas/vehículos/movimiento en una ventana, extraer clips, abrir y resumir expedientes, generar informes, consultar indicadores y crear reglas temporales. Todo resultado enlaza a su evidencia.');
        card({ tipo: 'ayuda' }); break;
      }
      case 'listar_camaras': {
        const st = V.live.status(api.session(token).org);
        say(cams.length ? 'Su organización tiene ' + cams.length + ' cámara(s); ' + st.filter(s => s.estado === 'conectada').length + ' con transmisión activa en este navegador.' : 'Aún no hay cámaras registradas. Créelas en Centro de operaciones o Administración.');
        card({ tipo: 'camaras', ids: cams.map(c => c.id) }); break;
      }
      case 'ahora': {
        for (const cid of plan.camaras) {
          const cam = camById(cid); const n = V.live.now(cam);
          if (!n.conectada) {
            const rec = recsPorCam[cid][0];
            say('Cámara ' + cam.numero + ' (' + cam.nombre + '): ' + n.motivo + (rec ? ' Sólo hay grabación HISTÓRICA: «' + rec.nombreArchivo + '»' + (rec.horaInicio ? ' de ' + V.fmtDateTime(rec.horaInicio, cam.tz) : '') + '.' : ' No hay grabaciones.'));
            card({ tipo: 'vivo_no', cameraId: cid, motivo: n.motivo, recordingId: rec ? rec.id : null });
            continue;
          }
          if (n.sinCuadros) { say('Cámara ' + cam.numero + ': conectada (' + n.tipo + ') pero aún no se ha recibido ningún cuadro.'); card({ tipo: 'vivo_no', cameraId: cid, motivo: 'Sin cuadros recibidos todavía' }); continue; }
          const f = n.frame;
          const d = await api.saveDerivative(token, null, f.blob, {
            tipo: 'fotograma', cameraId: cid, fuente: 'vivo:' + n.tipo, nombre: 'vivo_' + cam.codigo + '_' + new Date(f.ts).toISOString().replace(/[:.]/g, '-') + '.jpg',
            tAbs: f.ts, inicio: null, fin: null, ancho: f.w, alto: f.h, edadS: n.edadS, posicionEmulada: f.pos,
            metodo: 'Último cuadro recibido por el adaptador ' + (n.tipo === 'webcam' ? 'de cámara web' : 'de EMULACIÓN desde archivo') + ' (JPEG 480 px)',
            transformacion: 'Reducción a 480 px + JPEG', deteccionesVivo: f.dets, movimientoVivo: f.mov ? { movimiento: f.mov.movimiento, score: f.mov.score } : null, comandoEquivalente: 'n/a (captura en vivo)'
          });
          const dets = (f.dets || []).filter(x => x.score >= 0.5);
          const partes = [];
          if (f.mov) partes.push(f.mov.movimiento ? 'movimiento detectado' : 'sin movimiento significativo');
          if (dets.length) partes.push('IA: ' + dets.map(x => V.claseEs(x.clase) + ' ' + Math.round(x.score * 100) + '%').join(', '));
          else if (V.ia.estado === 'listo') partes.push('IA: sin objetos sobre el umbral (50%)');
          else partes.push('motor IA no cargado: no se clasifican objetos');
          say('Cámara ' + cam.numero + ' · ' + (n.tipo === 'emulacion' ? 'EMULACIÓN en vivo desde archivo (contenido grabado, pos. ' + V.fmtDur(f.pos) + ')' : 'en vivo') + ' · cuadro de ' + V.fmtTime(f.ts, cam.tz) + ' (edad ' + n.edadS.toFixed(1) + ' s) · ' + partes.join('; ') + '.');
          card({ tipo: 'vivo', cameraId: cid, derivadoId: d.id, edadS: n.edadS, estadoConexion: n.estado, fuente: n.tipo, dets, mov: f.mov ? { movimiento: f.mov.movimiento, score: f.mov.score, cajas: f.mov.cajas } : null, segmentos: n.segmentos });
          estado.ultimoDerivadoId = d.id;
        }
        estado.ultimasCamaras = plan.camaras; break;
      }
      case 'fotogramas': {
        let total = 0;
        for (const cid of plan.camaras) {
          const cam = camById(cid); const recs = recsPorCam[cid];
          const w = C.resolverVentana(plan.ventana, cam, recs);
          // Si hay transmisión activa y se piden "últimos N", se usan los cuadros realmente recibidos
          if (plan.ventana.modo === 'ultimos' && V.live.get(cid)) {
            const fr = V.live.recent(cam, plan.ventana.segundos);
            say('Cámara ' + cam.numero + ': ' + fr.length + ' cuadro(s) recibidos en vivo en los últimos ' + V.fmtDur(plan.ventana.segundos) + ' (búfer de este navegador).');
            const sel = pick(fr, 12); const ids = [];
            for (const f of sel) { const d = await api.saveDerivative(token, null, f.blob, { tipo: 'fotograma', cameraId: cid, fuente: 'vivo', tAbs: f.ts, ancho: f.w, alto: f.h, metodo: 'Búfer en vivo (1 cuadro/s, JPEG 480 px)', transformacion: 'Reducción a 480 px + JPEG', comandoEquivalente: 'n/a' }); ids.push(d.id); }
            card({ tipo: 'fotogramas_vivo', cameraId: cid, derivados: ids, disponibles: fr.length }); total += sel.length; continue;
          }
          let hubo = false;
          for (const rec of recs) {
            const rw = V.windowForRecording(w, rec); if (!rw) continue;
            hubo = true;
            if (!rec.indexado) { say('Cámara ' + cam.numero + ': «' + rec.nombreArchivo + '» aún está en indexación (índice pendiente); no hay fotogramas de muestra todavía.'); card({ tipo: 'pendiente', recordingId: rec.id }); continue; }
            const frames = await api.listFrames(token, rec.id, rw.a, rw.b);
            const sel = pick(frames, 12); total += sel.length;
            say('Cámara ' + cam.numero + ' · ' + (rec.horaInicio ? 'grabación HISTÓRICA' : 'archivo sin hora de captura') + ' · ' + ventanaTexto(rw, rec, cam.tz) + ': ' + frames.length + ' fotogramas de índice, muestro ' + sel.length + '.' + (rw.recortada ? ' ⚠ Cobertura incompleta: la ventana pedida excede la grabación.' : ''));
            card({ tipo: 'fotogramas', cameraId: cid, recordingId: rec.id, frames: sel.map(f => f.id), ventana: rw, disponibles: frames.length, recortada: rw.recortada, historico: true });
            estado.ultimaVentana = { modo: 'posicion', recordingId: rec.id, a: rw.a, b: rw.b, texto: ventanaTexto(rw, rec, cam.tz) };
          }
          if (!hubo) { say('Cámara ' + cam.numero + ': no hay grabación que cubra ' + (w.interpretacion || w.texto || 'esa ventana') + '. Sin evidencia para mostrar.'); card({ tipo: 'sin_cobertura', cameraId: cid, ventana: w }); }
        }
        estado.ultimasCamaras = plan.camaras; if (total === 0 && !out.texto) say('Sin evidencia: no se encontraron fotogramas.');
        break;
      }
      case 'buscar': case 'ampliar': {
        let intent = plan.intent, ventana = plan.ventana, camaras = plan.camaras, clases = plan.clases;
        if (intent === 'ampliar') {
          const u = estado.ultimaVentana;
          if (!u) { say('No hay una ventana previa que ampliar. Indique cámara y periodo.'); break; }
          ventana = Object.assign({}, u, { a: Math.max(0, u.a - plan.ampliar.antes), b: u.b + plan.ampliar.despues });
          ventana.texto = 'ventana anterior ampliada ' + (plan.ampliar.antes ? V.fmtDur(plan.ampliar.antes) + ' antes' : '') + (plan.ampliar.despues ? ' ' + V.fmtDur(plan.ampliar.despues) + ' después' : '');
          intent = plan.intentBase === 'fotogramas' ? 'fotogramas' : 'buscar';
          if (intent === 'fotogramas') { const r = await C.ejecutar(api, texto, Object.assign({}, ctx, { planEditado: Object.assign({}, plan, { intent: 'fotogramas', ventana: { modo: 'posicion', recordingId: u.recordingId, a: ventana.a, b: ventana.b, texto: ventana.texto }, faltantes: [] }) })); r.plan = plan; return r; }
          ventana = { modo: 'posicion', recordingId: u.recordingId, a: ventana.a, b: ventana.b, texto: ventana.texto };
          if (!clases.length) clases = estado.ultimasClases || ['persona', 'vehiculo'];
        }
        const cc = clasesCoco(clases);
        const partes = []; const hallazgosIds = []; const cobertura = []; let movimientoAlt = [];
        for (const cid of camaras) {
          const cam = camById(cid); const w = C.resolverVentana(ventana, cam, recsPorCam[cid]);
          const r = await api.searchEvents(token, { cameraIds: [cid], ventana: w, clases: cc, limit: 50 });
          r.cobertura.forEach(cv => cobertura.push(Object.assign({ camara: cam.numero, tz: cam.tz, interpretacion: w.interpretacion }, cv)));
          r.items.forEach(f => hallazgosIds.push(f.id));
          const sinSoporte = r.cobertura.filter(cv => cv.indexado && !cv.soportaClase);
          if (sinSoporte.length && !clases.every(c => c === 'movimiento')) {
            const rm = await api.searchEvents(token, { cameraIds: [cid], ventana: w, clases: ['movimiento'], limit: 50 });
            movimientoAlt = movimientoAlt.concat(rm.items.map(f => f.id));
          }
          if (!r.cobertura.length) partes.push('Cámara ' + cam.numero + ': ninguna grabación cubre ' + (w.interpretacion || 'la ventana') + '.');
          else {
            const cv = r.cobertura[0]; const rec = recsPorCam[cid].find(x => x.id === cv.recordingId);
            partes.push('Cámara ' + cam.numero + ' · ' + ventanaTexto(cv, rec, cam.tz) + ': ' + (cv.indexado ? (cv.soportaClase ? r.total + ' hallazgo(s) de ' + grpTxt(clases) : 'la grabación sólo se analizó con detección de movimiento, que NO distingue ' + grpTxt(clases.filter(c => c !== 'movimiento')) + '') : 'índice pendiente') + (cv.recortada ? ' ⚠ cobertura parcial' : '') + '.');
          }
        }
        const n = hallazgosIds.length;
        say((n ? 'Encontré ' + n + ' hallazgo(s) sugerido(s) por el motor de visión.' : (cobertura.some(c => c.indexado && c.soportaClase) ? 'Sin evidencia: el análisis no detectó ' + grpTxt(clases) + ' en la ventana consultada.' : 'No puedo afirmar ni descartar ' + grpTxt(clases) + ': falta análisis compatible o cobertura.')) + ' ' + partes.join(' '));
        if (movimientoAlt.length) say('Como alternativa limitada muestro ' + movimientoAlt.length + ' intervalo(s) con MOVIMIENTO sin clasificar (no implica persona ni vehículo). Puede reanalizar con el motor IA local.');
        card({ tipo: 'hallazgos', ids: hallazgosIds, clases, cobertura, movimientoAlt, ventanaTexto: (ventana && (ventana.texto || '')) });
        if (hallazgosIds.length) estado.ultimoHallazgoId = hallazgosIds[0];
        else if (movimientoAlt.length) estado.ultimoHallazgoId = movimientoAlt[0];
        if (cobertura[0]) estado.ultimaVentana = { modo: 'posicion', recordingId: cobertura[0].recordingId, a: cobertura[0].a, b: cobertura[0].b, texto: ventana && ventana.texto };
        estado.ultimasCamaras = camaras; estado.ultimasClases = clases; estado.ultimoIntent = 'buscar';
        return out;
      }
      case 'clip': {
        let rec, a, b, motivo, hallazgo = null;
        const hid = plan.referencia && plan.referencia.hallazgo;
        if (hid) {
          hallazgo = await api.getFinding(token, hid);
          if (!hallazgo.recordingId) { say('El hallazgo proviene de vivo y no tiene grabación original asociada; use «clip de contexto» en la vista en vivo.'); break; }
          rec = await api.getRecording(token, hallazgo.recordingId);
          const antes = plan.clip.antes != null ? plan.clip.antes : 10, despues = plan.clip.despues != null ? plan.clip.despues : 20;
          a = hallazgo.inicio - antes; b = hallazgo.fin + despues;
          motivo = 'Hallazgo ' + hallazgo.etiqueta + ' (' + V.fmtDur(hallazgo.inicio) + '–' + V.fmtDur(hallazgo.fin) + '): ' + antes + ' s antes del inicio a ' + despues + ' s después del fin';
        } else if (plan.ventana && plan.camaras.length) {
          const cam = camById(plan.camaras[0]); const w = C.resolverVentana(plan.ventana, cam, recsPorCam[cam.id]);
          rec = recsPorCam[cam.id].find(r => V.windowForRecording(w, r));
          if (!rec) { say('No hay grabación de la cámara ' + cam.numero + ' que cubra esa ventana.'); break; }
          const rw = V.windowForRecording(w, rec); a = rw.a; b = rw.b; motivo = 'Ventana solicitada: ' + (w.texto || '');
        } else { say('¿De qué hallazgo o ventana quiere el clip? Seleccione un hallazgo (botón «extraer clip») o indique cámara e intervalo.'); break; }
        const aj = []; if (a < 0) aj.push('el inicio se ajustó al comienzo del archivo'); if (b > rec.duracion) aj.push('el fin se ajustó al final del archivo');
        const d = await V.media.makeClip(api, token, rec.id, a, b, { motivo, hallazgoId: hallazgo ? hallazgo.id : null, cameraId: rec.cameraId }, ctx.onProgress);
        say('Clip listo: ' + V.fmtDur(d.inicio, true) + ' → ' + V.fmtDur(d.fin, true) + ' (' + (d.fin - d.inicio).toFixed(1) + ' s) de «' + rec.nombreArchivo + '». ' + (d.transformacion.startsWith('ninguna') ? 'Copia de flujo sin recodificar; ' + d.alineacion + '.' : '⚠ ' + d.transformacion + '.') + (aj.length ? ' Nota: ' + aj.join(' y ') + '.' : '') + ' SHA-256 ' + d.sha256.slice(0, 16) + '…');
        card({ tipo: 'clip', derivadoId: d.id });
        estado.ultimoClipId = d.id; estado.ultimasCamaras = [rec.cameraId]; break;
      }
      case 'abrir_caso': {
        const hid = plan.referencia && plan.referencia.hallazgo; let h = null;
        if (hid) try { h = await api.getFinding(token, hid); } catch (_) { }
        const cam = h ? camById(h.cameraId) : null;
        const titulo = plan.caso.titulo || (h ? 'Revisión de ' + h.etiqueta + ' · ' + (cam ? cam.codigo : '') + ' ' + (h.tAbs ? V.fmtTime(h.tAbs, cam && cam.tz) : V.fmtDur(h.inicio)) : 'Expediente sin título ' + new Date().toLocaleDateString('es-CO'));
        const c = await api.createCase(token, { titulo, descripcion: 'Creado desde el chat: «' + texto.slice(0, 200) + '»' });
        const agregados = [];
        if (h) { await api.addEvidence(token, c.id, { tipo: 'hallazgo', refId: h.id, nota: 'Agregado al abrir el expediente' }); agregados.push('hallazgo'); }
        if (estado.ultimoClipId && plan.caso.conHallazgo) { try { await api.addEvidence(token, c.id, { tipo: 'clip', refId: estado.ultimoClipId }); agregados.push('clip'); } catch (_) { } }
        say('Expediente ' + c.codigo + ' abierto: «' + c.titulo + '».' + (agregados.length ? ' Evidencia añadida: ' + agregados.join(' y ') + '.' : ' Sin evidencia aún: añádala desde los hallazgos o clips.'));
        card({ tipo: 'caso', caseId: c.id }); estado.ultimoCasoId = c.id; break;
      }
      case 'agregar_caso': {
        const caso = await buscarCaso(api, token, plan, estado);
        if (!caso) { say('No hay un expediente de referencia. Abra uno primero («abre un caso con este hallazgo») o indique su código.'); break; }
        const r = []; const hid = plan.referencia.hallazgo;
        if (hid) { await api.addEvidence(token, caso.id, { tipo: 'hallazgo', refId: hid }); r.push('hallazgo'); }
        if (estado.ultimoClipId) { await api.addEvidence(token, caso.id, { tipo: 'clip', refId: estado.ultimoClipId }); r.push('clip'); }
        say(r.length ? 'Añadido al ' + caso.codigo + ': ' + r.join(' y ') + '.' : 'No hay hallazgo ni clip reciente que añadir.');
        card({ tipo: 'caso', caseId: caso.id }); estado.ultimoCasoId = caso.id; break;
      }
      case 'resumir_caso': case 'informe': {
        const caso = await buscarCaso(api, token, plan, estado);
        if (!caso) { say('No encontré el expediente' + (plan.caso.codigo ? ' ' + plan.caso.codigo : '') + ' en su organización.'); break; }
        const full = await api.getCase(token, caso.id);
        const cl = {}; full.evidencias.forEach(e => cl[e.clasificacion] = (cl[e.clasificacion] || 0) + 1);
        say(caso.codigo + ' «' + caso.titulo + '» · estado ' + caso.estado + ' · aprobación ' + caso.aprobacion + ' · ' + full.evidencias.length + ' evidencia(s) [' + Object.entries(cl).map(([k, v]) => v + ' ' + k.replace('_', ' ')).join(', ') + '] · ' + full.notas.length + ' nota(s).' + (full.evidencias.length ? '' : ' Sin evidencia vinculada: cualquier conclusión sería una hipótesis.'));
        if (plan.intent === 'informe') {
          const r = await V.reports.generar(api, token, caso.id);
          say('Informe preliminar v' + r.version + ' generado (SHA-256 ' + r.sha256.slice(0, 16) + '…). No constituye dictamen de admisibilidad legal.');
          card({ tipo: 'informe', caseId: caso.id, reportId: r.id });
        } else card({ tipo: 'caso', caseId: caso.id });
        estado.ultimoCasoId = caso.id; break;
      }
      case 'indicadores': {
        const m = await api.metrics(token);
        say(m.camaras + ' cámaras (' + m.camarasConectadas + ' conectadas) · ' + m.archivosProcesados + '/' + m.archivos + ' archivos procesados · ' + m.detecciones + ' detecciones · ' + m.hallazgos + ' hallazgos (' + m.revisados + ' revisados, ' + m.incidentes + ' incidentes confirmados) · trabajos pendientes: ' + (m.trabajos.pendiente + m.trabajos.en_curso) + '.');
        card({ tipo: 'indicadores', m }); break;
      }
      case 'regla': {
        if (plan.faltantes.includes('clase_regla')) { say('Las reglas soportan: persona, vehículo o movimiento. ¿Cuál quiere vigilar?'); break; }
        const cam = camById(plan.camaras[0]);
        const req = plan.regla.clase !== 'movimiento' && V.ia.estado !== 'listo';
        say('Vista previa de regla (NO activa aún): avisar en la aplicación si se detecta ' + plan.regla.clase + ' en la cámara ' + cam.numero + ' durante ' + plan.regla.duracionMin + ' min. ' + (req ? '⚠ El motor IA no está cargado: la regla no podrá dispararse para «' + plan.regla.clase + '» hasta cargarlo. ' : '') + 'Requiere transmisión activa (vivo o emulación) para evaluarse. Confirme para activarla.');
        card({ tipo: 'regla_preview', cameraId: cam.id, clase: plan.regla.clase, duracionMin: plan.regla.duracionMin, destinatario: plan.regla.destinatario, advertencia: req });
        break;
      }
      default:
        say('No reconocí la solicitud. Pruebe, por ejemplo: «muéstrame fotogramas de cámara 1 en los últimos 5 minutos disponibles», «encuentra personas entre 00:01:00 y 00:03:00», «extrae un clip de este hallazgo», «abre un caso», «indicadores».');
        card({ tipo: 'ayuda' });
    }
    if (!['ampliar'].includes(plan.intent) && plan.intent !== 'desconocido') estado.ultimoIntent = plan.intent === 'ahora' ? estado.ultimoIntent : plan.intent;
    if (plan.ventana && ['fotogramas'].includes(plan.intent) && !estado.ultimaVentana) estado.ultimaVentana = plan.ventana;
    return out;
  };

  async function buscarCaso(api, token, plan, estado) {
    const cases = await api.listCases(token);
    if (plan.caso && plan.caso.codigo) return cases.find(c => c.codigo === plan.caso.codigo) || null;
    if (estado.ultimoCasoId) return cases.find(c => c.id === estado.ultimoCasoId) || null;
    return cases[0] || null;
  }
  function pick(arr, n) { if (arr.length <= n) return arr.slice(); const out = []; for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]); return out; }
  C.pick = pick;
})();
