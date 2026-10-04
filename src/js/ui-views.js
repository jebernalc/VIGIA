/* VIGÍA · ui-views.js — Centro de operaciones, Hallazgos, Expedientes, Indicadores, Administración */
(function () {
  'use strict';
  const V = window.V, A = V.app, I = V.icons, esc = V.esc;

  // ======================= utilidades =======================
  function localToMs(value, tz) { // "YYYY-MM-DDTHH:MM[:SS]" en zona tz -> ms UTC
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/); if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    let t = guess - V.tzOffsetMs(guess, tz); t = guess - V.tzOffsetMs(t, tz); return t;
  }
  V.localToMs = localToMs;
  const tzOptions = sel => { const l = V.TZS.includes(sel) || !sel ? V.TZS : [sel].concat(V.TZS); return l.map(z => `<option ${z === sel ? 'selected' : ''}>${z}</option>`).join(''); };

  A.cameraForm = async function (cam) {
    cam = cam || { tipo: 'archivo', tz: 'America/Bogota' };
    const r = await V.modal(cam.id ? 'Editar cámara' : 'Nueva cámara', `<div class="grid" style="grid-template-columns:1fr 1fr">
      <label class="f">Nombre*<input type="text" id="cn" value="${esc(cam.nombre || '')}" placeholder="Portería principal" required></label>
      <label class="f">Código<input type="text" id="cc" value="${esc(cam.codigo || '')}" placeholder="auto (CAM-01)"></label>
      <label class="f">Tipo de fuente<select id="ct"><option value="archivo" ${cam.tipo === 'archivo' ? 'selected' : ''}>Archivo de video (histórico / emulación en vivo)</option><option value="webcam" ${cam.tipo === 'webcam' ? 'selected' : ''}>Cámara web local (en vivo)</option><option value="rtsp" ${cam.tipo === 'rtsp' ? 'selected' : ''}>RTSP (requiere agente de borde)</option></select></label>
      <label class="f">Zona horaria*<select id="cz">${tzOptions(cam.tz)}</select></label>
      <label class="f" id="crw" style="grid-column:1/-1">URL RTSP (la contraseña se enmascara y no se guarda)<input type="text" id="cr" value="${esc(cam.rtspUrl || '')}" placeholder="rtsp://usuario:clave@192.168.1.10:554/stream1"></label>
      <label class="f">Sede<input type="text" id="cs" value="${esc(cam.sede || '')}" placeholder="Sede principal"></label>
      <label class="f">Zona<input type="text" id="czn" value="${esc(cam.zona || '')}" placeholder="Acceso vehicular"></label>
      <label class="f" style="grid-column:1/-1">Ubicación / descripción<input type="text" id="cu" value="${esc(cam.ubicacion || '')}" placeholder="Poste norte, 3 m, mirando a la entrada"></label></div>`,
      [{ label: 'Cancelar', value: null }, { label: 'Guardar', cls: 'pri', collect: bg => ({ id: cam.id, nombre: bg.querySelector('#cn').value, codigo: bg.querySelector('#cc').value || undefined, tipo: bg.querySelector('#ct').value, tz: bg.querySelector('#cz').value, rtspUrl: bg.querySelector('#cr').value, sede: bg.querySelector('#cs').value, zona: bg.querySelector('#czn').value, ubicacion: bg.querySelector('#cu').value, mascaras: cam.mascaras || [] }) }],
      { onOpen: bg => { const f = () => bg.querySelector('#crw').classList.toggle('hidden', bg.querySelector('#ct').value !== 'rtsp'); bg.querySelector('#ct').onchange = f; f(); } });
    if (!r) return null;
    try { const c = await A.api.saveCamera(A.token, r); V.toast('Cámara guardada: ' + c.codigo); return c; } catch (e) { V.fail(e); return null; }
  };

  A.importDialog = async function (cameraId, fileArg) {
    const cams = await A.api.listCameras(A.token); if (!cams.length) { V.toast('Primero cree una cámara', 'warn'); return; }
    const cam = cams.find(c => c.id === cameraId) || cams[0];
    let file = fileArg || null;
    const r = await V.modal('Importar video como evidencia', `<div class="col">
      <label class="f">Cámara destino${A.camSelect(cams, cam.id, 'id="icam"')}</label>
      <div class="drop" id="idrop" tabindex="0">${file ? esc(file.name) + ' · ' + V.fmtBytes(file.size) : 'Arrastre un MP4/MOV/WebM aquí o haga clic para elegir'}<input type="file" id="ifile" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" class="hidden"></div>
      <label class="f">Fuente declarada<input type="text" id="ifu" placeholder="Exportación DVR marca X, canal 3, entregado por…"></label>
      <label class="f">Hora de inicio de captura (opcional, en la zona horaria de la cámara)<input type="datetime-local" step="1" id="ih"><span class="tiny muted">Si se deja vacío se usa la hora del contenedor si existe; si no, se marca como desconocida. Nunca se deduce de la hora de carga.</span></label>
      <label class="check"><input type="checkbox" id="iia" ${V.ia.estado === 'listo' ? 'checked' : ''}> Analizar también con motor IA local (COCO-SSD: personas, vehículos y 78 clases más) ${V.ia.estado === 'listo' ? '' : '<span class="badge warn">se cargará (≈24 MB, local)</span>'}</label>
      <div class="tiny muted">Límite ${V.CFG.maxUploadMB} MB. El original se conserva sin alteración con SHA-256.</div></div>`,
      [{ label: 'Cancelar', value: null }, { label: 'Importar', cls: 'pri', validate: () => { if (!file) { V.toast('Elija un archivo', 'warn'); return false; } return true; }, collect: bg => ({ cameraId: bg.querySelector('#icam').value, fuente: bg.querySelector('#ifu').value, hora: bg.querySelector('#ih').value, ia: bg.querySelector('#iia').checked }) }],
      { onOpen: bg => {
        const d = bg.querySelector('#idrop'), inp = bg.querySelector('#ifile');
        const set = f => { file = f; d.textContent = f.name + ' · ' + V.fmtBytes(f.size); d.appendChild(inp); };
        d.onclick = () => inp.click(); d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') inp.click(); };
        inp.onchange = () => inp.files[0] && set(inp.files[0]);
        d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
        d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) set(e.dataTransfer.files[0]); };
      } });
    if (!r) return;
    const c2 = cams.find(c => c.id === r.cameraId);
    V.toast('Calculando SHA-256 del original…');
    try {
      if (r.ia && V.ia.estado !== 'listo') V.ia.cargar().catch(e => V.toast('Motor IA no disponible: ' + e.message + '. Se analizará sólo movimiento.', 'warn', 9000));
      const hora = r.hora ? new Date(localToMs(r.hora, c2.tz)).toISOString() : null;
      if (r.ia && V.ia._p) { try { await V.ia._p; } catch (_) { } }
      const res = await A.api.importRecording(A.token, r.cameraId, file, { fuenteDeclarada: r.fuente, horaInicioDeclarada: hora, ia: r.ia });
      V.toast('Importado · SHA-256 ' + res.recording.sha256.slice(0, 16) + '… · indexación en curso');
      A.onData('jobs');
      return res;
    } catch (e) { V.fail(e); }
  };

  // ======================= CENTRO DE OPERACIONES =======================
  const ops = A.views.ops = {};
  let opsTimer = null;
  ops.render = async function (m) {
    clearInterval(opsTimer);
    const can = p => A.api.can(A.token, p);
    m.innerHTML = `<div class="view"><div class="row" style="margin-bottom:14px"><h1 class="h1 grow">Centro de operaciones</h1>
      ${can('grabaciones.cargar') ? `<button class="btn" id="odemo2">${I.kpi} Demo de casos de uso</button><button class="btn" id="odemo">${I.play} Cargar video de demostración</button><button class="btn" id="oimp">${I.up} Importar video</button>` : ''}
      ${can('camaras.gestionar') ? `<button class="btn pri" id="onew">${I.plus} Nueva cámara</button>` : ''}</div>
      <div id="owall" class="wall"></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(420px,1fr));margin-top:16px">
        <div class="card"><div class="row"><h2 class="h2 grow">Trabajos de indexación</h2><span class="tiny muted">cola local · reanuda tras recargar</span></div><div id="ojobs" style="margin-top:8px"></div></div>
        <div class="card"><div class="row"><h2 class="h2 grow">Alertas y reglas temporales</h2></div><div id="oalerts" style="margin-top:8px"></div></div>
      </div>
      <div class="card" style="margin-top:16px"><h2 class="h2">Grabaciones (originales inmutables)</h2><div id="orecs" style="margin-top:8px;overflow:auto"></div></div></div>`;
    const b = id => V.$(id);
    if (b('#onew')) b('#onew').onclick = async () => { if (await A.cameraForm()) ops.refresh(); };
    if (b('#oimp')) b('#oimp').onclick = () => A.importDialog();
    if (b('#odemo2')) b('#odemo2').onclick = () => A.cargarDemoCasos();
    if (b('#odemo')) b('#odemo').onclick = async () => {
      try {
        let cams = await A.api.listCameras(A.token);
        let cam = cams.find(c => c.tipo === 'archivo');
        if (!cam) {
          if (!can('camaras.gestionar')) return V.toast('No hay cámara de archivo y su rol no puede crearla.', 'warn');
          cam = await A.api.saveCamera(A.token, { nombre: 'Parqueadero norte (demo)', tipo: 'archivo', tz: 'America/Bogota', sede: 'Sede demo', zona: 'Parqueadero', ubicacion: 'Video sintético generado para pruebas', mascaras: [{ x: 0, y: 0, w: 0.53, h: 0.08, nombre: 'Sello de tiempo' }] });
        }
        b('#odemo').disabled = true; b('#odemo').innerHTML = '<span class="spin"></span> Cargando…';
        const f = await V.media.cargarMuestra();
        await A.importDialog(cam.id, f);
      } catch (e) { V.fail(e); } finally { const x = b('#odemo'); if (x) { x.disabled = false; x.innerHTML = I.play + ' Cargar video de demostración'; } }
    };
    V.$('#main').onclick = ops.onClick;
    await ops.refresh();
    opsTimer = setInterval(() => { if (A.view !== 'ops') return clearInterval(opsTimer); ops.tickHUD(); }, 1000);
  };
  ops.onData = what => { if (what === 'jobs') ops.renderJobs(); else ops.refresh(); };
  ops.refresh = async function () { await Promise.all([ops.renderWall(), ops.renderJobs(), ops.renderAlerts(), ops.renderRecs()]); };
  ops.renderWall = async function () {
    const el = V.$('#owall'); if (!el) return;
    const cams = await A.api.listCameras(A.token);
    if (!cams.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1">No hay cámaras. ${A.api.can(A.token, 'camaras.gestionar') ? 'Cree una con «Nueva cámara» o use «Cargar video de demostración» (crea una cámara de archivo automáticamente).' : 'Pida a un administrador que registre cámaras.'}</div>`; return; }
    el.innerHTML = cams.map(c => {
      const l = V.live.get(c.id);
      const est = l ? l.estado : (c.tipo === 'rtsp' ? 'rtsp' : 'desconectada');
      const badge = { conectada: '<span class="badge ok"><span class="dot ok pulse"></span> conectada</span>', conectando: '<span class="badge info"><span class="spin"></span> conectando</span>', sin_senal: '<span class="badge warn">sin señal</span>', desconectada: '<span class="badge">sin transmisión</span>', rtsp: '<span class="badge warn">RTSP · requiere agente</span>', error: '<span class="badge bad">error</span>' }[est] || est;
      return `<div class="tile" data-cam="${c.id}"><div class="hd"><b>${esc(c.codigo)}</b><span class="grow small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.nombre)}</span>${badge}</div>
        <div class="scr" id="scr-${c.id}">${l ? '' : `<div style="padding:12px">${c.tipo === 'rtsp' ? 'Fuente RTSP configurada (' + esc(c.rtspUrl) + '). Un navegador no puede abrir RTSP: se requiere el agente de borde (fase posterior).' : c.tipo === 'webcam' ? 'Cámara web local · pulse «Conectar» y conceda permiso' : c.grabaciones + ' grabación(es) histórica(s).<br>«Emular en vivo» reproduce el archivo en bucle con el reloj actual (etiquetado como emulación).'}</div>`}<div class="hud" id="hud-${c.id}"></div></div>
        <div class="ft">${l ? `<button class="btn sm" data-o="stop">Desconectar</button><button class="btn sm" data-o="now">¿Qué sucede ahora?</button><button class="btn sm" data-o="ctxclip">${I.clip} clip de contexto</button>` : c.tipo !== 'rtsp' && A.api.can(A.token, 'vivo.usar') ? `<button class="btn sm pri" data-o="start">${I.live} ${c.tipo === 'webcam' ? 'Conectar' : 'Emular en vivo'}</button>` : ''}
        ${c.tipo === 'archivo' && A.api.can(A.token, 'grabaciones.cargar') ? `<button class="btn sm" data-o="imp">${I.up} Importar</button>` : ''}<button class="btn sm" data-o="chat">${I.chat} Chat</button>${A.api.can(A.token, 'camaras.gestionar') ? `<button class="btn sm ghost" data-o="edit">Editar</button>` : ''}</div></div>`;
    }).join('');
    for (const c of cams) { const l = V.live.get(c.id); if (l && l.video) { const s = V.$('#scr-' + c.id); l.video.muted = true; l.video.setAttribute('aria-label', 'Transmisión ' + c.codigo); s.prepend(l.video); if (l.video.paused && l.tipo === 'emulacion') l.video.play().catch(() => { }); } }
    ops.tickHUD();
  };
  ops.tickHUD = function () {
    V.live.adapters.forEach(a => {
      const h = V.$('#hud-' + a.cameraId); if (!h) return; const f = a.last;
      h.innerHTML = `<span class="badge">${a.tipo === 'emulacion' ? 'EMULACIÓN · pos. ' + (f ? V.fmtDur(f.pos) : '—') : 'EN VIVO'}</span>${f ? `<span class="badge">cuadro ${esc(V.fmtTime(f.ts, a.cam.tz))} · edad ${((Date.now() - f.ts) / 1000).toFixed(1)} s</span>${f.mov && f.mov.movimiento ? '<span class="badge" style="background:var(--c-movimiento)">movimiento</span>' : ''}${(f.dets || []).filter(d => d.score >= .5).slice(0, 3).map(d => '<span class="badge" style="background:' + A.claseColor(d.clase) + '">' + esc(V.claseEs(d.clase)) + ' ' + Math.round(d.score * 100) + '%</span>').join('')}` : '<span class="badge">esperando primer cuadro…</span>'}<span class="badge">búfer ${a.ring.length} s</span>`;
    });
  };
  ops.onClick = async function (e) {
    const b = e.target.closest('[data-o]'); if (!b) return; const tile = b.closest('[data-cam]'); const id = tile ? tile.dataset.cam : b.dataset.id;
    try {
      const cam = id && id.startsWith('cam_') ? await A.api.getCamera(A.token, id) : null;
      switch (b.dataset.o) {
        case 'start': b.disabled = true; b.innerHTML = '<span class="spin"></span>'; await V.live.start(A.token, cam); await ops.renderWall(); break;
        case 'stop': V.live.stop(id); await ops.renderWall(); break;
        case 'imp': await A.importDialog(id); break;
        case 'edit': if (await A.cameraForm(Object.assign({}, cam, { sede: (await A.api.listCameras(A.token)).find(c => c.id === id).sede, zona: (await A.api.listCameras(A.token)).find(c => c.id === id).zona }))) ops.refresh(); break;
        case 'chat': A.seleccion.cameraIds = [id]; A.seleccion.grupo = null; A.go('chat'); break;
        case 'now': A.seleccion.cameraIds = [id]; A.seleccion.grupo = null; A.seleccion.ventana = { modo: 'ahora', texto: 'ahora' }; A.go('chat'); setTimeout(() => { const ci = V.$('#ci'); if (ci) { ci.value = '¿Qué sucede ahora en la cámara ' + cam.numero + '?'; V.$('#cf').requestSubmit(); } }, 400); break;
        case 'ctxclip': { const d = await V.live.contextClip(A.token, cam); V.toast('Clip de contexto guardado: ' + d.nombre + ' (SHA-256 ' + d.sha256.slice(0, 12) + '…)'); break; }
        case 'ack': await A.api.ackAlert(A.token, b.dataset.id); ops.renderAlerts(); A.renderTop(); break;
        case 'cancel-rule': await A.api.cancelRule(A.token, b.dataset.id); ops.renderAlerts(); break;
        case 'ver': A.seleccion.cameraIds = [b.dataset.cam]; A.go('chat'); setTimeout(() => A.views.chat.openPlayer(b.dataset.id, 0), 300); break;
        case 'reana': await A.api.requeueAnalysis(A.token, b.dataset.id, { ia: true }); if (V.ia.estado !== 'listo') V.ia.cargar().then(() => V.worker.kick()).catch(V.fail); V.toast('Reanálisis con IA encolado'); break;
        case 'retry': await A.api.requeueAnalysis(A.token, b.dataset.id, { ia: V.ia.estado === 'listo', reanalisis: true }); break;
        case 'del': if (await V.confirmar('Eliminar grabación', 'Se eliminará el original y sus derivados. Las grabaciones vinculadas a expedientes protegidos no pueden eliminarse.', 'Eliminar')) { await A.api.deleteRecording(A.token, b.dataset.id); V.toast('Grabación eliminada'); ops.refresh(); } break;
      }
    } catch (err) { V.fail(err); ops.renderWall(); }
  };
  ops.renderJobs = async function () {
    const el = V.$('#ojobs'); if (!el) return;
    const jobs = (await A.api.listJobs(A.token)).slice(0, 12); const recs = await A.api.listRecordings(A.token);
    el.innerHTML = jobs.length ? `<table class="table"><tr><th>Archivo</th><th>Estado</th><th style="width:40%">Progreso</th></tr>${jobs.map(j => { const r = recs.find(x => x.id === j.recordingId); return `<tr><td class="small">${esc(r ? r.nombreArchivo : j.recordingId)}<div class="tiny muted">${esc(V.fmtDateTime(j.creadoEn))}${j.opciones && j.opciones.ia ? ' · IA solicitada' : ''}</div></td><td>${{ pendiente: '<span class="badge">en cola</span>', en_curso: '<span class="badge info"><span class="spin"></span> en curso</span>', completado: '<span class="badge ok">completado</span>', fallido: '<span class="badge bad">fallido</span>' }[j.estado]}${j.duracionMs ? '<div class="tiny muted">' + (j.duracionMs / 1000).toFixed(1) + ' s' + (j.videoS ? ' · ×' + (j.videoS * 1000 / j.duracionMs).toFixed(1) + ' tiempo real' : '') + '</div>' : ''}</td><td><div class="prog" role="progressbar" aria-valuenow="${Math.round(j.progreso * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(j.progreso * 100)}%"></i></div><div class="tiny muted" style="margin-top:3px">${esc(j.etapa || '')}${j.error ? ' · <span style="color:var(--bad)">' + esc(j.error) + '</span> <button class="btn xs" data-o="retry" data-id="' + j.recordingId + '">reintentar</button>' : ''}</div></td></tr>`; }).join('')}</table>` : '<div class="empty">Sin trabajos. Importe un video para iniciar la indexación.</div>';
    if (jobs.some(j => j.estado === 'completado')) ops.renderRecs();
  };
  ops.renderAlerts = async function () {
    const el = V.$('#oalerts'); if (!el) return;
    const [alerts, rules, cams] = await Promise.all([A.api.listAlerts(A.token), A.api.listRules(A.token), A.api.listCameras(A.token)]);
    const cn = id => { const c = cams.find(x => x.id === id); return c ? c.codigo : '?'; };
    const act = rules.filter(r => r.estado === 'activa');
    el.innerHTML = `${act.length ? act.map(r => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="badge ok">activa</span> ${esc(r.clase)} en ${esc(cn(r.cameraId))} hasta ${esc(V.fmtTime(r.hasta))} · ${r.disparos || 0} disparo(s)<button class="btn xs right" data-o="cancel-rule" data-id="${r.id}">cancelar</button></div>`).join('') : '<div class="small muted">Sin reglas activas. Créelas desde el chat: «avísame si aparece una persona en la cámara 1 durante 30 minutos».</div>'}
      <div style="margin-top:10px" class="col">${alerts.slice(0, 8).map(a => `<div class="row small ${a.estado === 'nueva' ? 'alert-box' : ''}" style="padding:6px"><img data-media="alerta:${a.id}" alt="Imagen de alerta" style="width:88px;border-radius:4px"><div class="grow"><b>${esc(a.clase)}</b> en ${esc(cn(a.cameraId))} · ${esc(V.fmtDateTime(a.capturaTs || a.ts))}<div class="tiny muted">${esc(a.motor)} · fuente ${esc(a.fuente)} · destinatario ${esc(a.destinatario)}${a.detalle && a.detalle.score ? ' · ' + Math.round(a.detalle.score * 100) + '%' : ''}</div></div>${a.estado === 'nueva' ? `<button class="btn xs" data-o="ack" data-id="${a.id}">marcar vista</button>` : '<span class="badge">vista</span>'}</div>`).join('') || '<div class="small muted">Sin alertas.</div>'}</div>`;
    A.hydrate(el);
  };
  ops.renderRecs = async function () {
    const el = V.$('#orecs'); if (!el) return;
    const recs = await A.api.listRecordings(A.token); const cams = await A.api.listCameras(A.token);
    el.innerHTML = recs.length ? `<table class="table"><tr><th>Archivo</th><th>Cámara</th><th>Duración / formato</th><th>Hora de inicio</th><th>SHA-256</th><th>Índice</th><th></th></tr>${recs.map(r => { const c = cams.find(x => x.id === r.cameraId) || {}; return `<tr><td>${esc(r.nombreArchivo)}<div class="tiny muted">${V.fmtBytes(r.size)} · por ${esc(r.subidoPorEmail)}</div></td><td>${esc(c.codigo || '')}</td><td class="small">${V.fmtDur(r.duracion)} · ${esc(r.codec || '…')} ${r.ancho ? r.ancho + '×' + r.alto : ''}</td><td class="small">${r.horaInicio ? esc(V.fmtDateTime(r.horaInicio, c.tz)) + '<div class="tiny muted">' + esc(r.horaInicioFuente) + '</div>' : '<span class="badge warn">desconocida</span>'}</td><td class="hash" title="${esc(r.sha256)}">${esc(r.sha256.slice(0, 20))}…</td><td>${r.indexado ? '<span class="badge ok">indexado</span>' : r.estado === 'error' ? '<span class="badge bad">error</span>' : '<span class="badge info">pendiente</span>'}<div class="tiny muted">${esc((r.motores || []).join(', '))}${r.ultimoIndice ? ' · ' + r.ultimoIndice.hallazgos + ' hallazgos' : ''}</div></td>
      <td><div class="row"><button class="btn xs" data-o="ver" data-id="${r.id}" data-cam="${r.cameraId}">${I.play} ver</button>${r.indexado && (r.motores || []).some(m => m.startsWith('coco')) && A.api.can(A.token, 'medios.ver') ? `<button class="btn xs" data-pro="sinopsis" data-id="${r.id}">sinopsis</button>` : ''}${r.indexado && !(r.motores || []).some(m => m.startsWith('coco')) && A.api.can(A.token, 'grabaciones.cargar') ? `<button class="btn xs" data-o="reana" data-id="${r.id}">${I.cpu} analizar con IA</button>` : ''}${A.api.can(A.token, 'grabaciones.eliminar') ? `<button class="btn xs danger" data-o="del" data-id="${r.id}">eliminar</button>` : ''}</div></td></tr>`; }).join('')}</table>` : '<div class="empty">Sin grabaciones.</div>';
  };

  // ======================= HALLAZGOS =======================
  const hal = A.views.hallazgos = {};
  hal.f = { estado: '', cameraId: '', clase: '' };
  hal.render = async function (m) {
    const cams = await A.api.listCameras(A.token);
    m.innerHTML = `<div class="view"><div class="row" style="margin-bottom:12px"><h1 class="h1 grow">Hallazgos</h1>
      <select id="hc" aria-label="Cámara"><option value="">Todas las cámaras</option>${cams.map(c => `<option value="${c.id}" ${hal.f.cameraId === c.id ? 'selected' : ''}>${esc(c.codigo + ' · ' + c.nombre)}</option>`).join('')}</select>
      <select id="he" aria-label="Estado"><option value="">Todos los estados</option>${['sugerido', 'revisado', 'confirmado', 'descartado'].map(s => `<option ${hal.f.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="hk" aria-label="Clase"><option value="">Todas las clases</option>${['persona', 'vehiculo', 'animal', 'objeto', 'movimiento'].map(s => `<option ${hal.f.clase === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="alert-box info small" style="margin-bottom:12px">Estados: <b>sugerido</b> (producido por un motor, sin revisión) → <b>revisado</b> (una persona lo validó) → <b>incidente confirmado</b> (supervisor/investigador). Descartado = falso positivo; se conserva para medir errores.</div>
      <div id="hl" class="thumbs" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))"></div></div>`;
    ['#hc', '#he', '#hk'].forEach((s, i) => V.$(s).onchange = e => { hal.f[['cameraId', 'estado', 'clase'][i]] = e.target.value; hal.list(); });
    V.$('#hl').onclick = hal.onClick;
    await hal.list();
  };
  hal.onData = () => hal.list();
  hal.list = async function () {
    const el = V.$('#hl'); if (!el) return;
    let fs = await A.api.listFindings(A.token, { cameraId: hal.f.cameraId || undefined, estado: hal.f.estado || undefined });
    if (hal.f.clase) fs = fs.filter(f => (V.GRUPOS_CLASE[hal.f.clase] || []).includes(f.clase));
    el.innerHTML = fs.length ? (await Promise.all(fs.slice(0, 120).map(f => A.views.chat.findingCard(f)))).join('') + (fs.length > 120 ? '<div class="muted small">Mostrando 120 de ' + fs.length + '. Refine los filtros.</div>' : '') : '<div class="empty" style="grid-column:1/-1">Sin hallazgos con estos filtros.</div>';
    A.hydrate(el);
  };
  hal.onClick = async function (e) {
    const b = e.target.closest('[data-act]'); if (!b) return; const d = b.dataset;
    try {
      if (d.act === 'rev') { await A.api.reviewFinding(A.token, d.h, d.e); V.toast('Marcado como ' + d.e); hal.list(); }
      else if (d.act === 'caso') await A.addToCase(d.tipo, d.id);
      else if (d.act === 'ver') { const f = await A.api.getFinding(A.token, d.h); A.seleccion.cameraIds = [f.cameraId]; A.go('chat'); setTimeout(() => A.views.chat.openPlayer(d.rec, +d.t, d.h), 300); }
      else if (d.act === 'sel-h' || d.act === 'clip-h') {
        const f = await A.api.getFinding(A.token, d.h); A.seleccion.cameraIds = [f.cameraId]; A.go('chat');
        A.views.chat.selectFinding(d.h);
        setTimeout(() => { const ci = V.$('#ci'); if (!ci) return; ci.value = d.act === 'clip-h' ? 'Extrae un clip desde 10 segundos antes hasta 20 segundos después de este hallazgo' : ''; ci.focus(); V.toast('Hallazgo seleccionado: «este hallazgo» se referirá a él.'); }, 350);
      }
    } catch (err) { V.fail(err); }
  };

  // ======================= EXPEDIENTES =======================
  const exp = A.views.expedientes = {};
  exp.render = async function (m, caseId) {
    exp.sel = caseId || exp.sel || null;
    m.innerHTML = `<div class="view"><div class="row" style="margin-bottom:12px"><h1 class="h1 grow">Expedientes</h1>${A.api.can(A.token, 'expedientes.crear') ? `<button class="btn pri" id="enew">${I.plus} Nuevo expediente</button>` : ''}</div>
      <div class="grid" style="grid-template-columns:minmax(240px,320px) 1fr;align-items:start" id="egrid"><div class="card flat" id="elist"></div><div id="edet"></div></div></div>`;
    if (V.$('#enew')) V.$('#enew').onclick = async () => {
      const r = await V.modal('Nuevo expediente', `<div class="col"><label class="f">Título*<input type="text" id="et"></label><label class="f">Descripción<textarea id="ed"></textarea></label><label class="f">Prioridad<select id="ep"><option>media</option><option>alta</option><option>baja</option></select></label></div>`, [{ label: 'Cancelar', value: null }, { label: 'Crear', cls: 'pri', collect: bg => ({ titulo: bg.querySelector('#et').value, descripcion: bg.querySelector('#ed').value, prioridad: bg.querySelector('#ep').value }) }]);
      if (!r) return; try { const c = await A.api.createCase(A.token, r); exp.sel = c.id; exp.render(m); } catch (e) { V.fail(e); }
    };
    if (window.innerWidth < 900) V.$('#egrid').style.gridTemplateColumns = '1fr';
    await exp.list(); if (exp.sel) await exp.detail();
  };
  exp.list = async function () {
    const cs = await A.api.listCases(A.token);
    V.$('#elist').innerHTML = cs.length ? cs.map(c => `<div style="padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;${c.id === exp.sel ? 'background:var(--panel2)' : ''}" data-c="${c.id}"><div class="row"><b class="small">${esc(c.codigo)}</b><span class="badge ${c.prioridad === 'alta' ? 'bad' : ''}">${esc(c.prioridad)}</span><span class="badge right">${esc(c.estado)}</span></div><div class="small">${esc(c.titulo)}</div></div>`).join('') : '<div class="empty" style="margin:10px">Sin expedientes. Ábralos desde un hallazgo o con «Nuevo expediente».</div>';
    V.$('#elist').onclick = e => { const it = e.target.closest('[data-c]'); if (it) { exp.sel = it.dataset.c; exp.list(); exp.detail(); } };
  };
  exp.detail = async function () {
    const el = V.$('#edet'); if (!el || !exp.sel) return;
    let d; try { d = await A.api.getCase(A.token, exp.sel); } catch (e) { el.innerHTML = '<div class="alert-box bad">' + esc(e.message) + '</div>'; return; }
    const { caso, evidencias, notas, informes } = d; const w = A.api.can(A.token, 'expedientes.crear');
    const items = [];
    for (const ev of evidencias) {
      let html = '';
      try {
        if (ev.tipo === 'hallazgo') html = await A.views.chat.findingCard(await A.api.getFinding(A.token, ev.refId), true);
        else if (ev.tipo === 'clip' || ev.tipo === 'fotograma' || ev.tipo === 'sinopsis') html = await A.views.chat.derivCard(await A.api.getDerivative(A.token, ev.refId));
        else { const r = await A.api.getRecording(A.token, ev.refId); html = '<div class="card small">Grabación original ' + esc(r.nombreArchivo) + '<div class="hash">' + esc(r.sha256) + '</div></div>'; }
      } catch (e) { html = '<div class="alert-box bad small">No accesible: ' + esc(e.message) + '</div>'; }
      items.push(`<div><div class="row small" style="margin-bottom:4px"><span class="badge acc">${esc(V.reports.CLS[ev.clasificacion] || ev.clasificacion)}</span><span class="muted">añadida por ${esc(ev.agregadoPor)} · ${esc(V.fmtDateTime(ev.en))}</span></div>${html}${ev.nota ? '<div class="tiny muted" style="margin-top:4px">Nota: ' + esc(ev.nota) + '</div>' : ''}</div>`);
    }
    el.innerHTML = `<div class="card"><div class="row"><div class="grow"><div class="small muted">${esc(caso.codigo)} · creado por ${esc(caso.creadoPor)} el ${esc(V.fmtDateTime(caso.creadoEn))}</div><h2 class="h1" style="font-size:18px">${esc(caso.titulo)}</h2></div>
      <label class="f">Estado<select id="xs" ${w ? '' : 'disabled'}>${['abierto', 'en_revision', 'cerrado'].map(s => `<option ${caso.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f">Aprobación<select id="xa" ${w ? '' : 'disabled'}>${['borrador', 'pendiente', 'aprobado'].map(s => `<option ${caso.aprobacion === s ? 'selected' : ''} ${s === 'aprobado' && !A.api.can(A.token, 'informes.aprobar') ? 'disabled' : ''}>${s}</option>`).join('')}</select></label></div>
      <p class="small tx2">${esc(caso.descripcion || 'Sin descripción')}</p>
      <div class="row"><button class="btn sm" id="xrh">Informe HTML</button><button class="btn sm" id="xrp">${I.dl} Informe PDF</button>${A.api.can(A.token, 'evidencia.descargar') ? `<button class="btn sm pri" data-pro="paquete" data-id="${caso.id}" title="ZIP con evidencias, manifiesto, SHA256SUMS y cadena de custodia">${I.shield} Paquete de evidencia</button>` : ''}<span class="badge ok">${I.shield.replace('<svg', '<svg width="12" height="12"')} protegido ante borrado</span></div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:12px">
        <div class="card"><h2 class="h2">Evidencias (${evidencias.length})</h2><div class="col" style="margin-top:8px;gap:14px" id="xev">${items.join('') || '<div class="empty">Sin evidencias. Añádalas desde hallazgos, clips o fotogramas con «añadir al caso».</div>'}</div></div>
        <div class="col"><div class="card"><h2 class="h2">Notas e hipótesis</h2>${w ? `<div class="col" style="margin-top:8px"><textarea id="xn" placeholder="Escriba una nota o hipótesis. El texto se guarda como dato: nunca se interpreta como instrucción."></textarea><div class="row"><button class="btn sm" id="xan">Añadir nota</button><button class="btn sm" id="xah">Añadir hipótesis</button></div></div>` : ''}
          <div class="col" style="margin-top:10px">${notas.slice().reverse().map(n => `<div class="small" style="border-left:3px solid ${n.tipo === 'hipotesis' ? 'var(--warn)' : 'var(--line2)'};padding-left:8px"><b>${n.tipo === 'hipotesis' ? 'Hipótesis' : 'Nota'}</b> · ${esc(n.autor)} · ${esc(V.fmtDateTime(n.en))}<div style="white-space:pre-wrap">${esc(n.texto)}</div></div>`).join('') || '<div class="muted small">Sin notas.</div>'}</div></div>
          <div class="card"><h2 class="h2">Informes generados</h2><table class="table" style="margin-top:6px"><tr><th>v</th><th>Formato</th><th>Por</th><th>SHA-256</th></tr>${informes.map(r => `<tr><td>${r.version}</td><td>${esc(r.formato)}</td><td class="small">${esc(r.generadoPor)}<div class="tiny muted">${esc(V.fmtDateTime(r.en))}</div></td><td class="hash">${esc(r.sha256.slice(0, 24))}…</td></tr>`).join('') || '<tr><td colspan=4 class="muted small">Ninguno</td></tr>'}</table></div></div></div>`;
    A.hydrate(el);
    const upd = async p => { try { await A.api.updateCase(A.token, caso.id, p); V.toast('Expediente actualizado'); exp.list(); exp.detail(); } catch (e) { V.fail(e); exp.detail(); } };
    V.$('#xs').onchange = e => upd({ estado: e.target.value }); V.$('#xa').onchange = e => upd({ aprobacion: e.target.value });
    const addN = async tipo => { try { await A.api.addNote(A.token, caso.id, V.$('#xn').value, tipo); exp.detail(); } catch (e) { V.fail(e); } };
    if (V.$('#xan')) { V.$('#xan').onclick = () => addN('nota'); V.$('#xah').onclick = () => addN('hipotesis'); }
    V.$('#xrh').onclick = async () => { try { const r = await V.reports.generar(A.api, A.token, caso.id); const u = URL.createObjectURL(new Blob([r.html], { type: 'text/html' })); setTimeout(() => URL.revokeObjectURL(u), 60000); if (!window.open(u, '_blank')) V.downloadBlob(new Blob([r.html], { type: 'text/html' }), caso.codigo + '_informe.html'); exp.detail(); } catch (e) { V.fail(e); } };
    V.$('#xrp').onclick = async () => { try { const r = await V.reports.pdf(A.api, A.token, caso.id); V.downloadBlob(r.blob, r.nombre); V.toast('PDF · SHA-256 ' + r.sha256.slice(0, 16) + '…'); exp.detail(); } catch (e) { V.fail(e); } };
    V.$('#xev').onclick = async e => { const b = e.target.closest('[data-act]'); if (!b) return; const dd = b.dataset; try { if (dd.act === 'dl') await A.download('derivado', dd.id); else if (dd.act === 'verif') { const r = await A.api.verifyDerivative(A.token, dd.id); V.toast(r.ok ? '✓ Hash verificado' : '✗ Hash no coincide', r.ok ? '' : 'bad'); } else if (dd.act === 'ver') { A.go('chat'); setTimeout(() => A.views.chat.openPlayer(dd.rec, +dd.t), 300); } } catch (err) { V.fail(err); } };
  };

  // ======================= INDICADORES =======================
  const ind = A.views.indicadores = {};
  ind.render = async function (m) {
    const x = await A.api.metrics(A.token);
    const ders = await A.api.listDerivatives(A.token);
    const clipT = ders.filter(d => d.tipo === 'clip' && d.duracionMs);
    const bar = (rows, color) => { const mx = Math.max(1, ...rows.map(r => r[1])); return '<div class="bars" role="table">' + rows.map(([l, v, c, s]) => `<div class="b" role="row" title="${esc(l)}: ${v}${s ? ' ' + esc(s) : ''}"><span role="cell">${esc(l)}</span><span class="t" role="cell"><i style="width:${v / mx * 100}%;background:${c || color || 'var(--info)'}"></i></span><b role="cell" style="text-align:right">${esc(String(v))}</b></div>`).join('') + '</div>'; };
    const clases = Object.entries(x.porClase).sort((a, b) => b[1] - a[1]);
    m.innerHTML = `<div class="view"><div class="row" style="margin-bottom:12px"><h1 class="h1 grow">Indicadores</h1><span class="small muted">Calculados en vivo sobre los registros de ${esc(A.session.orgNombre)} · ${esc(V.fmtDateTime(Date.now()))}</span></div>
      <div class="kpis">${[
        ['Cámaras', x.camaras, x.camarasConectadas + ' con transmisión activa'], ['Archivos procesados', x.archivosProcesados + ' / ' + x.archivos, x.horasVideo.toFixed(2) + ' h · ' + V.fmtBytes(x.bytesOriginales)],
        ['Detecciones', x.detecciones, clases.length + ' clases'], ['Hallazgos', x.hallazgos, x.revisados + ' revisados'], ['Incidentes confirmados', x.incidentes, ''],
        ['Trabajos pendientes', x.trabajos.pendiente + x.trabajos.en_curso, x.trabajos.completado + ' completados · ' + x.trabajos.fallido + ' fallidos'],
        ['Tiempo medio de indexación', x.tiempoMedioMs ? (x.tiempoMedioMs / 1000).toFixed(1) + ' s' : '—', x.procesamiento.length ? 'factor medio ×' + (x.procesamiento.filter(p => p.factor).reduce((a, p) => a + p.factor, 0) / Math.max(1, x.procesamiento.filter(p => p.factor).length)).toFixed(1) + ' tiempo real' : 'sin datos'],
        ['Expedientes abiertos', x.expedientesAbiertos, x.expedientes + ' en total'], ['Alertas', x.alertas, x.alertasNuevas + ' nuevas · ' + x.reglasActivas + ' reglas activas'], ['Clips / fotogramas', x.clips + ' / ' + x.fotogramasExportados, 'derivados con hash']
      ].map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join('')}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr));margin-top:14px">
        <div class="card"><h2 class="h2">Detecciones por clase</h2><p class="tiny muted">Muestras (1/s) donde el motor detectó la clase. «movimiento» no implica persona ni vehículo.</p>${clases.length ? bar(clases.map(([k, v]) => [V.claseEs(k), v, A.claseColor(k)])) : '<div class="empty">Sin detecciones</div>'}</div>
        <div class="card"><h2 class="h2">Hallazgos por estado de validación</h2><p class="tiny muted">Tasa de descarte = aproximación a falsos avisos (sólo sobre revisados).</p>${bar([['sugerido', x.hallPorEstado.sugerido], ['revisado', x.hallPorEstado.revisado], ['confirmado', x.hallPorEstado.confirmado], ['descartado', x.hallPorEstado.descartado]], 'var(--acc)')}<div class="small" style="margin-top:8px">Tasa de descarte: <b>${x.revisados ? Math.round(x.hallPorEstado.descartado / x.revisados * 100) + '%' : '— (sin revisiones)'}</b></div></div>
        <div class="card"><h2 class="h2">Tiempo de indexación por trabajo</h2><p class="tiny muted">Segundos de procesamiento (factor de tiempo real entre paréntesis).</p>${x.procesamiento.length ? bar(x.procesamiento.map((p, i) => ['#' + (i + 1) + (p.factor ? ' (×' + p.factor.toFixed(1) + ')' : ''), +(p.ms / 1000).toFixed(1)]), 'var(--c-persona)') : '<div class="empty">Sin trabajos completados</div>'}</div>
        <div class="card"><h2 class="h2">Objetivos preliminares (no garantías)</h2><table class="table small"><tr><th>Métrica</th><th>Objetivo MVP</th><th>Medido aquí</th></tr>
          <tr><td>Edad del cuadro en vivo</td><td>&lt; 2 s</td><td>${V.live.adapters.size ? Array.from(V.live.adapters.values()).filter(a => a.org === A.session.org && a.last).map(a => a.cam.codigo + ': ' + ((Date.now() - a.last.ts) / 1000).toFixed(1) + ' s').join('<br>') || 'sin cuadros' : 'sin transmisión activa'}</td></tr>
          <tr><td>Indexación (factor tiempo real)</td><td>≥ ×1 en CPU</td><td>${x.procesamiento.filter(p => p.factor).map(p => '×' + p.factor.toFixed(1)).slice(-3).join(', ') || '—'}</td></tr>
          <tr><td>Extracción de clip de 30 s</td><td>&lt; 3 s (MP4 sin recodificar)</td><td>${clipT.length ? clipT.slice(0, 3).map(d => (d.duracionMs / 1000).toFixed(2) + ' s (' + (d.fin - d.inicio).toFixed(0) + ' s)').join(', ') : '—'}</td></tr>
          <tr><td>Tasa de falsos avisos</td><td>medir por escenario</td><td>${x.revisados ? Math.round(x.hallPorEstado.descartado / x.revisados * 100) + '% de ' + x.revisados + ' revisados' : 'sin revisiones'}</td></tr></table></div>
      </div></div>`;
  };

  // ======================= ADMINISTRACIÓN =======================
  const adm = A.views.admin = {};
  const ATABS = [['camaras', 'Cámaras y grupos'], ['usuarios', 'Usuarios, roles y licencias'], ['cuenta', 'Mi cuenta y seguridad'], ['plataforma', 'Plataforma'], ['ia', 'Motor de visión'], ['retencion', 'Retención'], ['auditoria', 'Auditoría'], ['nube', 'Nube (Supabase)'], ['datos', 'Datos y almacenamiento'], ['pruebas', 'Pruebas automáticas'], ['capacidades', 'Capacidades']];
  adm.render = async function (m, tab) {
    adm.tab = tab || adm.tab || 'camaras';
    m.innerHTML = `<div class="view"><h1 class="h1" style="margin-bottom:10px">Administración</h1><div class="tabs" id="atabs" style="padding:0;margin-bottom:14px">${ATABS.filter(([k]) => (k !== 'nube' || A.api.can(A.token, 'admin.politicas')) && (k !== 'cuenta' || (A.session && A.session.nube)) && (k !== 'plataforma' || (A.session && A.session.nube && A.acceso && A.acceso.es_plataforma))).map(([k, l]) => `<button data-t="${k}" class="${adm.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="abody"></div></div>`;
    V.$('#atabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) adm.render(m, b.dataset.t); };
    const body = V.$('#abody');
    try { await adm[adm.tab](body); } catch (e) { body.innerHTML = '<div class="alert-box bad">' + esc(V.errMsg(e)) + '</div>'; }
  };
  adm.camaras = async function (body) {
    const cams = await A.api.listCameras(A.token), grupos = await A.api.listGroups(A.token); const g = A.api.can(A.token, 'camaras.gestionar');
    body.innerHTML = `<div class="card"><div class="row"><h2 class="h2 grow">Cámaras</h2>${g ? `<button class="btn sm pri" id="acn">${I.plus} Nueva cámara</button>` : ''}</div>
      <table class="table" style="margin-top:8px"><tr><th>#</th><th>Código / nombre</th><th>Tipo</th><th>Ubicación</th><th>Zona horaria</th><th>Zonas de exclusión</th><th></th></tr>${cams.map(c => `<tr><td>${c.numero}</td><td><b>${esc(c.codigo)}</b> ${esc(c.nombre)}</td><td>${esc(c.tipo)}${c.rtspUrl ? '<div class="tiny mono">' + esc(c.rtspUrl) + '</div>' : ''}</td><td class="small">${esc([c.sede, c.zona, c.ubicacion].filter(Boolean).join(' · '))}</td><td>${esc(c.tz)}</td><td>${(c.mascaras || []).length}</td><td>${g ? `<button class="btn xs" data-e="${c.id}">editar</button> <button class="btn xs" data-mk="${c.id}">zonas de exclusión</button> <button class="btn xs" data-an="${c.id}">analítica</button>` : ''}</td></tr>`).join('')}</table></div>
      <div class="card" style="margin-top:12px"><div class="row"><h2 class="h2 grow">Grupos de cámaras</h2>${g ? `<button class="btn sm" id="agn">${I.plus} Nuevo grupo</button>` : ''}</div>
      <table class="table" style="margin-top:8px"><tr><th>Grupo</th><th>Cámaras</th></tr>${grupos.map(x => `<tr><td>${esc(x.nombre)}</td><td>${x.cameraIds.map(id => { const c = cams.find(k => k.id === id); return c ? esc(c.codigo) : ''; }).join(', ')}</td></tr>`).join('') || '<tr><td colspan=2 class="muted">Sin grupos</td></tr>'}</table></div>`;
    if (V.$('#acn')) V.$('#acn').onclick = async () => { if (await A.cameraForm()) adm.render(V.$('#main'), 'camaras'); };
    if (V.$('#agn')) V.$('#agn').onclick = async () => {
      const r = await V.modal('Nuevo grupo', `<label class="f">Nombre<input type="text" id="gn"></label><div class="col" style="margin-top:10px">${cams.map(c => `<label class="check"><input type="checkbox" value="${c.id}"> ${esc(c.codigo + ' · ' + c.nombre)}</label>`).join('')}</div>`, [{ label: 'Cancelar', value: null }, { label: 'Crear', cls: 'pri', collect: bg => ({ nombre: bg.querySelector('#gn').value, cameraIds: V.$$('input[type=checkbox]:checked', bg).map(x => x.value) }) }]);
      if (r) { try { await A.api.saveGroup(A.token, r); adm.render(V.$('#main'), 'camaras'); } catch (e) { V.fail(e); } }
    };
    body.onclick = async e => {
      const ed = e.target.closest('[data-e]'), mk = e.target.closest('[data-mk]');
      if (ed) { const c = cams.find(x => x.id === ed.dataset.e); if (await A.cameraForm(c)) adm.render(V.$('#main'), 'camaras'); }
      if (mk) adm.maskEditor(cams.find(x => x.id === mk.dataset.mk));
      const an = e.target.closest('[data-an]'); if (an && await A.analyticsEditor(cams.find(x => x.id === an.dataset.an))) adm.render(V.$('#main'), 'camaras');
    };
  };
  adm.maskEditor = async function (cam) {
    const recs = await A.api.listRecordings(A.token, cam.id); let img = '';
    if (recs[0]) { const fr = await A.api.listFrames(A.token, recs[0].id, 0, 5); if (fr[0]) img = await A.mediaURL('fotograma', fr[0].id); }
    const masks = (cam.mascaras || []).map(m => Object.assign({}, m));
    const draw = bg => { bg.querySelector('#mbox').querySelectorAll('.m').forEach(x => x.remove()); masks.forEach(m => { const d = document.createElement('div'); d.className = 'm'; Object.assign(d.style, { left: m.x * 100 + '%', top: m.y * 100 + '%', width: m.w * 100 + '%', height: m.h * 100 + '%' }); bg.querySelector('#mbox').appendChild(d); }); bg.querySelector('#mcount').textContent = masks.length + ' zona(s)'; };
    const acM = new AbortController();
    const r = await V.modal('Zonas de exclusión · ' + cam.codigo, `<p class="small tx2">Arrastre sobre la imagen para excluir áreas del detector de movimiento (p. ej. sello de tiempo, árboles, pantallas). No afecta al original ni al motor IA.</p>
      ${img ? `<div class="maskedit" id="mbox"><img src="${img}" alt="Fotograma de referencia" draggable="false"></div>` : '<div class="empty" id="mbox" style="aspect-ratio:16/9;position:relative">Sin fotograma de referencia: importe un video primero. Puede dibujar igualmente.</div>'}
      <div class="row" style="margin-top:8px"><span id="mcount" class="small"></span><button class="btn xs" id="mclr">limpiar</button></div>`, [{ label: 'Cancelar', value: null }, { label: 'Guardar', cls: 'pri', value: true }], {
      wide: true, onOpen: bg => {
        const box = bg.querySelector('#mbox'); let st = null, cur = null; draw(bg);
        box.onmousedown = e => { const rc = box.getBoundingClientRect(); st = { x: (e.clientX - rc.left) / rc.width, y: (e.clientY - rc.top) / rc.height }; cur = { x: st.x, y: st.y, w: 0, h: 0 }; masks.push(cur); e.preventDefault(); };
        box.onmousemove = e => { if (!st) return; const rc = box.getBoundingClientRect(); const x = V.clamp((e.clientX - rc.left) / rc.width, 0, 1), y = V.clamp((e.clientY - rc.top) / rc.height, 0, 1); Object.assign(cur, { x: Math.min(st.x, x), y: Math.min(st.y, y), w: Math.abs(x - st.x), h: Math.abs(y - st.y) }); draw(bg); };
        window.addEventListener('mouseup', () => { if (!st) return; if (cur && (cur.w < 0.01 || cur.h < 0.01)) masks.splice(masks.indexOf(cur), 1); st = null; cur = null; draw(bg); }, { signal: acM.signal });
        bg.querySelector('#mclr').onclick = () => { masks.length = 0; draw(bg); };
      }
    });
    acM.abort();
    if (!r) return;
    const cams = await A.api.listCameras(A.token); const full = cams.find(c => c.id === cam.id);
    try { await A.api.saveCamera(A.token, Object.assign({}, full, { mascaras: masks })); V.toast('Zonas guardadas. Se aplican en nuevos análisis y en vivo tras reconectar.'); adm.render(V.$('#main'), 'camaras'); } catch (e) { V.fail(e); }
  };
  adm.usuarios = async function (body) {
    if (!A.api.can(A.token, 'admin.usuarios')) { body.innerHTML = '<div class="alert-box">Su rol no permite gestionar usuarios.</div>' + permTable(); return; }
    const ms = await A.api.listMembers(A.token);
    body.innerHTML = `<div class="card"><div class="row"><h2 class="h2 grow">Miembros de ${esc(A.session.orgNombre)}</h2><button class="btn sm pri" id="aun">${I.plus} Agregar usuario</button></div>
      <table class="table" style="margin-top:8px"><tr><th>Nombre</th><th>Correo</th><th>Rol</th></tr>${ms.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${esc(u.rolNombre)}</td></tr>`).join('')}</table></div>${permTable()}`;
    V.$('#aun').onclick = async () => {
      const r = await V.modal('Agregar usuario', `<div class="col"><label class="f">Correo<input type="email" id="ue"></label><label class="f">Nombre<input type="text" id="un"></label><label class="f">Rol<select id="ur">${Object.entries(V.ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label></div>`, [{ label: 'Cancelar', value: null }, { label: 'Agregar', cls: 'pri', collect: bg => ({ email: bg.querySelector('#ue').value, nombre: bg.querySelector('#un').value, rol: bg.querySelector('#ur').value }) }]);
      if (!r) return;
      try { const x = await A.api.createUser(A.token, r); await V.modal('Usuario agregado', x.passwordTemporal ? '<p>Contraseña temporal (se muestra una sola vez):</p><p class="mono" style="font-size:16px">' + esc(x.passwordTemporal) + '</p>' : '<p>El usuario ya existía y se agregó a esta organización con su contraseña actual.</p>', [{ label: 'Entendido', cls: 'pri' }]); adm.render(V.$('#main'), 'usuarios'); } catch (e) { V.fail(e); }
    };
  };
  function permTable() {
    const roles = Object.keys(V.ROLES);
    return `<div class="card" style="margin-top:12px;overflow:auto"><h2 class="h2">Matriz de permisos (aplicada en la API, no sólo en la interfaz)</h2><table class="table small" style="margin-top:8px"><tr><th>Permiso</th>${roles.map(r => '<th>' + esc(V.ROLES[r]) + '</th>').join('')}</tr>${Object.entries(V.PERMS).map(([p, rs]) => `<tr><td class="mono">${esc(p)}</td>${roles.map(r => '<td>' + (rs.includes(r) ? '✓' : '<span class="muted">—</span>') + '</td>').join('')}</tr>`).join('')}</table></div>`;
  }
  adm.ia = async function (body) {
    const ia = V.ia; let auto = false; try { auto = localStorage.getItem('vigia.ia.auto') === '1'; } catch (_) { }
    body.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))"><div class="card"><h2 class="h2">Detector de movimiento «movimiento-v1»</h2><p class="small"><span class="badge ok">siempre activo</span> Determinista, sin modelo. Detecta <b>cambios</b> entre cuadros; <b>no distingue</b> personas, vehículos ni animales. Umbral de luminancia 22/255; celdas 8×8 con ≥25% de cambio; componente ≥3 celdas; zonas de exclusión por cámara.</p></div>
      <div class="card"><h2 class="h2">Motor IA local «COCO-SSD» (opcional)</h2><p class="small">TensorFlow.js + COCO-SSD (Apache-2.0), 80 clases COCO (persona, automóvil, camión, bus, motocicleta, bicicleta, animales, objetos…). Se ejecuta en este equipo (WebGL o CPU). Los archivos están en la carpeta <span class="mono">motor-ia/</span>; nada se descarga de Internet y sólo se carga cuando usted lo pide.</p>
        <p>Estado: <b>${{ no_cargado: 'no cargado', cargando: 'cargando… ' + esc(ia.etapa || ''), listo: 'listo · backend ' + esc(ia.backend || ''), error: 'error' }[ia.estado]}</b>${ia.error ? '<div class="alert-box bad small">' + esc(ia.error) + '</div>' : ''}${ia.pesosSha256 ? '<div class="hash">pesos SHA-256 ' + esc(ia.pesosSha256) + ' (verificado)</div>' : ''}</p>
        <div class="row"><button class="btn pri" id="iaload" ${ia.estado === 'listo' || ia.estado === 'cargando' ? 'disabled' : ''}>${I.cpu} Cargar motor IA local</button><label class="check small"><input type="checkbox" id="iaauto" ${auto ? 'checked' : ''}> cargar al iniciar la aplicación</label></div>
        <p class="tiny muted">Limitaciones: modelo genérico entrenado con fotografías (COCO); precisión reducida en cámaras cenitales, nocturnas/IR, baja resolución u objetos pequeños. Umbral 0,50. No hay reconocimiento facial, biometría ni lectura de placas. Mida errores por escenario marcando hallazgos como descartados.</p></div></div>`;
    V.$('#iaload').onclick = async () => { V.$('#iaload').disabled = true; try { await ia.cargar(() => adm.render(V.$('#main'), 'ia')); V.toast('Motor IA listo (' + ia.backend + ')'); } catch (e) { V.fail(e); } adm.render(V.$('#main'), 'ia'); };
    V.$('#iaauto').onchange = e => { try { localStorage.setItem('vigia.ia.auto', e.target.checked ? '1' : '0'); } catch (_) { } };
  };
  adm.retencion = async function (body) {
    const p = await A.api.getPolicy(A.token); const prev = await A.api.retentionPreview(A.token); const w = A.api.can(A.token, 'admin.politicas');
    body.innerHTML = `<div class="card" style="max-width:720px"><h2 class="h2">Política de retención</h2>
      <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:10px"><label class="f">Días de retención de originales<input type="number" id="ro" value="${p.diasOriginales}" ${w ? '' : 'disabled'}></label><label class="f">Días de retención de derivados<input type="number" id="rd" value="${p.diasDerivados}" ${w ? '' : 'disabled'}></label></div>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="rp" ${p.protegerExpedientes ? 'checked' : ''} ${w ? '' : 'disabled'}> Proteger contra borrado toda evidencia vinculada a expedientes</label>
      ${w ? '<div style="margin-top:10px"><button class="btn pri sm" id="rsave">Guardar</button></div>' : ''}
      <div class="alert-box info small" style="margin-top:12px">MVP: el borrado automático programado <b>no se ejecuta</b> (fase posterior). La eliminación manual ya respeta la protección de expedientes. Vista previa de lo que vencería hoy: <b>${prev.length}</b> grabación(es), ${prev.filter(x => x.protegido).length} protegida(s).</div></div>`;
    if (V.$('#rsave')) V.$('#rsave').onclick = async () => { try { await A.api.savePolicy(A.token, { diasOriginales: V.$('#ro').value, diasDerivados: V.$('#rd').value, protegerExpedientes: V.$('#rp').checked }); V.toast('Política guardada'); } catch (e) { V.fail(e); } };
  };
  adm.auditoria = async function (body) {
    const r = await A.api.auditLog(A.token, { limit: 300 });
    body.innerHTML = `<div class="card"><div class="row"><h2 class="h2 grow">Registro de auditoría (${r.total})</h2><button class="btn sm" id="av">${I.shield} Verificar cadena de hashes</button><button class="btn sm" id="ax">${I.dl} Exportar JSON</button></div>
      <p class="tiny muted">Cada registro incluye el SHA-256 del anterior: cualquier alteración o borrado intermedio rompe la cadena.</p>
      <div style="overflow:auto"><table class="table small"><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Recurso</th><th>Detalle</th><th>Hash</th></tr>${r.items.map(a => `<tr><td>${esc(V.fmtDateTime(a.ts))}</td><td>${esc(a.email)}</td><td class="mono">${esc(a.accion)}</td><td class="tiny">${esc(a.recurso)} ${esc(a.recursoId || '')}</td><td class="tiny mono" style="max-width:280px;word-break:break-all">${esc(JSON.stringify(a.detalle))}</td><td class="hash">${esc(a.hash.slice(0, 12))}</td></tr>`).join('')}</table></div></div>`;
    V.$('#av').onclick = async () => { const v = await A.api.verifyAudit(A.token); V.toast(v.ok ? '✓ Cadena íntegra (' + v.registros + ' registros)' : '✗ Cadena rota' + (v.rotoEn ? ' en ' + v.rotoEn : '') + (v.motivo ? ' · ' + v.motivo : ''), v.ok ? '' : 'bad'); };
    V.$('#ax').onclick = () => V.downloadBlob(new Blob([JSON.stringify(r.items, null, 2)], { type: 'application/json' }), 'vigia_auditoria.json');
  };
  adm.nube = async function (body) {
    const C = V.cloud;
    if (!C.configurada()) { body.innerHTML = '<div class="alert-box">Supabase no está configurado. Defina <span class="mono">supabase: { url, publishableKey }</span> en <span class="mono">vigia.config.js</span>.</div>'; return; }
    await C.sesion().catch(() => null);
    const head = `<div class="alert-box info small" style="margin-bottom:12px">La nube guarda <b>metadatos y cadena de custodia</b> (cámaras, grabaciones con SHA-256, hallazgos, clips/fotogramas con hash, expedientes, evidencias y auditoría). <b>Los videos no se suben</b>: siguen en este equipo. El aislamiento entre organizaciones en la nube lo aplica PostgreSQL con Row Level Security.<br>Proyecto: <span class="mono">${esc(V.CFG.supabase.url)}</span></div>`;
    if (!C.user) {
      body.innerHTML = head + `<div class="card" style="max-width:480px"><h2 class="h2">Iniciar sesión en la nube</h2><div class="col" style="margin-top:10px"><label class="f">Correo<input type="email" id="ne" autocomplete="username"></label><label class="f">Contraseña (mín. 8)<input type="password" id="np" autocomplete="current-password"></label>
        <div class="row"><button class="btn pri" id="nin">Entrar</button><button class="btn" id="nreg">Crear cuenta</button></div><div id="nmsg" class="small"></div></div></div>`;
      const go = async reg => { const m = V.$('#nmsg'); m.textContent = '…'; try { const e = V.$('#ne').value.trim(), p = V.$('#np').value; if (p.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres'); if (reg) { const r = await C.registrar(e, p); if (r.requiereConfirmacion) { m.innerHTML = '<span style="color:var(--warn)">Revise su correo y confirme la cuenta; luego inicie sesión.</span>'; return; } } else await C.entrar(e, p); adm.render(V.$('#main'), 'nube'); } catch (err) { m.innerHTML = '<span style="color:var(--bad)">' + esc(V.errMsg(err)) + '</span>'; } };
      V.$('#nin').onclick = () => go(false); V.$('#nreg').onclick = () => go(true); return;
    }
    let orgs = []; try { orgs = await C.organizaciones(); } catch (e) { body.innerHTML = head + '<div class="alert-box bad">' + esc(V.errMsg(e)) + '</div>'; return; }
    if (!C.orgId || !orgs.find(o => o.id === C.orgId)) C.orgId = orgs[0] ? orgs[0].id : null;
    const cur = orgs.find(o => o.id === C.orgId);
    const cnt = cur ? await C.conteos(cur.id).catch(() => null) : null;
    body.innerHTML = head + `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="card"><div class="row"><h2 class="h2 grow">Cuenta en la nube</h2><button class="btn sm" id="nout">Cerrar sesión de la nube</button></div><p class="small">${esc(C.user.email)}</p>
        <label class="f">Organización en la nube<select id="norg">${orgs.map(o => `<option value="${o.id}" ${o.id === C.orgId ? 'selected' : ''}>${esc(o.nombre)} · ${esc(o.rol || '')}</option>`).join('') || '<option value="">(ninguna)</option>'}</select></label>
        <div class="row" style="margin-top:8px"><input type="text" id="nnew" placeholder="Nueva organización" class="grow"><button class="btn sm" id="ncre">${I.plus} Crear</button></div>
        ${cur && cur.rol === 'admin' ? `<div class="row" style="margin-top:8px"><input type="email" id="nme" placeholder="correo de un usuario registrado" class="grow"><select id="nmr">${Object.entries(V.ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button class="btn sm" id="nadd">Agregar miembro</button></div>` : ''}</div>
      <div class="card"><h2 class="h2">Sincronización</h2><p class="small tx2">Envía los datos de <b>${esc(A.session.orgNombre)}</b> (local) a <b>${cur ? esc(cur.nombre) : '—'}</b> (nube). Se puede repetir: actualiza sin duplicar; la auditoría sólo se agrega.</p>
        <button class="btn pri" id="nsync" ${cur ? '' : 'disabled'}>Sincronizar ahora</button><div class="prog" style="margin-top:8px"><i id="nprog" style="width:0"></i></div><div id="nres" class="small" style="margin-top:6px"></div>
        ${cnt ? `<table class="table small" style="margin-top:10px"><tr><th>En la nube</th><th>Registros</th></tr>${Object.entries(cnt).filter(([k]) => k !== 'ultima').map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')}<tr><td>Última sincronización</td><td>${cnt.ultima ? esc(V.fmtDateTime(Date.parse(cnt.ultima))) : 'nunca'}</td></tr></table>` : ''}</div></div>`;
    V.$('#nout').onclick = async () => { await C.salir(); adm.render(V.$('#main'), 'nube'); };
    V.$('#norg').onchange = e => { C.orgId = e.target.value; adm.render(V.$('#main'), 'nube'); };
    V.$('#ncre').onclick = async () => { try { const n = V.$('#nnew').value.trim(); if (n.length < 2) return V.toast('Escriba un nombre', 'warn'); C.orgId = await C.crearOrganizacion(n); V.toast('Organización creada en la nube'); adm.render(V.$('#main'), 'nube'); } catch (e) { V.fail(e); } };
    if (V.$('#nadd')) V.$('#nadd').onclick = async () => { try { await C.agregarMiembro(C.orgId, V.$('#nme').value.trim(), V.$('#nmr').value); V.toast('Miembro agregado'); } catch (e) { V.fail(e); } };
    V.$('#nsync').onclick = async () => { const b = V.$('#nsync'); b.disabled = true; try { const r = await C.sincronizar(A.api, A.token, C.orgId, (p, k) => { V.$('#nprog').style.width = Math.round(p * 100) + '%'; V.$('#nres').textContent = 'Enviando ' + k + '…'; }); V.toast('Sincronización completa'); V.$('#nres').textContent = Object.entries(r).map(([k, v]) => v + ' ' + k).join(' · '); setTimeout(() => adm.render(V.$('#main'), 'nube'), 800); } catch (e) { V.fail(e); V.$('#nres').textContent = V.errMsg(e); } b.disabled = false; };
  };
  adm.datos = async function (body) {
    let est = null; try { est = await navigator.storage.estimate(); } catch (_) { }
    let pers = null; try { pers = await navigator.storage.persisted(); } catch (_) { }
    body.innerHTML = `<div class="card" style="max-width:760px"><h2 class="h2">Almacenamiento local</h2><p class="small">Base de datos IndexedDB «${esc(A.api.db.name)}» (esquema v${V.DB_VERSION}) ${A.api.db.persistente ? '<span class="badge ok">persistente</span>' : '<span class="badge bad">en memoria</span>'}</p>
      ${est ? `<p class="small">Uso: <b>${V.fmtBytes(est.usage)}</b> de ${V.fmtBytes(est.quota)} disponibles para este origen.</p><div class="prog"><i style="width:${Math.min(100, est.usage / est.quota * 100)}%"></i></div>` : ''}
      <p class="small">Protección contra limpieza automática del navegador: ${pers ? '<span class="badge ok">concedida</span>' : '<span class="badge warn">no concedida</span> <button class="btn xs" id="dp">solicitar</button>'}</p>
      <div class="alert-box small">Aislamiento: la API interna aplica organización y rol en cada operación y las pruebas lo verifican. Sin embargo, en un despliegue 100% navegador todos los datos residen en este equipo: quien tenga acceso al perfil del navegador y herramientas de desarrollo puede leer IndexedDB. Para aislamiento fuerte entre clientes se requiere el servidor descrito en ARCHITECTURE.md.</div></div>`;
    if (V.$('#dp')) V.$('#dp').onclick = async () => { const ok = await navigator.storage.persist(); V.toast(ok ? 'Concedida' : 'El navegador no la concedió', ok ? '' : 'warn'); adm.render(V.$('#main'), 'datos'); };
  };
  adm.pruebas = async function (body) {
    body.innerHTML = `<div class="card"><h2 class="h2">Pruebas automáticas en este navegador</h2><p class="small tx2">Se ejecutan sobre una base de datos TEMPORAL separada (se elimina al terminar) con dos organizaciones de prueba. Cubren aislamiento, permisos, intérprete, ventanas de tiempo, hashes, fotograma auténtico, clip, informe y respuestas honestas.</p>
      <div class="row"><label class="f">Video de prueba<select id="tv"><option value="muestra">Muestra embebida (H.264; requiere Chrome/Edge/Safari)</option><option value="archivo">Elegir archivo…</option></select></label><input type="file" id="tf" accept="video/*" class="hidden"><label class="check small"><input type="checkbox" id="tia"> incluir motor IA (≈1–3 min)</label><button class="btn pri" id="trun">Ejecutar pruebas</button></div>
      <div id="tout" style="margin-top:12px"></div></div>`;
    V.$('#tv').onchange = e => { if (e.target.value === 'archivo') V.$('#tf').click(); };
    V.$('#trun').onclick = async () => {
      const out = V.$('#tout'); out.innerHTML = '<span class="spin"></span> Ejecutando…'; V.$('#trun').disabled = true;
      try {
        const file = V.$('#tv').value === 'archivo' && V.$('#tf').files[0] ? V.$('#tf').files[0] : await V.media.cargarMuestra();
        const res = await V.tests.run({ file, ia: V.$('#tia').checked, onResult: () => { out.innerHTML = V.tests.html(V.tests.last); } });
        out.innerHTML = V.tests.html(res);
      } catch (e) { out.innerHTML = '<div class="alert-box bad">' + esc(V.errMsg(e)) + '</div>'; }
      V.$('#trun').disabled = false;
    };
  };
  adm.capacidades = async function (body) {
    const rows = V.CAPACIDADES || [];
    body.innerHTML = `<div class="card"><h2 class="h2">Matriz de capacidades</h2><table class="table small" style="margin-top:8px"><tr><th>Capacidad</th><th>Estado</th><th>Notas</th></tr>${rows.map(([c, e, n]) => `<tr><td>${esc(c)}</td><td>${{ v: '<span class="badge ok">implementado y verificado</span>', p: '<span class="badge warn">implementado, verificación parcial</span>', f: '<span class="badge">fase posterior</span>' }[e]}</td><td class="tx2">${esc(n)}</td></tr>`).join('')}</table></div>`;
  };
})();
