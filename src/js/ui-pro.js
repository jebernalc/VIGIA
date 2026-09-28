/* VIGÍA · interfaz de funciones avanzadas:
 * Central de alarmas (triage, SOP, SLA) · Plano del sitio · Sinopsis de video · Búsqueda por apariencia ·
 * Paquete de evidencia · Versión de clip con privacidad. */
(function () {
  'use strict';
  const V = window.V; const A = V.app; const esc = V.esc; const I = V.icons;
  const PRIO_TXT = { critica: 'CRÍTICA', alta: 'ALTA', media: 'MEDIA', baja: 'BAJA' };
  const PRIO_CLS = { critica: 'bad', alta: 'bad', media: 'warn', baja: 'info' };
  const EST_TXT = { nueva: 'nueva', reconocida: 'reconocida', en_atencion: 'en atención', cerrada: 'cerrada' };
  const etiqueta = c => (V.analitica && V.analitica.ETIQUETA[c]) || V.claseEs(c) || c;
  const dur = s => s == null ? '—' : s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h';

  /** Abre el reproductor del chat en una grabación y posición desde cualquier vista. */
  A.abrirEn = async function (recId, t, hid) {
    if (A.view !== 'chat') { A.go('chat'); await new Promise(r => setTimeout(r, 120)); }
    if (A.views.chat.openPlayer) A.views.chat.openPlayer(recId, t, hid);
  };

  // ======================= CENTRAL DE ALARMAS =======================
  const al = A.views.alarmas = { f: { estado: 'abiertas', prioridad: '', cam: '' }, sel: null };
  al.render = async function (m) {
    m.innerHTML = `<div class="view"><div class="row" style="margin-bottom:12px"><h1 class="h1 grow">Central de alarmas</h1><span class="small muted">Triage por prioridad · procedimiento (SOP) · SLA de reconocimiento</span></div>
      <div class="kpis" id="alk"></div>
      <div class="row" style="margin:14px 0 10px;gap:8px;flex-wrap:wrap" id="alf"></div>
      <div class="grid algrid"><div class="card" style="padding:0;overflow:hidden"><div id="alq" class="alq" role="listbox" aria-label="Cola de alarmas"></div></div><div class="card" id="ald"><div class="empty">Seleccione una alarma de la cola.</div></div></div></div>`;
    await al.refresh();
    clearInterval(al.timer);
    al.timer = setInterval(() => { if (A.view !== 'alarmas' || !A.token) { clearInterval(al.timer); return; } al.refresh(true).catch(() => { }); }, 5000);
  };
  al.refresh = async function (suave) {
    const [alerts, cams, st] = await Promise.all([A.api.listAlerts(A.token), A.api.listCameras(A.token), A.api.alarmStats(A.token).catch(() => null)]);
    al.cams = cams; const camDe = id => cams.find(c => c.id === id) || { codigo: '?', nombre: '(cámara eliminada)', tz: V.defaultTZ() };
    const ahora = Date.now();
    if (st && V.$('#alk')) V.$('#alk').innerHTML = [
      ['Abiertas', st.abiertas, (st.porEstado.nueva || 0) + ' sin reconocer'],
      ['SLA vencido', '<span style="color:' + (st.vencidas ? 'var(--bad)' : 'inherit') + '">' + st.vencidas + '</span>', 'nuevas fuera de plazo'],
      ['MTTA', dur(st.mttaS), 'tiempo medio hasta reconocer'],
      ['MTTR', dur(st.mttrS), 'tiempo medio hasta cerrar'],
      ['Cumplimiento SLA', st.cumplimientoSLA == null ? '—' : Math.round(st.cumplimientoSLA * 100) + '%', 'reconocidas dentro del plazo'],
      ['Falsas alarmas', st.tasaFalsas == null ? '—' : Math.round(st.tasaFalsas * 100) + '%', 'de las cerradas']
    ].map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join('');
    const f = al.f;
    const lista = alerts.map(a => Object.assign(a, { _e: V.alarmas.estado(a), _p: a.prioridad || V.alarmas.prioridadDe(a.clase) }))
      .filter(a => (f.estado === 'abiertas' ? a._e !== 'cerrada' : !f.estado || a._e === f.estado) && (!f.prioridad || a._p === f.prioridad) && (!f.cam || a.cameraId === f.cam))
      .sort((a, b) => (a._e === 'cerrada') - (b._e === 'cerrada') || V.alarmas.ORDEN[a._p] - V.alarmas.ORDEN[b._p] || (a._e === 'nueva' ? a.ts - b.ts : b.ts - a.ts));
    if (!suave || !V.$('#alf').childElementCount) {
      V.$('#alf').innerHTML = `<select id="alfe" aria-label="Estado">${[['abiertas', 'Abiertas'], ['', 'Todas'], ['nueva', 'Nuevas'], ['reconocida', 'Reconocidas'], ['en_atencion', 'En atención'], ['cerrada', 'Cerradas']].map(([k, l]) => `<option value="${k}" ${f.estado === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="alfp" aria-label="Prioridad"><option value="">Toda prioridad</option>${Object.keys(PRIO_TXT).map(k => `<option value="${k}" ${f.prioridad === k ? 'selected' : ''}>${PRIO_TXT[k]}</option>`).join('')}</select>
        <select id="alfc" aria-label="Cámara"><option value="">Todas las cámaras</option>${cams.map(c => `<option value="${c.id}" ${f.cam === c.id ? 'selected' : ''}>Cámara ${c.numero} · ${esc(c.nombre)}</option>`).join('')}</select>
        <span class="small muted grow" style="text-align:right">SLA: crítica ${V.alarmas.SLA_S.critica} s · alta ${V.alarmas.SLA_S.alta / 60} min · media ${V.alarmas.SLA_S.media / 60} min · baja ${V.alarmas.SLA_S.baja / 60} min</span>`;
      V.$('#alfe').onchange = e => { f.estado = e.target.value; al.refresh(); }; V.$('#alfp').onchange = e => { f.prioridad = e.target.value; al.refresh(); }; V.$('#alfc').onchange = e => { f.cam = e.target.value; al.refresh(); };
    }
    const q = V.$('#alq'); if (!q) return;
    q.innerHTML = lista.length ? lista.map(a => {
      const c = camDe(a.cameraId); const venc = V.alarmas.slaVencido(a, ahora); const rest = Math.round((a.slaS || 300) - (ahora - a.ts) / 1000);
      return `<button class="alrow ${al.sel === a.id ? 'on' : ''} ${venc ? 'venc' : ''}" data-al="${a.id}" role="option" aria-selected="${al.sel === a.id}">
        <span class="badge ${PRIO_CLS[a._p]}">${PRIO_TXT[a._p]}</span>
        <span class="grow" style="text-align:left"><b>${esc(etiqueta(a.clase))}</b> <span class="muted small">· ${esc(c.codigo)} ${esc(c.nombre)}</span><br><span class="tiny muted">${esc(V.fmtDateTime(a.ts, c.tz))} · ${esc(a.fuente === 'hallazgo' ? 'escalada desde hallazgo' : a.fuente || 'regla')}${a.asignadoA ? ' · ' + esc(a.asignadoA) : ''}</span></span>
        <span class="small" style="text-align:right;min-width:92px">${a._e === 'nueva' ? (venc ? '<b style="color:var(--bad)">SLA vencido</b><br><span class="tiny">+' + dur(-rest) + '</span>' : '<b style="color:var(--warn)">' + dur(rest) + '</b><br><span class="tiny muted">para reconocer</span>') : '<span class="badge">' + EST_TXT[a._e] + '</span>' + (a.resolucion ? '<br><span class="tiny muted">' + esc(V.alarmas.RESOLUCIONES[a.resolucion]) + '</span>' : '')}</span></button>`;
    }).join('') : '<div class="empty" style="margin:12px">Sin alarmas con este filtro. Las alarmas llegan desde reglas en vivo o al «escalar» un hallazgo.</div>';
    q.onclick = e => { const b = e.target.closest('[data-al]'); if (b) { al.sel = b.dataset.al; al.refresh(true); al.detail(); } };
    if (!suave || (al.sel && !V.$('#ald [data-alid="' + al.sel + '"]'))) al.detail();
  };
  al.detail = async function () {
    const el = V.$('#ald'); if (!el) return;
    if (!al.sel) { el.innerHTML = '<div class="empty">Seleccione una alarma de la cola.</div>'; return; }
    const a = (await A.api.listAlerts(A.token)).find(x => x.id === al.sel); if (!a) { el.innerHTML = '<div class="empty">Alarma no encontrada.</div>'; return; }
    if (!a.prioridad) Object.assign(a, V.alarmas.inicial(a.clase));
    const c = (al.cams || []).find(x => x.id === a.cameraId) || { codigo: '?', nombre: '', tz: V.defaultTZ() };
    const e = V.alarmas.estado(a); const g = A.api.can(A.token, 'alarmas.gestionar');
    const hechos = (a.pasos || []).filter(p => p.hecho).length;
    el.innerHTML = `<div data-alid="${a.id}"><div class="row"><span class="badge ${PRIO_CLS[a.prioridad]}">${PRIO_TXT[a.prioridad]}</span><h2 class="h2 grow">${esc(etiqueta(a.clase))}</h2><span class="badge">${EST_TXT[e]}</span></div>
      <div class="small tx2" style="margin:6px 0">Cámara ${esc(c.codigo)} · ${esc(c.nombre)} · ${esc(V.fmtDateTime(a.ts, c.tz))}${a.capturaTs ? ' · captura ' + esc(V.fmtDateTime(a.capturaTs, c.tz)) : ''}</div>
      ${a.blobKey ? `<div class="fcard" style="margin:8px 0"><div class="img"><img alt="Captura de la alarma" data-media="alerta:${a.id}"></div></div>` : ''}
      ${a.detalle ? '<div class="tiny muted">' + esc(Object.entries(a.detalle).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(' · ')) + '</div>' : ''}
      <div class="small" style="margin-top:8px">SLA de reconocimiento: <b>${dur(a.slaS)}</b> · ${a.reconocidaEn ? 'reconocida en ' + dur((a.reconocidaEn - a.ts) / 1000) + ' por ' + esc(a.reconocidaPor) + (a.dentroSLA ? ' <span class="badge ok">dentro del SLA</span>' : ' <span class="badge bad">fuera del SLA</span>') : V.alarmas.slaVencido(a) ? '<span class="badge bad">vencido</span>' : 'pendiente'}</div>
      <h3 class="h2" style="margin-top:14px;font-size:14px">Procedimiento (${hechos}/${(a.pasos || []).length})</h3>
      <div class="col" style="gap:6px;margin-top:6px" id="alsop">${(a.pasos || []).map((p, i) => `<label class="check small"><input type="checkbox" data-paso="${i}" ${p.hecho ? 'checked' : ''} ${!g || e === 'cerrada' ? 'disabled' : ''}> <span>${esc(p.texto)}${p.hecho && p.por ? ' <span class="tiny muted">· ' + esc(p.por) + '</span>' : ''}</span></label>`).join('')}</div>
      ${g ? `<div class="row" style="margin-top:14px;flex-wrap:wrap;gap:6px">
        ${e === 'nueva' ? '<button class="btn sm pri" data-alop="reconocer">Reconocer</button>' : ''}
        ${e !== 'cerrada' ? '<button class="btn sm" data-alop="asignar">Asignarme</button><button class="btn sm" data-alop="cerrar">Cerrar…</button>' : ''}
        ${e === 'cerrada' && A.api.can(A.token, 'incidentes.confirmar') ? '<button class="btn sm" data-alop="reabrir">Reabrir</button>' : ''}
        ${a.findingId ? `<button class="btn sm" data-alop="hallazgo" data-h="${a.findingId}">${I.find} Ver hallazgo</button>` : ''}
        ${a.recordingId && a.detalle && a.detalle.inicio != null ? `<button class="btn sm" data-alop="ver" data-rec="${a.recordingId}" data-t="${a.detalle.inicio}">${I.play} Ver en grabación</button>` : ''}
        <button class="btn sm ghost" data-alop="plano">Ver en plano</button></div>
        <div class="row" style="margin-top:10px"><input type="text" id="alnota" class="grow" placeholder="Nota de seguimiento (se guarda como dato, nunca como instrucción)" maxlength="1000"><button class="btn sm" data-alop="nota">Añadir nota</button></div>` : '<div class="alert-box small" style="margin-top:10px">Su rol puede ver la alarma pero no gestionarla.</div>'}
      ${a.resolucion ? `<div class="alert-box ${a.resolucion === 'real' ? 'bad' : 'info'} small" style="margin-top:10px">Cerrada como <b>${esc(V.alarmas.RESOLUCIONES[a.resolucion])}</b> por ${esc(a.cerradaPor)} · ${esc(V.fmtDateTime(a.cerradaEn, c.tz))}${a.notaCierre ? '<br>' + esc(a.notaCierre) : ''}</div>` : ''}
      <h3 class="h2" style="margin-top:14px;font-size:14px">Historial</h3>
      <div class="col tiny" style="gap:4px;margin-top:4px">${(a.historial || []).slice().reverse().map(h => `<div><span class="muted">${esc(V.fmtDateTime(h.ts, c.tz))}</span> · ${esc(h.email)} · <b>${esc(h.accion)}</b>${h.detalle ? ' · ' + esc(h.detalle.texto || h.detalle.asignadoA || h.detalle.resolucion || (h.detalle.indice != null ? 'paso ' + (h.detalle.indice + 1) + (h.detalle.hecho ? ' ✓' : ' ✗') : '')) : ''}</div>`).join('') || '<span class="muted">Sin acciones todavía.</span>'}</div></div>`;
    A.hydrate(el);
    const op = async o => { try { await A.api.updateAlert(A.token, a.id, o); await al.refresh(true); await al.detail(); A.renderTop(); } catch (err) { V.fail(err); } };
    el.onchange = ev => { const x = ev.target.closest('[data-paso]'); if (x) op({ accion: 'paso', indice: +x.dataset.paso, hecho: x.checked }); };
    el.onclick = async ev => {
      const b = ev.target.closest('[data-alop]'); if (!b) return; const k = b.dataset.alop;
      if (k === 'reconocer' || k === 'reabrir') return op({ accion: k });
      if (k === 'asignar') return op({ accion: 'asignar', asignadoA: A.session.email });
      if (k === 'nota') { const t = V.$('#alnota').value.trim(); if (!t) return V.toast('Escriba la nota', 'warn'); return op({ accion: 'nota', texto: t }); }
      if (k === 'hallazgo') { A.go('hallazgos'); return; }
      if (k === 'ver') return A.abrirEn(b.dataset.rec, +b.dataset.t);
      if (k === 'plano') { A.go('plano', a.cameraId); return; }
      if (k === 'cerrar') {
        const r = await V.modal('Cerrar alarma', `<div class="col"><label class="f">Resolución<select id="acr">${Object.entries(V.alarmas.RESOLUCIONES).map(([x, l]) => `<option value="${x}">${l}</option>`).join('')}</select></label>
          <label class="f">Nota de cierre (obligatoria si fue un evento real)<textarea id="acn" maxlength="1000" placeholder="Qué se verificó y qué acciones se tomaron"></textarea></label>
          <div class="small muted">Pasos del procedimiento completados: ${hechos} de ${(a.pasos || []).length}.</div></div>`,
          [{ label: 'Cancelar', value: null }, { label: 'Cerrar alarma', cls: 'pri', collect: bg => ({ resolucion: bg.querySelector('#acr').value, nota: bg.querySelector('#acn').value }) }]);
        if (r) op({ accion: 'cerrar', resolucion: r.resolucion, nota: r.nota });
      }
    };
  };

  // ======================= PLANO DEL SITIO =======================
  const pl = A.views.plano = { edit: false };
  const planoDefecto = () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#10151b"/><g stroke="#243040" stroke-width="1">' + Array.from({ length: 33 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="900"/>`).join('') + Array.from({ length: 19 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="1600" y2="${i * 50}"/>`).join('') + '</g><g fill="none" stroke="#3a4a5e" stroke-width="6"><rect x="80" y="80" width="1440" height="740"/><line x1="700" y1="80" x2="700" y2="460"/><line x1="80" y1="460" x2="1000" y2="460"/><line x1="1000" y1="460" x2="1000" y2="820"/></g><g fill="#4d5d72" font-family="sans-serif" font-size="28"><text x="120" y="130">Recepción</text><text x="740" y="130">Salón principal</text><text x="120" y="510">Parqueadero</text><text x="1040" y="510">Bodega</text></g><text x="800" y="880" text-anchor="middle" fill="#3a4a5e" font-family="sans-serif" font-size="20">Plano de ejemplo · cargue el plano real de su sede</text></svg>');
  pl.render = async function (m, camFoco) {
    const [plan, cams, alerts] = await Promise.all([A.api.getPlan(A.token), A.api.listCameras(A.token), A.api.listAlerts(A.token)]);
    pl.plan = plan || { nombre: 'Plano principal', imagen: null, camaras: {} }; pl.cams = cams;
    const gest = A.api.can(A.token, 'camaras.gestionar');
    const vivo = new Map(V.live.status(A.session.org).map(s => [s.cameraId, s]));
    const abiertas = alerts.filter(a => V.alarmas.estado(a) !== 'cerrada');
    const estadoCam = c => { const n = abiertas.filter(a => a.cameraId === c.id); const s = vivo.get(c.id); if (n.some(a => ['critica', 'alta'].includes(a.prioridad || V.alarmas.prioridadDe(a.clase)))) return ['alarma', 'var(--bad)', n.length + ' alarma(s) abierta(s)']; if (n.length) return ['aviso', 'var(--warn)', n.length + ' alarma(s) abierta(s)']; if (s && s.estado === 'conectada') return ['vivo', 'var(--ok)', 'en vivo · ' + s.tipo]; if (s) return ['senal', 'var(--warn)', s.estado.replace('_', ' ')]; return ['off', 'var(--tx3)', 'sin transmisión activa']; };
    const puestas = cams.filter(c => pl.plan.camaras[c.id]);
    m.innerHTML = `<div class="view"><div class="row" style="margin-bottom:12px"><h1 class="h1 grow">Plano del sitio</h1>
      ${gest ? `<button class="btn sm ${pl.edit ? 'pri' : ''}" id="pled">${pl.edit ? 'Terminar edición' : 'Editar plano'}</button>` : ''}</div>
      <div class="legend" style="margin-bottom:8px"><span><i style="background:var(--ok)"></i>en vivo</span><span><i style="background:var(--bad)"></i>alarma crítica/alta abierta</span><span><i style="background:var(--warn)"></i>alarma o señal degradada</span><span><i style="background:var(--tx3)"></i>sin transmisión</span></div>
      <div class="grid plgrid"><div class="card" style="padding:8px"><div class="plano" id="plbox"><img id="plimg" alt="Plano del sitio ${esc(pl.plan.nombre)}" src="${pl.plan.imagen || planoDefecto()}" draggable="false">
        <svg id="plsvg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg>
        ${puestas.map(c => { const p = pl.plan.camaras[c.id]; const [k, col, txt] = estadoCam(c); return `<button class="plcam ${k === 'alarma' ? 'pulse' : ''} ${camFoco === c.id ? 'foco' : ''}" data-cam="${c.id}" style="left:${p.x * 100}%;top:${p.y * 100}%;--c:${col}" title="Cámara ${c.numero} · ${esc(c.nombre)} · ${esc(txt)}" aria-label="Cámara ${c.numero} ${esc(c.nombre)}: ${esc(txt)}">${c.numero}</button>`; }).join('')}
      </div>${pl.edit ? '<div class="small muted" style="margin-top:6px">Arrastre las cámaras para ubicarlas. Seleccione una para ajustar orientación y campo de visión.</div>' : ''}</div>
      <div class="col"><div class="card" id="plside"></div>
        <div class="card"><h2 class="h2">Cámaras (${cams.length})</h2><div class="col" style="gap:4px;margin-top:8px">${cams.map(c => { const [, col, txt] = estadoCam(c); return `<button class="alrow" data-cam="${c.id}"><span class="dot" style="background:${col}"></span><span class="grow" style="text-align:left"><b>${c.numero}</b> · ${esc(c.nombre)}<br><span class="tiny muted">${esc(txt)}${pl.plan.camaras[c.id] ? '' : ' · sin ubicar'}</span></span></button>`; }).join('')}</div></div></div></div></div>`;
    const svg = V.$('#plsvg');
    const imgEl = V.$('#plimg'); const conos = () => { const k = (imgEl.naturalWidth && imgEl.naturalHeight) ? imgEl.naturalWidth / imgEl.naturalHeight : 16 / 9; svg.innerHTML = puestas.concat(cams.filter(c => pl.plan.camaras[c.id] && !puestas.includes(c))).map(c => { const p = pl.plan.camaras[c.id]; if (!p) return ''; const [, col] = estadoCam(c); const a0 = (p.ang - p.fov / 2) * Math.PI / 180, a1 = (p.ang + p.fov / 2) * Math.PI / 180, r = p.alcance * 1000; const x = p.x * 1000, y = p.y * 1000; return `<path d="M${x},${y} L${x + r * Math.cos(a0)},${y + r * Math.sin(a0) * k} A${r},${r * k} 0 0,1 ${x + r * Math.cos(a1)},${y + r * Math.sin(a1) * k} Z" fill="${col}" fill-opacity=".16" stroke="${col}" stroke-opacity=".6" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`; }).join(''); };
    conos(); imgEl.onload = conos;
    const side = async id => {
      const c = cams.find(x => x.id === id); const el = V.$('#plside'); if (!c) { el.innerHTML = '<div class="empty">Seleccione una cámara en el plano o en la lista.</div>'; return; }
      const p = pl.plan.camaras[c.id]; const [, col, txt] = estadoCam(c); const n = abiertas.filter(a => a.cameraId === c.id);
      el.innerHTML = `<div class="row"><span class="dot" style="background:${col}"></span><h2 class="h2 grow">Cámara ${c.numero} · ${esc(c.nombre)}</h2></div>
        <div class="small tx2" style="margin:6px 0">${esc(c.codigo)} · ${esc(c.tipo)} · ${esc([c.sede, c.zona, c.ubicacion].filter(Boolean).join(' · ') || 'sin ubicación registrada')} · ${esc(txt)}</div>
        ${n.length ? `<div class="alert-box bad small">${n.length} alarma(s) abierta(s): ${n.slice(0, 3).map(a => esc(etiqueta(a.clase))).join(', ')}</div>` : ''}
        <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px"><button class="btn sm" data-plgo="ops">${I.live} Centro de operaciones</button><button class="btn sm" data-plgo="alarmas">${I.bell} Alarmas</button><button class="btn sm" data-plgo="analitica">${I.kpi} Analítica</button></div>
        ${pl.edit ? `<div class="col" style="margin-top:12px">${p ? `<label class="f">Orientación (${p.ang}°)<input type="range" min="0" max="359" value="${p.ang}" data-plp="ang"></label><label class="f">Campo de visión (${p.fov}°)<input type="range" min="20" max="180" value="${p.fov}" data-plp="fov"></label><label class="f">Alcance<input type="range" min="3" max="50" value="${Math.round(p.alcance * 100)}" data-plp="alcance"></label><button class="btn sm danger" id="plquit">Quitar del plano</button>` : '<button class="btn sm pri" id="plponer">Colocar en el centro del plano</button>'}</div>` : ''}`;
      el.onclick = e => { const g = e.target.closest('[data-plgo]'); if (g) { if (g.dataset.plgo === 'alarmas') al.f.cam = c.id; A.go(g.dataset.plgo); } };
      V.$$('[data-plp]', el).forEach(inp => inp.oninput = () => { const k = inp.dataset.plp; p[k] = k === 'alcance' ? +inp.value / 100 : +inp.value; inp.parentElement.firstChild.textContent = { ang: 'Orientación (' + p.ang + '°)', fov: 'Campo de visión (' + p.fov + '°)', alcance: 'Alcance' }[k]; conos(); pl.sucio = true; });
      if (V.$('#plponer')) V.$('#plponer').onclick = () => { pl.plan.camaras[c.id] = { x: 0.5, y: 0.5, ang: 0, fov: 70, alcance: 0.12 }; pl.sucio = true; guardar().then(() => pl.render(m, c.id)); };
      if (V.$('#plquit')) V.$('#plquit').onclick = () => { delete pl.plan.camaras[c.id]; pl.sucio = true; guardar().then(() => pl.render(m)); };
    };
    const guardar = async () => { if (!pl.sucio) return; try { pl.plan = await A.api.savePlan(A.token, { nombre: pl.plan.nombre, camaras: pl.plan.camaras }); pl.sucio = false; } catch (e) { V.fail(e); } };
    m.querySelector('.view').onclick = e => { const b = e.target.closest('[data-cam]'); if (b && !pl.arrastrado) side(b.dataset.cam); pl.arrastrado = false; };
    if (V.$('#pled')) V.$('#pled').onclick = async () => { if (pl.edit) await guardar(); pl.edit = !pl.edit; pl.render(m, camFoco); };
    side(camFoco || (puestas[0] && puestas[0].id));
    if (pl.edit) {
      const box = V.$('#plbox'); let drag = null;
      box.onpointerdown = e => { const b = e.target.closest('.plcam'); if (!b) return; drag = b; b.setPointerCapture(e.pointerId); e.preventDefault(); };
      box.onpointermove = e => { if (!drag) return; const r = box.getBoundingClientRect(); const x = V.clamp((e.clientX - r.left) / r.width, 0, 1), y = V.clamp((e.clientY - r.top) / r.height, 0, 1); drag.style.left = x * 100 + '%'; drag.style.top = y * 100 + '%'; const p = pl.plan.camaras[drag.dataset.cam]; p.x = x; p.y = y; conos(); pl.sucio = true; pl.arrastrado = true; };
      box.onpointerup = () => { if (drag) { drag = null; guardar(); } };
      const up = document.createElement('label'); up.className = 'btn sm'; up.innerHTML = I.up + ' Cargar imagen del plano<input type="file" accept="image/png,image/jpeg,image/webp" hidden>';
      V.$('#pled').before(up);
      up.querySelector('input').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const bmp = await createImageBitmap(f); const esc2 = Math.min(1, 2000 / bmp.width); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * esc2); c.height = Math.round(bmp.height * esc2); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.85); pl.plan = await A.api.savePlan(A.token, { imagen: url, camaras: pl.plan.camaras }); V.toast('Plano actualizado'); pl.render(m, camFoco);
        } catch (err) { V.fail(err); }
      };
    }
  };

  // ======================= SINOPSIS DE VIDEO =======================
  A.sinopsis = async function (recId) {
    const [rec, an] = await Promise.all([A.api.getRecording(A.token, recId), A.api.getAnalysis(A.token, recId)]);
    const cam = await A.api.getCamera(A.token, rec.cameraId);
    const pistas = an && an.resultado && an.resultado.pistas || [];
    const conCajas = pistas.filter(p => (p.trayectoria || []).some(q => q.length >= 7));
    if (!conCajas.length) return V.modal('Sinopsis de video', `<div class="alert-box">${pistas.length ? 'El análisis de esta grabación es de una versión anterior y no guarda la caja de cada muestra.' : 'Esta grabación no tiene objetos seguidos.'} La sinopsis requiere el análisis con <b>motor IA</b> (personas y vehículos con seguimiento). Use «Reanalizar con IA» y vuelva a intentarlo.</div>`, [{ label: 'Cerrar', value: null }]);
    const lab = (p, t) => rec.horaInicio != null ? V.fmtTime(rec.horaInicio + t * 1000, cam.tz) : V.fmtDur(t);
    let prep = null, plan = null, sel = null, s = 0, play = false, vel = 2, vis = [];
    await V.modal('Sinopsis de video · ' + cam.codigo + ' · ' + rec.nombreArchivo, `<div class="col">
      <p class="small tx2">Muestra a la vez los objetos que pasaron en distintos momentos, cada uno con su hora real. Haga clic en un objeto para ir al momento original. Es un <b>derivado sintético</b> para revisión rápida: no es evidencia original.</p>
      <div class="row" style="flex-wrap:wrap;gap:6px" id="sfil">
        <label class="check small"><input type="checkbox" data-g="persona" checked> personas</label><label class="check small"><input type="checkbox" data-g="vehiculo" checked> vehículos</label>
        <select id="ssup" aria-label="Color superior"><option value="">prenda superior: cualquiera</option>${V.analitica.COLORES.map(c => `<option>${c}</option>`).join('')}</select>
        <select id="sinf" aria-label="Color inferior"><option value="">prenda inferior: cualquiera</option>${V.analitica.COLORES.map(c => `<option>${c}</option>`).join('')}</select>
        <button class="btn sm pri" id="sgen">Generar sinopsis</button></div>
      <div id="sprog" class="small muted"></div>
      <div id="swrap" hidden><canvas id="scv" class="sinopsis" aria-label="Sinopsis de video"></canvas>
        <div class="row" style="gap:6px;margin-top:6px"><button class="btn sm" id="splay">${I.play} Reproducir</button><input type="range" id="sscrub" class="grow" min="0" value="0" step="0.1" aria-label="Posición en la sinopsis"><span class="small mono" id="spos"></span>
          <select id="svel" aria-label="Velocidad"><option value="1">1×</option><option value="2" selected>2×</option><option value="4">4×</option></select></div>
        <div class="small" id="sres" style="margin-top:6px"></div>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm" id="spng">${I.img} Guardar imagen estroboscópica</button><button class="btn sm" id="swebm">${I.dl} Exportar video de la sinopsis</button></div></div></div>`,
    [{ label: 'Cerrar', value: null }], {
      wide: true, onOpen: bg => {
        const q = x => bg.querySelector(x); const cv = q('#scv'); let ctx = null, raf = null, ult = 0;
        const pintar = () => { if (!prep) return; vis = V.sinopsis.dibujar(ctx, prep, plan, s, { etiqueta: lab, marca: 'SINOPSIS · ' + cam.codigo + ' · ' + plan.items.length + ' objetos · ' + V.fmtDur(plan.original) + ' → ' + V.fmtDur(plan.len) }); q('#sscrub').value = s; q('#spos').textContent = V.fmtDur(s) + ' / ' + V.fmtDur(plan.len); };
        const bucle = ts => { if (!bg.isConnected) return; if (play) { s += (ts - (ult || ts)) / 1000 * vel; if (s > plan.len) s = 0; pintar(); } ult = ts; raf = requestAnimationFrame(bucle); };
        q('#sgen').onclick = async () => {
          const grupos = [...bg.querySelectorAll('[data-g]')].filter(x => x.checked).map(x => x.dataset.g);
          sel = V.sinopsis.filtrar(conCajas, { grupos, superior: q('#ssup').value || null, inferior: q('#sinf').value || null });
          if (!sel.length) { q('#sprog').textContent = 'Ningún objeto cumple el filtro.'; return; }
          q('#sgen').disabled = true; play = false;
          try {
            plan = V.sinopsis.planificar(sel);
            const src = (await A.api.mediaURL(A.token, 'original', rec.id, 'ver')).blob;
            prep = await V.sinopsis.preparar(src, plan, { onProgress: p => { q('#sprog').innerHTML = '<div class="prog"><i style="width:' + Math.round(p * 100) + '%"></i></div>Extrayendo recortes del original… ' + Math.round(p * 100) + '%'; } });
            cv.width = prep.W; cv.height = prep.H; ctx = cv.getContext('2d'); q('#sscrub').max = plan.len; s = 0; q('#swrap').hidden = false; pintar();
            q('#sprog').innerHTML = ''; q('#sres').innerHTML = `<b>${plan.items.length}</b> objeto(s) · ${V.fmtDur(plan.original)} de actividad condensados en <b>${V.fmtDur(plan.len)}</b> (×${plan.compresion}).`;
            if (!raf) raf = requestAnimationFrame(bucle);
          } catch (e) { q('#sprog').textContent = V.errMsg(e); }
          q('#sgen').disabled = false;
        };
        q('#splay').onclick = () => { play = !play; ult = 0; q('#splay').innerHTML = play ? '❚❚ Pausa' : I.play + ' Reproducir'; };
        q('#sscrub').oninput = e => { s = +e.target.value; pintar(); };
        q('#svel').onchange = e => { vel = +e.target.value; };
        cv.onclick = e => { const r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; const h = vis.slice().reverse().find(v => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h); if (h) { bg.remove(); A.abrirEn(rec.id, h.tReal); } };
        q('#spng').onclick = async () => { try { const c = V.sinopsis.estroboscopica(prep, plan, { etiqueta: lab, marca: 'SINOPSIS ESTROBOSCÓPICA · ' + cam.codigo + ' · derivado sintético' }); const b = await V.media.toBlob(c, 'image/png'); const d = await A.api.saveDerivative(A.token, rec.id, b, { tipo: 'sinopsis', nombre: 'sinopsis_' + V.safeName(rec.nombreArchivo).replace(/\.\w+$/, '') + '.png', metodo: 'sinopsis estroboscópica (fondo por mediana + mejor recorte de cada objeto)', transformacion: 'composición sintética; no es un fotograma original', detalle: { objetos: plan.items.length } }); V.toast('Imagen guardada en clips y fotogramas · SHA-256 ' + d.sha256.slice(0, 12) + '…'); } catch (e) { V.fail(e); } };
        q('#swebm').onclick = async () => { const b0 = q('#swebm'); b0.disabled = true; try { const blob = await V.sinopsis.grabar(prep, plan, { etiqueta: lab, velocidad: vel, marca: 'SINOPSIS · ' + cam.codigo + ' · derivado sintético', onProgress: p => b0.textContent = 'Grabando… ' + Math.round(p * 100) + '%' }); const d = await A.api.saveDerivative(A.token, rec.id, blob, { tipo: 'sinopsis', nombre: 'sinopsis_' + V.safeName(rec.nombreArchivo).replace(/\.\w+$/, '') + '.webm', metodo: 'sinopsis de video (' + vel + '×, ' + plan.items.length + ' objetos)', transformacion: 'composición sintética recodificada; no es evidencia original', detalle: { objetos: plan.items.length, compresion: plan.compresion } }); V.toast('Video de sinopsis guardado · SHA-256 ' + d.sha256.slice(0, 12) + '…'); } catch (e) { V.fail(e); } b0.disabled = false; b0.innerHTML = I.dl + ' Exportar video de la sinopsis'; };
      }
    });
  };

  // ======================= BÚSQUEDA POR APARIENCIA =======================
  A.buscarSimilares = async function (findingId) {
    let umbral = 0.8;
    const pintar = async bg => {
      const out = bg.querySelector('#simres'); out.innerHTML = '<span class="spin"></span> buscando…';
      try {
        const r = await A.api.searchAppearance(A.token, { findingId, umbral });
        const cards = await Promise.all(r.items.map(async f => '<div class="col" style="gap:2px"><div class="badge acc" style="align-self:flex-start">similitud ' + Math.round(f.similitud * 100) + '%</div>' + await A.views.chat.findingCard(f, true) + '</div>'));
        out.innerHTML = `<div class="small tx2" style="margin-bottom:8px">${r.total} de ${r.candidatos} persona(s) seguidas superan el umbral. ${esc(r.metodo)}</div>` + (cards.length ? '<div class="thumbs">' + cards.join('') + '</div>' : '<div class="empty">Sin coincidencias sobre el umbral. Pruebe a bajarlo.</div>');
        A.hydrate(out);
      } catch (e) { out.innerHTML = '<div class="alert-box">' + esc(V.errMsg(e)) + '</div>'; }
    };
    const ref = await A.api.getFinding(A.token, findingId);
    await V.modal('Búsqueda por apariencia en todas las cámaras', `<div class="col"><div class="row" style="align-items:flex-start;gap:12px"><div style="width:260px">${await A.views.chat.findingCard(ref, true)}</div>
      <div class="grow small tx2">Encuentra a personas con <b>ropa de colores similares</b> (torso y piernas) en todas las grabaciones analizadas de la organización. <b>No es reconocimiento facial ni biometría</b>: dos personas vestidas igual darán coincidencia, y la iluminación la afecta. Verifique siempre visualmente.
      <label class="f" style="margin-top:10px">Umbral de similitud: <b id="simu">80%</b><input type="range" id="simr" min="60" max="98" value="80"></label></div></div><div id="simres"></div></div>`,
    [{ label: 'Cerrar', value: null }], {
      wide: true, onOpen: bg => {
        A.hydrate(bg); pintar(bg);
        const r = bg.querySelector('#simr'); r.oninput = () => { bg.querySelector('#simu').textContent = r.value + '%'; }; r.onchange = () => { umbral = +r.value / 100; pintar(bg); };
        bg.querySelector('#simres').addEventListener('click', e => { const b = e.target.closest('[data-act="ver"]'); if (b) { e.stopPropagation(); bg.remove(); A.abrirEn(b.dataset.rec, +b.dataset.t, b.dataset.h); } });
      }
    });
  };

  // ======================= PAQUETE DE EVIDENCIA =======================
  A.exportarPaquete = async function (caseId) {
    const r = await V.modal('Paquete de evidencia (ZIP verificable)', `<div class="col">
      <p class="small tx2">Genera un ZIP con los binarios de las evidencias, <span class="mono">manifiesto.json</span> (origen, intervalo, transformaciones, SHA-256), <span class="mono">SHA256SUMS.txt</span> verificable con <span class="mono">sha256sum -c</span>, el informe HTML, la cadena de custodia (CSV) y la auditoría encadenada. La exportación queda registrada.</p>
      <label class="check"><input type="checkbox" id="pko"> Incluir grabaciones originales completas (puede ser grande)</label>
      <label class="check"><input type="checkbox" id="pkp"> Modo privacidad: pixelar personas en las imágenes y omitir videos sin redactar</label>
      <label class="f">Qué ocultar en modo privacidad<select id="pkm"><option value="cuerpo">Persona completa</option><option value="cabeza">Sólo la cabeza (30% superior)</option></select></label>
      <div id="pkprog" class="small muted"></div></div>`,
    [{ label: 'Cancelar', value: null }, { label: 'Generar paquete', cls: 'pri', collect: bg => ({ o: bg.querySelector('#pko').checked, p: bg.querySelector('#pkp').checked, m: bg.querySelector('#pkm').value }) }]);
    if (!r) return;
    const t = V.toast('Generando paquete de evidencia…', '', 60000);
    try {
      const res = await V.paquete.construir(A.api, A.token, caseId, { incluirOriginales: r.o, privacidad: r.p, modo: r.m });
      if (t && t.remove) t.remove();
      await V.downloadBlob(res.blob, res.nombre);
      await V.modal('Paquete generado', `<div class="col small"><div><b>${esc(res.nombre)}</b> · ${V.fmtBytes(res.blob.size)} · ${res.archivos} archivos</div><div class="hash">SHA-256 del ZIP: ${esc(res.sha256)}</div>
        ${res.omitidos.length ? '<div class="alert-box small">Omitidos: ' + res.omitidos.map(o => esc((o.archivo || o.evidencia || '') + ' — ' + o.motivo)).join('<br>') + '</div>' : ''}
        <div class="muted">Guarde este hash por separado: permite demostrar que el paquete no fue alterado después de exportarlo. El registro de exportación quedó en la auditoría.</div></div>`, [{ label: 'Cerrar', value: null }]);
    } catch (e) { if (t && t.remove) t.remove(); V.fail(e); }
  };

  // ======================= acciones globales data-pro =======================
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-pro]'); if (!b || !A.token) return;
    e.preventDefault(); e.stopPropagation();
    const id = b.dataset.id;
    try {
      switch (b.dataset.pro) {
        case 'similar': await A.buscarSimilares(id); break;
        case 'escalar': { const a = await A.api.alarmFromFinding(A.token, id); V.toast('Enviado a la central de alarmas · prioridad ' + (PRIO_TXT[a.prioridad] || a.prioridad)); A.renderTop(); break; }
        case 'sinopsis': await A.sinopsis(id); break;
        case 'paquete': await A.exportarPaquete(id); break;
        case 'privacidad': {
          if (!await V.confirmar('Versión con privacidad', 'Se generará un nuevo clip (recodificado) con las personas pixeladas según las detecciones del motor IA. El clip original no se modifica. La reproducción tarda lo mismo que el clip.', 'Generar')) return;
          const old = b.innerHTML; b.disabled = true;
          const d = await V.privacidad.redactarClip(A.api, A.token, id, { onProgress: p => { b.textContent = 'Procesando… ' + Math.round(p * 100) + '%'; } });
          b.innerHTML = old; b.disabled = false; V.toast('Clip con privacidad guardado · SHA-256 ' + d.sha256.slice(0, 12) + '…'); break;
        }
      }
    } catch (err) { b.disabled = false; V.fail(err); }
  }, true);

  // alarmas nuevas: actualizar la central abierta
  V.on('alerts:new', a => { if (A.view === 'alarmas' && A.session && a.org === A.session.org) al.refresh(true).catch(() => { }); });
})();
