/* VIGÍA · ui-chat.js — vista principal: chat de solicitudes + panel contextual */
(function () {
  'use strict';
  const V = window.V, A = V.app, I = V.icons, esc = V.esc;
  const S = { busy: false, lastCards: null, player: null };
  const VENTANAS = [
    ['ahora', { modo: 'ahora', texto: 'ahora' }], ['30 s', { modo: 'ultimos', segundos: 30, texto: 'últimos 30 s' }], ['5 min', { modo: 'ultimos', segundos: 300, texto: 'últimos 5 min' }],
    ['15 min', { modo: 'ultimos', segundos: 900, texto: 'últimos 15 min' }], ['1 h', { modo: 'ultimos', segundos: 3600, texto: 'última hora' }], ['todo', { modo: 'todo', texto: 'toda la grabación' }]
  ];
  const SUGS = ['¿Qué cámaras tengo?', 'Muéstrame fotogramas de cámara 1 en los últimos 5 minutos disponibles', 'Encuentra personas o vehículos entre 00:01:00 y 00:03:00', 'Extrae un clip desde 10 segundos antes hasta 20 segundos después de este hallazgo', 'Amplía cinco minutos antes', '¿Qué sucede ahora en la cámara 1?', 'Abre un caso con este hallazgo', 'Indicadores'];

  const view = A.views.chat = {};
  view.render = async function (m) {
    m.innerHTML = `<div class="chatwrap">
      <aside class="chatlist" aria-label="Conversaciones"><button class="btn sm pri" id="nc" style="width:100%;justify-content:center;margin-bottom:8px">${I.plus} Nueva conversación</button><div id="cl"></div></aside>
      <section class="thread" aria-label="Chat">
        <div class="row" style="padding:10px 14px;border-bottom:1px solid var(--line)"><b id="ctitle" class="grow" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Chat</b>
          <button class="btn sm" id="tglctx" title="Panel contextual">${I.panel} Panel</button></div>
        <div class="msgs" id="msgs" aria-live="polite"></div>
        <div class="composer">
          <div class="scope" id="scope"></div>
          <form class="inbox" id="cf"><label class="sr" for="ci">Solicitud</label><textarea id="ci" rows="1" placeholder="Escriba su solicitud…" title="Enter envía · Shift+Enter nueva línea"></textarea><button class="btn pri" id="cs" aria-label="Enviar">${I.send}</button></form>
          <div class="sugs" id="sugs">${SUGS.map(s => '<button type="button">' + esc(s) + '</button>').join('')}</div>
        </div>
      </section>
      <aside class="ctx" id="ctx" aria-label="Panel contextual"><div class="tabs" id="ctabs" role="tablist"></div><div class="ctxbody" id="cbody"></div></aside>
    </div>`;
    V.$('#nc').onclick = async () => { const c = await A.api.createChat(A.token); A.chatId = c.id; await loadChats(); await renderMsgs(); };
    V.$('#tglctx').onclick = () => V.$('#ctx').classList.toggle('open');
    V.$('#cf').onsubmit = e => { e.preventDefault(); send(V.$('#ci').value); };
    V.$('#ci').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(V.$('#ci').value); } };
    V.$('#ci').oninput = e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; };
    V.$('#sugs').onclick = e => { const b = e.target.closest('button'); if (b) { V.$('#ci').value = b.textContent; V.$('#ci').focus(); } };
    V.$('#msgs').onclick = onAction; V.$('#cbody').onclick = onAction;
    const cams = await A.api.listCameras(A.token);
    if (!A.seleccion.cameraIds.length && cams[0]) A.seleccion.cameraIds = [cams[0].id];
    await renderScope();
    await loadChats();
    if (!A.chatId) { const cs = await A.api.listChats(A.token); A.chatId = cs[0] ? cs[0].id : (await A.api.createChat(A.token)).id; await loadChats(); }
    await renderMsgs();
    renderCtx();
  };
  view.onData = what => { if (what === 'jobs' || what === 'data') { if (A.ctxTab !== 'reproductor') renderCtx(); } };

  async function loadChats() {
    const cs = await A.api.listChats(A.token);
    V.$('#cl').innerHTML = cs.map(c => `<div class="it ${c.id === A.chatId ? 'on' : ''}" data-chat="${c.id}" title="${esc(c.titulo)}">${esc(c.titulo)}<div class="tiny muted">${esc(V.fmtDateTime(c.creadoEn))}</div></div>`).join('') || '<div class="muted small">Sin conversaciones</div>';
    V.$('#cl').onclick = async e => { const it = e.target.closest('[data-chat]'); if (it) { A.chatId = it.dataset.chat; await loadChats(); await renderMsgs(); } };
    const cur = cs.find(c => c.id === A.chatId); if (cur) V.$('#ctitle').textContent = cur.titulo;
  }

  async function renderScope() {
    const cams = await A.api.listCameras(A.token), grupos = await A.api.listGroups(A.token);
    const sel = A.seleccion; const selVal = sel.grupo ? 'g:' + sel.grupo : (sel.cameraIds[0] || '');
    const w = sel.ventana;
    V.$('#scope').innerHTML = `<span class="small muted">Alcance:</span>
      <select id="scam" aria-label="Cámara o grupo">${cams.map(c => `<option value="${c.id}" ${selVal === c.id ? 'selected' : ''}>Cámara ${c.numero} · ${esc(c.nombre)}</option>`).join('')}${grupos.map(g => `<option value="g:${g.id}" ${selVal === 'g:' + g.id ? 'selected' : ''}>Grupo · ${esc(g.nombre)} (${g.cameraIds.length})</option>`).join('')}${cams.length ? '' : '<option value="">(sin cámaras)</option>'}</select>
      ${VENTANAS.map(([l, v]) => `<button type="button" class="chip ${w && w.texto === v.texto ? 'on' : ''}" data-w="${esc(JSON.stringify(v))}">${l}</button>`).join('')}
      <button type="button" class="chip ${w && w.modo === 'hms' ? 'on' : ''}" id="wcust">intervalo…</button>
      <span class="small muted" id="wexp" style="flex-basis:100%"></span>`;
    V.$('#scam').onchange = e => { const v = e.target.value; if (v.startsWith('g:')) { const g = grupos.find(x => x.id === v.slice(2)); sel.grupo = g.id; sel.cameraIds = g.cameraIds.slice(); } else { sel.grupo = null; sel.cameraIds = [v]; } explain(); renderCtx(); };
    V.$('#scope').onclick = async e => {
      const b = e.target.closest('[data-w]'); if (b) { sel.ventana = JSON.parse(b.dataset.w); renderScope(); return; }
      if (e.target.closest('#wcust')) {
        const r = await V.modal('Intervalo personalizado', `<p class="small tx2">Formato HH:MM:SS. Si la grabación tiene hora de captura y el intervalo coincide con su horario, se interpreta como hora de reloj de la cámara; si no, como posición dentro del archivo. La interpretación se muestra en cada respuesta.</p><div class="row"><label class="f">Desde<input type="text" id="wa" value="00:01:00"></label><label class="f">Hasta<input type="text" id="wb" value="00:03:00"></label></div>`,
          [{ label: 'Cancelar', value: null }, { label: 'Aplicar', cls: 'pri', collect: bg => [bg.querySelector('#wa').value, bg.querySelector('#wb').value] }]);
        if (!r) return; const a = window.VIGIA_NLP.hms(r[0].trim()), bb = window.VIGIA_NLP.hms(r[1].trim());
        if (a == null || bb == null || bb <= a) return V.toast('Intervalo inválido', 'bad');
        sel.ventana = { modo: 'hms', a, b: bb, texto: 'entre ' + r[0] + ' y ' + r[1] }; renderScope();
      }
    };
    explain();
    async function explain() {
      const el = V.$('#wexp'); if (!el) return; const w = sel.ventana; const cam = cams.find(c => c.id === sel.cameraIds[0]); if (!cam) { el.textContent = 'Cree una cámara en Centro de operaciones para empezar.'; return; }
      const live = V.live.get(cam.id); const recs = await A.api.listRecordings(A.token, cam.id); const r = recs.find(x => x.duracion != null);
      let t = '';
      if (w.modo === 'ahora') t = live ? '«Ahora» = último cuadro realmente recibido por la transmisión ' + (live.tipo === 'emulacion' ? '(EMULACIÓN desde archivo)' : 'en vivo') + ', con su edad en segundos.' : '«Ahora»: esta cámara no tiene transmisión activa; sólo hay grabación histórica' + (r ? '.' : ' (ninguna).');
      else if (w.modo === 'ultimos') t = live ? 'Con transmisión activa se usan los cuadros del búfer (máx. 5 min).' : r ? 'Archivo histórico: «' + w.texto + '» = final de la grabación disponible (' + (r.horaInicio ? V.fmtDateTime(r.horaInicio + Math.max(0, r.duracion - w.segundos) * 1000, cam.tz) + ' → ' + V.fmtTime(r.horaInicio + r.duracion * 1000, cam.tz) : 'pos. ' + V.fmtDur(Math.max(0, r.duracion - w.segundos)) + '–' + V.fmtDur(r.duracion) + ', sin hora de captura') + '). No es transmisión en vivo.' : 'Sin grabaciones ni transmisión para esta cámara.';
      else if (w.modo === 'todo') t = r ? 'Periodo disponible: ' + (r.horaInicio ? V.fmtDateTime(r.horaInicio, cam.tz) + ' → ' + V.fmtTime(r.horaInicio + r.duracion * 1000, cam.tz) : V.fmtDur(r.duracion) + ' (sin hora de captura)') : 'Sin grabaciones.';
      else if (w.modo === 'hms') t = w.texto + ' — interpretación según la grabación (ver respuesta).';
      el.textContent = t;
    }
  }

  // ---------- mensajes ----------
  async function renderMsgs() {
    const box = V.$('#msgs'); if (!box) return;
    const msgs = await A.api.listMessages(A.token, A.chatId);
    if (!msgs.length) {
      box.innerHTML = `<div class="empty" style="margin:auto;max-width:560px"><div style="width:64px;height:64px;margin:0 auto">${I.logo.replace('<svg', '<svg width="64" height="64"')}</div><h2 class="h2" style="margin:8px 0">Pregúntele a VIGÍA</h2>
        <p class="small">Seleccione una cámara o grupo abajo, elija una ventana y escriba su solicitud. Cada respuesta muestra cómo se interpretó, qué evidencia la respalda y qué cobertura falta.</p>
        <p class="small muted">Si aún no tiene video: vaya a <a href="#" data-act="go-ops">Centro de operaciones</a> y cargue el video de demostración o su propio MP4.</p></div>`;
      return;
    }
    box.innerHTML = msgs.map(msgHTML).join('');
    for (const el of V.$$('[data-cards]', box)) { const m = msgs.find(x => x.id === el.dataset.cards); el.innerHTML = await cardsHTML(m); }
    A.hydrate(box);
    box.scrollTop = box.scrollHeight;
  }
  function msgHTML(m) {
    if (m.rol === 'usuario') return `<div class="msg u">${esc(m.texto)}</div>`;
    const p = m.plan;
    return `<div class="msg v"><div class="who">${I.logo.replace('<svg', '<svg width="16" height="16"')} VIGÍA · ${esc(V.fmtTime(m.ts))}</div>
      <div class="txt">${esc(m.texto)}</div>
      ${p ? `<details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">Cómo interpreté la solicitud · confianza ${Math.round(p.confianza * 100)}%</summary>${interpHTML(p, m.id)}</details>` : ''}
      <div class="cards" data-cards="${m.id}"><div class="skel" style="height:40px;border-radius:8px"></div></div></div>`;
  }
  function interpHTML(p, mid) {
    const w = p.ventana;
    const NL = window.VIGIA_NLP;
    return `<div class="interp" data-interp="${mid}">
      <dl><dt>Intención</dt><dd><select data-f="intent">${Object.entries(NL.INTENTS).map(([k, v]) => `<option value="${k}" ${k === p.intent ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></dd>
      <dt>Cámaras</dt><dd>${esc((p.camarasNombres || []).join(', ') || (p.camaras || []).length + ' seleccionada(s)')} <span class="muted">(${esc(p.camarasOrigen || '—')})</span></dd>
      <dt>Ventana</dt><dd>${w ? esc(w.texto || w.modo) : '—'} ${w && w.modo === 'hms' ? `<span class="muted">· ${V.fmtDur(w.a)}–${V.fmtDur(w.b)}</span>` : ''}</dd>
      <dt>Clases</dt><dd>${['persona', 'vehiculo', 'movimiento', 'animal'].map(c => `<label class="check" style="margin-right:8px"><input type="checkbox" data-c="${c}" ${(p.clases || []).includes(c) ? 'checked' : ''}> ${c}</label>`).join('')}</dd>
      ${p.clip ? `<dt>Clip</dt><dd><input type="number" data-f="antes" value="${p.clip.antes != null ? p.clip.antes : ''}" style="width:70px"> s antes · <input type="number" data-f="despues" value="${p.clip.despues != null ? p.clip.despues : ''}" style="width:70px"> s después</dd>` : ''}
      <dt>Supuestos</dt><dd>${(p.supuestos || []).map(esc).join('<br>') || 'ninguno'}</dd>
      ${(p.faltantes || []).length ? `<dt>Faltantes</dt><dd style="color:var(--warn)">${esc(p.faltantes.join(', '))}</dd>` : ''}</dl>
      <button class="btn xs" data-act="reexec" data-m="${mid}">Reejecutar con estos cambios</button> <span class="tiny muted">Las cámaras y la ventana se toman del selector de alcance si las cambia allí.</span></div>`;
  }

  async function send(text) {
    text = String(text || '').trim(); if (!text || S.busy) return;
    if (!A.seleccion.cameraIds.length) { const cams = await A.api.listCameras(A.token); if (cams[0]) A.seleccion.cameraIds = [cams[0].id]; }
    S.busy = true; V.$('#ci').value = ''; V.$('#cs').disabled = true;
    try {
      await A.api.addMessage(A.token, A.chatId, { rol: 'usuario', texto: text });
      await renderMsgs();
      const box = V.$('#msgs'); const th = document.createElement('div'); th.className = 'msg v'; th.innerHTML = '<div class="who"><span class="spin"></span> VIGÍA está consultando la evidencia…</div><div class="prog" style="max-width:320px"><i id="cprog" style="width:5%"></i></div>'; box.appendChild(th); box.scrollTop = box.scrollHeight;
      await execAndSave(text, null);
    } catch (e) { V.fail(e); await A.api.addMessage(A.token, A.chatId, { rol: 'vigia', texto: 'No se pudo completar la solicitud: ' + V.errMsg(e) + '. No se generó evidencia.' }); await renderMsgs(); }
    finally { S.busy = false; const b = V.$('#cs'); if (b) b.disabled = false; loadChats(); }
  }
  async function execAndSave(text, planEditado) {
    const chat = await A.api.getChat(A.token, A.chatId);
    const r = await V.chat.ejecutar(A.api, text, { token: A.token, estado: chat.estado, seleccion: A.seleccion, hallazgoSeleccionado: S.hallazgoSel || null, planEditado, onProgress: p => { const el = V.$('#cprog'); if (el) el.style.width = Math.round(5 + p * 95) + '%'; } });
    const cams = await A.api.listCameras(A.token);
    r.plan.camarasNombres = (r.plan.camaras || []).map(id => { const c = cams.find(x => x.id === id); return c ? 'Cámara ' + c.numero + ' · ' + c.nombre : id; });
    await A.api.addMessage(A.token, A.chatId, { rol: 'vigia', texto: r.texto, plan: r.plan, resultado: { tarjetas: r.tarjetas } });
    await A.api.saveChatState(A.token, A.chatId, r.estado);
    S.hallazgoSel = null;
    await renderMsgs();
    const last = r.tarjetas.find(t => ['fotogramas', 'hallazgos', 'clip', 'fotogramas_vivo', 'vivo'].includes(t.tipo));
    if (last) { S.lastCards = last; if (last.tipo === 'clip') A.ctxTab = 'clips'; else if (last.tipo === 'hallazgos' || last.tipo.startsWith('fotogramas')) A.ctxTab = 'fotogramas'; renderCtx(); }
    if (r.tarjetas.find(t => t.tipo === 'indicadores')) { A.ctxTab = 'indicadores'; renderCtx(); }
  }

  // ---------- tarjetas ----------
  async function cardsHTML(m) {
    const cards = (m.resultado && m.resultado.tarjetas) || [];
    const out = [];
    for (const c of cards) { try { out.push(await card(c)); } catch (e) { out.push('<div class="alert-box bad small">Tarjeta no disponible: ' + esc(e.message) + '</div>'); } }
    return out.join('');
  }
  let camCache = {}; async function cam(id) { if (!camCache[id]) { try { camCache[id] = await A.api.getCamera(A.token, id); } catch (e) { camCache[id] = { numero: '?', nombre: 'no accesible', codigo: '?', tz: 'UTC' }; } } return camCache[id]; }
  let recCache = {}; async function rec(id) { if (!recCache[id] || !recCache[id].indexado) recCache[id] = await A.api.getRecording(A.token, id); return recCache[id]; }
  view.findingCard = findingCard;

  async function findingCard(f, compact) {
    const r = f.recordingId ? await rec(f.recordingId) : null; const c = await cam(f.cameraId);
    const color = A.claseColor(f.clase);
    return `<div class="fcard"><div class="img"><img alt="Miniatura del hallazgo ${esc(f.etiqueta)}" data-media="fotograma:${f.frameId}">${A.bboxHTML(f.bbox, f.etiqueta + ' ' + Math.round(f.score * 100) + '%', color)}
      <div class="ov"><span class="badge">${esc(c.codigo)}</span>${r ? '<span class="badge">HISTÓRICO</span>' : ''}</div></div>
      <div class="meta"><div class="row"><b style="color:${color}">${esc(f.etiqueta)}</b>${A.estadoBadge(f.estado)}</div>
      <div>${r ? A.tiempo(r, f.inicio, c.tz) : ''}</div><div class="muted">Intervalo ${V.fmtDur(f.inicio)}–${V.fmtDur(f.fin)} · ${f.n} muestra(s) · máx. ${Math.round(f.score * 100)}%</div>
      <div class="muted tiny">Motivo: detección «${esc(f.motor)}» · validación: ${f.estado === 'sugerido' ? 'pendiente de revisión humana' : esc(f.estado + ' por ' + (f.revisadoPor || ''))}</div></div>
      <div class="acts"><button class="btn xs" data-act="ver" data-rec="${f.recordingId}" data-t="${f.tMejor}" data-h="${f.id}">${I.play} ver</button><button class="btn xs" data-act="clip-h" data-h="${f.id}">${I.clip} extraer clip</button><button class="btn xs" data-act="caso" data-tipo="hallazgo" data-id="${f.id}">${I.case} añadir al caso</button>
      ${compact ? '' : `<button class="btn xs" data-act="rev" data-h="${f.id}" data-e="revisado" title="Marcar como revisado">✓</button><button class="btn xs" data-act="rev" data-h="${f.id}" data-e="descartado" title="Descartar (falso positivo)">✗</button><button class="btn xs" data-act="rev" data-h="${f.id}" data-e="confirmado" title="Confirmar incidente">‼</button>`}<button class="btn xs ghost" data-act="sel-h" data-h="${f.id}" title="Usar como «este hallazgo» en el chat">usar en chat</button></div></div>`;
  }
  view.frameCard = frameCard;
  async function frameCard(fr, r, c, motivo) {
    return `<div class="fcard"><div class="img"><img alt="Fotograma en ${V.fmtDur(fr.t)}" data-media="fotograma:${fr.id}"><div class="ov"><span class="badge">${esc(c.codigo)}</span><span class="badge">HISTÓRICO</span>${fr.mov > 0.2 ? '<span class="badge">mov.</span>' : ''}</div></div>
      <div class="meta"><div>${A.tiempo(r, fr.t, c.tz)}</div><div class="muted tiny" title="Fuente: ${esc(r.nombreArchivo)} · validación: miniatura del índice (320 px); use «original» para el fotograma auténtico">${esc(motivo || 'muestra del índice')} · miniatura de índice</div></div>
      <div class="acts"><button class="btn xs" data-act="ver" data-rec="${r.id}" data-t="${fr.t}">${I.play} ver</button><button class="btn xs" data-act="clip-t" data-rec="${r.id}" data-t="${fr.t}">${I.clip} extraer clip</button><button class="btn xs" data-act="orig" data-rec="${r.id}" data-t="${fr.t}" title="Extraer el fotograma original a resolución nativa con hash">${I.img} original</button></div></div>`;
  }
  async function derivCard(d) {
    const c = await cam(d.cameraId);
    const vid = d.tipo === 'clip';
    return `<div class="fcard"><div class="img">${vid ? `<video controls preload="metadata" data-media="derivado:${d.id}" aria-label="Clip ${esc(d.nombre)}"></video>` : `<img alt="Fotograma ${esc(d.nombre)}" data-media="derivado:${d.id}">`}<div class="ov"><span class="badge">${esc(c.codigo)}</span>${d.fuente && String(d.fuente).startsWith('vivo') ? '<span class="badge">' + (String(d.fuente).includes('emulacion') ? 'EMULACIÓN' : 'EN VIVO') + '</span>' : d.recordingId ? '<span class="badge">HISTÓRICO</span>' : ''}</div></div>
      <div class="meta"><b>${esc(d.nombre)}</b>
      <div>${d.inicio != null ? 'pos. ' + V.fmtDur(d.inicio, true) + ' → ' + V.fmtDur(d.fin, true) + (d.solicitado ? ' <span class="muted">(pedido ' + V.fmtDur(d.solicitado.inicio) + '–' + V.fmtDur(d.solicitado.fin) + ')</span>' : '') : ''}${d.tAbs ? '<br>' + esc(V.fmtDateTime(d.tAbs, c.tz)) : ''}${d.edadS != null ? ' · edad del cuadro ' + d.edadS.toFixed(1) + ' s' : ''}</div>
      <div class="tiny muted">${esc(d.metodo)}<br>Transformación: ${esc(d.transformacion)}${d.motivo ? '<br>Motivo: ' + esc(d.motivo) : ''}</div>
      <div class="hash" title="SHA-256">SHA-256 ${esc(d.sha256)}</div>${d.origenSha256 ? '<div class="hash">original ' + esc(d.origenSha256.slice(0, 24)) + '…</div>' : ''}</div>
      <div class="acts"><button class="btn xs" data-act="dl" data-id="${d.id}">${I.dl} descargar</button><button class="btn xs" data-act="caso" data-tipo="${d.tipo}" data-id="${d.id}">${I.case} añadir al caso</button><button class="btn xs" data-act="verif" data-id="${d.id}">${I.shield} verificar hash</button>${d.recordingId && d.inicio != null ? `<button class="btn xs" data-act="ver" data-rec="${d.recordingId}" data-t="${d.inicio}">${I.play} en original</button>` : ''}</div></div>`;
  }
  view.derivCard = derivCard;

  async function card(c) {
    switch (c.tipo) {
      case 'fotogramas': {
        const r = await rec(c.recordingId), cm = await cam(c.cameraId);
        const all = await A.api.listFrames(A.token, c.recordingId);
        const fr = c.frames.map(id => all.find(x => x.id === id)).filter(Boolean);
        return `<div class="thumbs">${(await Promise.all(fr.map(f => frameCard(f, r, cm, 'ventana solicitada')))).join('')}</div>${c.recortada ? '<div class="alert-box small">Cobertura incompleta: parte de la ventana pedida no está en la grabación.</div>' : ''}`;
      }
      case 'fotogramas_vivo': { const ds = []; for (const id of c.derivados) { try { ds.push(await A.api.getDerivative(A.token, id)); } catch (_) { } } return '<div class="thumbs">' + (await Promise.all(ds.map(derivCard))).join('') + '</div>'; }
      case 'vivo': {
        const d = await A.api.getDerivative(A.token, c.derivadoId); const cm = await cam(c.cameraId);
        const boxes = (c.dets || []).map(x => A.bboxHTML(x.bbox, V.claseEs(x.clase) + ' ' + Math.round(x.score * 100) + '%', A.claseColor(x.clase))).join('') + (c.mov && c.mov.movimiento && !(c.dets || []).length ? (c.mov.cajas || []).slice(0, 3).map(b => A.bboxHTML(b, 'movimiento', 'var(--c-movimiento)')).join('') : '');
        return `<div class="fcard" style="max-width:560px"><div class="img"><img alt="Último cuadro en vivo" data-media="derivado:${d.id}">${boxes}<div class="ov"><span class="badge">${esc(cm.codigo)}</span><span class="badge">${c.fuente === 'emulacion' ? 'EMULACIÓN DESDE ARCHIVO' : 'EN VIVO'}</span><span class="badge">edad ${c.edadS.toFixed(1)} s</span></div></div>
          <div class="meta"><div>Captura: ${esc(V.fmtDateTime(d.tAbs, cm.tz))} · conexión: <b>${esc(c.estadoConexion)}</b> · búfer: ${c.segmentos} segmento(s) de 10 s</div><div class="hash">SHA-256 ${esc(d.sha256)}</div></div>
          <div class="acts"><button class="btn xs" data-act="ctxclip" data-cam="${c.cameraId}">${I.clip} clip de contexto (búfer)</button><button class="btn xs" data-act="caso" data-tipo="fotograma" data-id="${d.id}">${I.case} añadir al caso</button><button class="btn xs" data-act="dl" data-id="${d.id}">${I.dl} descargar</button></div></div>`;
      }
      case 'vivo_no': return `<div class="alert-box small"><b>Sin transmisión en vivo.</b> ${esc(c.motivo)} ${c.recordingId ? '<button class="btn xs" data-act="ver" data-rec="' + c.recordingId + '" data-t="0">ver grabación histórica</button>' : ''} <button class="btn xs" data-act="go-ops">conectar en Centro de operaciones</button></div>`;
      case 'hallazgos': {
        const items = [];
        for (const id of c.ids.slice(0, 24)) { try { items.push(await A.api.getFinding(A.token, id)); } catch (_) { } }
        const mov = []; for (const id of (c.movimientoAlt || []).slice(0, 12)) { try { mov.push(await A.api.getFinding(A.token, id)); } catch (_) { } }
        const cov = c.cobertura.map(cv => `<li>Cámara ${cv.camara}: ${cv.indexado ? '' : '<b>índice pendiente</b> · '}${V.fmtDur(cv.a)}–${V.fmtDur(cv.b)} ${cv.recortada ? '<span class="badge warn">parcial</span>' : ''} · motores: ${esc((cv.motores || []).join(', ') || 'ninguno')} ${cv.indexado && !cv.soportaClase ? `<span class="badge warn">no clasifica ${esc(c.clases.join('/'))}</span> <button class="btn xs" data-act="reana" data-rec="${cv.recordingId}">analizar con IA local</button>` : ''} <span class="muted">(${esc(cv.interpretacion || '')})</span></li>`).join('');
        return `${items.length ? '<div class="thumbs">' + (await Promise.all(items.map(f => findingCard(f)))).join('') + '</div>' : ''}
          ${mov.length ? '<div class="small tx2" style="margin-top:4px">Movimiento sin clasificar (alternativa limitada):</div><div class="thumbs">' + (await Promise.all(mov.map(f => findingCard(f)))).join('') + '</div>' : ''}
          <details class="small"><summary class="muted" style="cursor:pointer">Cobertura consultada (${c.cobertura.length})</summary><ul>${cov || '<li>Ninguna grabación cubre la ventana.</li>'}</ul></details>`;
      }
      case 'clip': { const d = await A.api.getDerivative(A.token, c.derivadoId); return '<div style="max-width:560px">' + await derivCard(d) + '</div>'; }
      case 'caso': { const { caso, evidencias } = await A.api.getCase(A.token, c.caseId); return `<div class="card row"><div class="grow"><b>${esc(caso.codigo)}</b> · ${esc(caso.titulo)}<div class="small muted">${evidencias.length} evidencia(s) · ${esc(caso.estado)} · aprobación ${esc(caso.aprobacion)}</div></div><button class="btn sm" data-act="open-case" data-id="${caso.id}">${I.case} abrir</button></div>`; }
      case 'informe': return `<div class="card row"><div class="grow"><b>Informe preliminar</b><div class="small muted">Versión registrada con hash en auditoría</div></div><button class="btn sm" data-act="rep-html" data-id="${c.caseId}">Ver HTML</button><button class="btn sm" data-act="rep-pdf" data-id="${c.caseId}">${I.dl} PDF</button></div>`;
      case 'indicadores': { const m = c.m; return `<div class="kpis">${[['Cámaras', m.camaras, m.camarasConectadas + ' conectadas'], ['Archivos procesados', m.archivosProcesados + '/' + m.archivos, m.horasVideo.toFixed(2) + ' h de video'], ['Detecciones', m.detecciones, Object.keys(m.porClase).length + ' clases'], ['Hallazgos revisados', m.revisados, 'de ' + m.hallazgos], ['Incidentes confirmados', m.incidentes, ''], ['Trabajos pendientes', m.trabajos.pendiente + m.trabajos.en_curso, m.trabajos.fallido + ' fallidos']].map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('')}</div>`; }
      case 'camaras': { const cs = await A.api.listCameras(A.token); return '<table class="table"><tr><th>#</th><th>Cámara</th><th>Tipo</th><th>Zona horaria</th><th>Estado</th></tr>' + cs.map(x => { const l = V.live.get(x.id); return `<tr><td>${x.numero}</td><td>${esc(x.nombre)}<div class="tiny muted">${esc([x.sede, x.zona, x.ubicacion].filter(Boolean).join(' · '))}</div></td><td>${esc(x.tipo)}</td><td>${esc(x.tz)}</td><td>${l ? '<span class="badge ok">' + esc(l.estado) + ' · ' + esc(l.tipo) + '</span>' : '<span class="badge">sin transmisión</span>'} · ${x.grabaciones} grabación(es)</td></tr>`; }).join('') + '</table>'; }
      case 'regla_preview': { const cm = await cam(c.cameraId); return `<div class="card"><b>Regla propuesta</b><div class="small" style="margin:6px 0">Si <b>${esc(c.clase)}</b> en <b>Cámara ${cm.numero} · ${esc(cm.nombre)}</b> → alerta interna a <b>${esc(c.destinatario)}</b> · vigencia <b>${c.duracionMin} min</b> · cooldown 30 s.</div>${c.advertencia ? '<div class="alert-box small">El motor IA no está cargado.</div>' : ''}<div class="row" style="margin-top:8px"><button class="btn sm pri" data-act="regla-ok" data-r="${esc(JSON.stringify(c))}">Confirmar y activar</button><span class="tiny muted">La activación queda auditada. No se envía nada fuera de la aplicación.</span></div></div>`; }
      case 'aclaracion': return `<div class="card"><b class="small">${esc(c.pregunta)}</b><div class="row" style="margin-top:6px">${c.opciones.map(o => `<button class="chip" data-act="aclarar" data-cams="${esc(JSON.stringify(o.cameraIds || [o.cameraId]))}">${esc(o.etiqueta)}</button>`).join('')}</div></div>`;
      case 'pendiente': return '<div class="alert-box info small">Índice pendiente: el trabajo de indexación está en curso. Vea el progreso en Centro de operaciones.</div>';
      case 'sin_cobertura': return '<div class="alert-box small">Sin cobertura para la ventana solicitada.</div>';
      case 'ayuda': return `<div class="card small"><b>Ejemplos</b><ul style="margin:6px 0 0 0;padding-left:18px">${SUGS.map(s => '<li>' + esc(s) + '</li>').join('')}<li>Busca movimiento en cámaras 1 y 2 durante la última hora</li><li>Avísame si aparece una persona en la cámara 1 durante 30 minutos</li><li>Resume el caso EXP-2026-0001 · Genera el informe del caso</li></ul></div>`;
      default: return '';
    }
  }

  // ---------- acciones ----------
  async function onAction(e) {
    const b = e.target.closest('[data-act]'); if (!b) return; const d = b.dataset;
    if (b.tagName === 'A') e.preventDefault();
    try {
      switch (d.act) {
        case 'go-ops': A.go('ops'); break;
        case 'ver': openPlayer(d.rec, +d.t, d.h); break;
        case 'sel-h': S.hallazgoSel = d.h; V.toast('Hallazgo seleccionado: «este hallazgo» se referirá a él.'); V.$('#ci').focus(); break;
        case 'clip-h': {
          const f = await A.api.getFinding(A.token, d.h);
          const r = await V.modal('Extraer clip del hallazgo', `<p class="small tx2">Hallazgo ${esc(f.etiqueta)} ${V.fmtDur(f.inicio)}–${V.fmtDur(f.fin)}. El clip MP4 se corta sin recodificar y empieza en el fotograma clave anterior.</p><div class="row"><label class="f">Segundos antes<input type="number" id="ca" value="10" min="0" max="300"></label><label class="f">Segundos después<input type="number" id="cd" value="20" min="0" max="300"></label></div>`, [{ label: 'Cancelar', value: null }, { label: 'Extraer', cls: 'pri', collect: bg => [+bg.querySelector('#ca').value, +bg.querySelector('#cd').value] }]);
          if (!r) return; S.hallazgoSel = f.id;
          await sendText('Extrae un clip desde ' + r[0] + ' segundos antes hasta ' + r[1] + ' segundos después de este hallazgo'); break;
        }
        case 'clip-t': { const t = +d.t; await doClip(d.rec, t - 10, t + 20, 'Alrededor del fotograma ' + V.fmtDur(t)); break; }
        case 'orig': { b.disabled = true; b.innerHTML = '<span class="spin"></span>'; const der = await V.media.extractFrame(A.api, A.token, d.rec, +d.t); V.toast('Fotograma original extraído (' + der.ancho + '×' + der.alto + ', SHA-256 ' + der.sha256.slice(0, 12) + '…)'); A.ctxTab = 'clips'; renderCtx(); b.disabled = false; b.innerHTML = I.img + ' original'; break; }
        case 'caso': await A.addToCase(d.tipo, d.id); break;
        case 'dl': await A.download('derivado', d.id); break;
        case 'verif': { const r = await A.api.verifyDerivative(A.token, d.id); V.toast(r.ok ? '✓ Integridad verificada: el hash coincide' + (r.origenCoincide === false ? ' (pero el original no coincide)' : '') : '✗ El hash NO coincide', r.ok ? '' : 'bad'); break; }
        case 'rev': { await A.api.reviewFinding(A.token, d.h, d.e); V.toast('Hallazgo marcado como ' + d.e); await renderMsgs(); break; }
        case 'reana': { await A.api.requeueAnalysis(A.token, d.rec, { ia: true }); if (V.ia.estado !== 'listo') { V.toast('Cargando motor IA local…'); V.ia.cargar().then(() => V.worker.kick()).catch(V.fail); } V.toast('Reanálisis encolado. Vea el progreso en Centro de operaciones.'); break; }
        case 'reexec': {
          const msgs = await A.api.listMessages(A.token, A.chatId); const m = msgs.find(x => x.id === d.m); const box = b.closest('[data-interp]');
          const p = JSON.parse(JSON.stringify(m.plan)); p.intent = box.querySelector('[data-f=intent]').value;
          p.clases = V.$$('[data-c]', box).filter(x => x.checked).map(x => x.dataset.c);
          if (p.clip) { const a = box.querySelector('[data-f=antes]').value, dd = box.querySelector('[data-f=despues]').value; p.clip.antes = a === '' ? null : +a; p.clip.despues = dd === '' ? null : +dd; }
          p.camaras = A.seleccion.cameraIds.slice(); p.camarasOrigen = 'seleccion (editado)'; p.faltantes = []; if (!p.ventana || p.editVentana) p.ventana = A.seleccion.ventana;
          p.supuestos = (p.supuestos || []).concat(['Plan editado manualmente por el usuario.']);
          const u = msgs.filter(x => x.rol === 'usuario' && x.ts <= m.ts).pop();
          await A.api.addMessage(A.token, A.chatId, { rol: 'usuario', texto: '(reejecución editada) ' + (u ? u.texto : '') });
          await execAndSave(u ? u.texto : '', p); break;
        }
        case 'regla-ok': {
          const c = JSON.parse(d.r);
          if (!await V.confirmar('Activar regla temporal', 'Se evaluará sobre la transmisión activa de la cámara durante ' + c.duracionMin + ' min y generará alertas internas. ¿Confirmar?', 'Activar')) return;
          await A.api.createRule(A.token, { cameraId: c.cameraId, clase: c.clase, duracionMin: c.duracionMin, destinatario: c.destinatario, confirmado: true });
          V.toast('Regla activada y registrada en auditoría'); b.disabled = true; b.textContent = 'Activada'; break;
        }
        case 'aclarar': { A.seleccion.cameraIds = JSON.parse(d.cams); A.seleccion.grupo = null; await renderScope(); const msgs = await A.api.listMessages(A.token, A.chatId); const u = msgs.filter(x => x.rol === 'usuario').pop(); if (u) await sendText(u.texto); break; }
        case 'open-case': A.go('expedientes', d.id); break;
        case 'rep-html': { const r = await V.reports.generar(A.api, A.token, d.id); const w = window.open(URL.createObjectURL(new Blob([r.html], { type: 'text/html' })), '_blank'); if (!w) V.downloadBlob(new Blob([r.html], { type: 'text/html' }), 'informe.html'); break; }
        case 'rep-pdf': { const r = await V.reports.pdf(A.api, A.token, d.id); V.downloadBlob(r.blob, r.nombre); V.toast('PDF generado · SHA-256 ' + r.sha256.slice(0, 16) + '…'); break; }
        case 'ctxclip': { const cm = await A.api.getCamera(A.token, d.cam); const der = await V.live.contextClip(A.token, cm); V.toast('Clip de contexto guardado (' + V.fmtBytes(der.size) + ')'); A.ctxTab = 'clips'; renderCtx(); break; }
        case 'tab': A.ctxTab = d.tab; renderCtx(); break;
        case 'mark-in': S.player.in = V.$('#pv').currentTime; renderPlayerMarks(); break;
        case 'mark-out': S.player.out = V.$('#pv').currentTime; renderPlayerMarks(); break;
        case 'pclip': { const p = S.player; if (p.in == null || p.out == null || p.out <= p.in) return V.toast('Marque inicio y fin (fin > inicio)', 'warn'); await doClip(p.recId, p.in, p.out, 'Selección manual en el reproductor'); break; }
        case 'porig': { const t = V.$('#pv').currentTime; const der = await V.media.extractFrame(A.api, A.token, S.player.recId, t); V.toast('Fotograma original ' + V.fmtDur(t, true) + ' · SHA-256 ' + der.sha256.slice(0, 12) + '…'); break; }
        case 'pvhash': { b.innerHTML = '<span class="spin"></span> verificando…'; const r = await A.api.verifyRecording(A.token, S.player.recId); b.innerHTML = r.ok ? '✓ original íntegro' : '✗ hash no coincide'; break; }
        case 'pdl': await A.download('original', S.player.recId); break;
      }
    } catch (err) { V.fail(err); }
  }
  async function sendText(t) { V.$('#ci').value = t; await send(t); }
  async function doClip(recId, a, b, motivo) {
    V.toast('Extrayendo clip…');
    const r = await rec(recId);
    const der = await V.media.makeClip(A.api, A.token, recId, a, b, { motivo, cameraId: r.cameraId });
    await A.api.addMessage(A.token, A.chatId, { rol: 'vigia', texto: 'Clip creado desde el panel: ' + V.fmtDur(der.inicio, true) + ' → ' + V.fmtDur(der.fin, true) + ' de «' + r.nombreArchivo + '». ' + der.transformacion + '. SHA-256 ' + der.sha256.slice(0, 16) + '…', resultado: { tarjetas: [{ tipo: 'clip', derivadoId: der.id }] } });
    const ch = await A.api.getChat(A.token, A.chatId); await A.api.saveChatState(A.token, A.chatId, Object.assign({}, ch.estado, { ultimoClipId: der.id }));
    await renderMsgs(); A.ctxTab = 'clips'; renderCtx();
  }

  // ---------- panel contextual ----------
  const TABS = [['reproductor', 'Reproductor'], ['fotogramas', 'Fotogramas'], ['clips', 'Clips'], ['linea', 'Línea de tiempo'], ['indicadores', 'Indicadores']];
  function openPlayer(recId, t, hid) { S.player = { recId, t: t || 0, hid, in: null, out: null }; A.ctxTab = 'reproductor'; V.$('#ctx').classList.add('open'); renderCtx(); }
  view.openPlayer = openPlayer;
  /** Limpia todo estado de la vista al cerrar sesión (evita mostrar datos de la sesión anterior). */
  view.reset = () => { S.lastCards = null; S.player = null; S.hallazgoSel = null; S.busy = false; camCache = {}; recCache = {}; };
  view.selectFinding = id => { S.hallazgoSel = id; };
  async function renderCtx() {
    const tabs = V.$('#ctabs'), body = V.$('#cbody'); if (!tabs) return;
    tabs.innerHTML = TABS.map(([k, l]) => `<button role="tab" aria-selected="${A.ctxTab === k}" class="${A.ctxTab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('');
    tabs.onclick = onAction;
    const camId = A.seleccion.cameraIds[0];
    try {
      if (A.ctxTab === 'reproductor') {
        if (!S.player) { const recs = camId ? await A.api.listRecordings(A.token, camId) : []; if (recs[0]) S.player = { recId: recs[0].id, t: 0 }; }
        if (!S.player) { body.innerHTML = '<div class="empty">Sin grabaciones para la cámara seleccionada. Cargue un video en Centro de operaciones.</div>'; return; }
        await renderPlayer(body);
      } else if (A.ctxTab === 'fotogramas') {
        const c = S.lastCards;
        if (!c) { body.innerHTML = '<div class="empty">Los fotogramas y hallazgos de la última respuesta aparecerán aquí en cuadrícula.</div>'; return; }
        body.innerHTML = await card(c.tipo === 'clip' ? { tipo: 'clip', derivadoId: c.derivadoId } : c); A.hydrate(body);
      } else if (A.ctxTab === 'clips') {
        const ds = (await A.api.listDerivatives(A.token)).slice(0, 30);
        body.innerHTML = ds.length ? '<div class="thumbs" style="grid-template-columns:1fr">' + (await Promise.all(ds.map(derivCard))).join('') + '</div>' : '<div class="empty">Aún no hay clips ni fotogramas exportados.</div>'; A.hydrate(body);
      } else if (A.ctxTab === 'linea') {
        body.innerHTML = await timelineAll();
      } else if (A.ctxTab === 'indicadores') {
        const m = await A.api.metrics(A.token); body.innerHTML = await card({ tipo: 'indicadores', m }) + '<p class="small muted" style="margin-top:10px">Valores calculados en este instante a partir de los registros de su organización. Vea más en Indicadores.</p>';
      }
    } catch (e) { body.innerHTML = '<div class="alert-box bad">' + esc(V.errMsg(e)) + '</div>'; }
  }
  view.renderCtx = renderCtx;

  async function renderPlayer(body) {
    const p = S.player; const r = await rec(p.recId); const c = await cam(r.cameraId);
    const recs = await A.api.listRecordings(A.token, r.cameraId);
    const finds = await A.api.listFindings(A.token, { recordingId: r.id });
    body.innerHTML = `<div class="row" style="margin-bottom:8px"><select id="prs" class="grow" aria-label="Grabación">${recs.map(x => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${esc(x.nombreArchivo)} · ${V.fmtDur(x.duracion)}</option>`).join('')}</select><span class="badge">HISTÓRICO</span></div>
      <div class="player"><video id="pv" controls preload="auto" data-media="original:${r.id}" aria-label="Reproductor de ${esc(r.nombreArchivo)}"></video></div>
      <div class="row small" style="margin-top:6px"><b id="pclock">—</b><span class="muted" id="ppos"></span></div>
      <div class="tl" id="ptl" title="Clic para saltar">${tlMarks(finds, r)}<div class="ph" id="pph"></div></div>
      <div class="legend" style="margin-top:6px"><span><i style="background:var(--c-persona)"></i>persona</span><span><i style="background:var(--c-vehiculo)"></i>vehículo</span><span><i style="background:var(--c-animal)"></i>animal</span><span><i style="background:var(--c-movimiento)"></i>movimiento (fila inferior)</span><span><i style="background:var(--acc)"></i>cobertura indexada</span></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-act="mark-in">[ inicio</button><button class="btn sm" data-act="mark-out">fin ]</button><span class="small" id="pmarks">—</span><button class="btn sm pri" data-act="pclip">${I.clip} extraer clip</button><button class="btn sm" data-act="porig">${I.img} fotograma original</button></div>
      <div class="card small" style="margin-top:12px"><b>Cadena de custodia del original</b>
        <div class="col" style="gap:3px;margin-top:6px"><div>Archivo: ${esc(r.nombreArchivo)} · ${V.fmtBytes(r.size)} · ${esc(r.codec || '')} ${r.ancho}×${r.alto} ${r.fps ? '@ ' + r.fps + ' fps' : ''} ${r.audio ? '· audio ' + esc(r.audio) : ''}</div>
        <div>Hora de inicio: ${r.horaInicio ? esc(V.fmtDateTime(r.horaInicio, c.tz)) + ' <span class="badge">' + esc(r.horaInicioFuente) + '</span>' : '<span class="badge warn">desconocida (no se deduce de la carga)</span>'}</div>
        <div>Importado por ${esc(r.subidoPorEmail)} el ${esc(V.fmtDateTime(r.importadoEn, c.tz))} · fuente declarada: ${esc(r.fuenteDeclarada || '—')}</div>
        <div class="hash">SHA-256 ${esc(r.sha256)}</div>
        <div class="row" style="margin-top:4px"><button class="btn xs" data-act="pvhash">${I.shield} verificar integridad</button><button class="btn xs" data-act="pdl">${I.dl} descargar original</button><span class="tiny muted">motores: ${esc((r.motores || []).join(', ') || '—')}</span></div></div></div>`;
    A.hydrate(body);
    const v = V.$('#pv');
    v.addEventListener('loadedmetadata', () => { v.currentTime = p.t || 0; }, { once: true });
    const upd = () => { const t = v.currentTime; V.$('#pclock').innerHTML = r.horaInicio ? esc(V.fmtDateTime(r.horaInicio + t * 1000, c.tz)) : 'sin hora de captura'; V.$('#ppos').textContent = 'pos. ' + V.fmtDur(t, true) + ' / ' + V.fmtDur(r.duracion); V.$('#pph').style.left = (t / r.duracion * 100) + '%'; };
    v.addEventListener('timeupdate', upd); v.addEventListener('seeked', upd);
    V.$('#ptl').onclick = e => { if (e.target.closest('[data-act]')) return; const rc = e.currentTarget.getBoundingClientRect(); v.currentTime = (e.clientX - rc.left) / rc.width * r.duracion; };
    V.$('#prs').onchange = e => { S.player = { recId: e.target.value, t: 0 }; renderCtx(); };
    renderPlayerMarks();
  }
  function renderPlayerMarks() { const p = S.player, el = V.$('#pmarks'); if (el) el.textContent = (p.in != null ? V.fmtDur(p.in, true) : '—') + ' → ' + (p.out != null ? V.fmtDur(p.out, true) : '—'); }
  function tlMarks(finds, r) {
    const D = r.duracion || 1;
    return (r.indexado ? '<div class="cov" style="left:0;width:100%"></div>' : '') + finds.map(f => { const mov = f.clase === 'movimiento'; return `<div class="mk ${mov ? 'mov' : ''}" style="left:${f.inicio / D * 100}%;width:${Math.max(0.4, (f.fin - f.inicio + 1) / D * 100)}%;background:${A.claseColor(f.clase)}" title="${esc(f.etiqueta)} ${V.fmtDur(f.inicio)}–${V.fmtDur(f.fin)} (${Math.round(f.score * 100)}%)"></div>`; }).join('') + [0, 0.25, 0.5, 0.75].map(x => `<span class="lab" style="left:${x * 100 + 0.5}%">${V.fmtDur(x * D)}</span>`).join('');
  }
  async function timelineAll() {
    const cams = await A.api.listCameras(A.token); const out = [];
    for (const c of cams) {
      const recs = await A.api.listRecordings(A.token, c.id);
      for (const r of recs) {
        const finds = await A.api.listFindings(A.token, { recordingId: r.id });
        out.push(`<div style="margin-bottom:14px"><div class="small"><b>Cámara ${c.numero}</b> · ${esc(r.nombreArchivo)} · ${r.horaInicio ? esc(V.fmtDateTime(r.horaInicio, c.tz)) + ' → ' + esc(V.fmtTime(r.horaInicio + (r.duracion || 0) * 1000, c.tz)) : 'sin hora de captura'} ${r.indexado ? '' : '<span class="badge warn">índice pendiente</span>'}</div><div class="tl" data-act="ver" data-rec="${r.id}" data-t="0">${r.duracion ? tlMarks(finds, r) : ''}</div></div>`);
      }
      const l = V.live.get(c.id); if (l) out.push(`<div class="small" style="margin-bottom:14px"><b>Cámara ${c.numero}</b> · transmisión ${esc(l.tipo)}: búfer de ${l.ring.length} s (${l.ring[0] ? esc(V.fmtTime(l.ring[0].ts, c.tz)) + ' → ahora' : 'vacío'})</div>`);
    }
    return !out.length ? '<div class="empty">Sin grabaciones ni transmisiones.</div>' : out.join('') + '<div class="legend"><span><i style="background:var(--c-persona)"></i>persona</span><span><i style="background:var(--c-vehiculo)"></i>vehículo</span><span><i style="background:var(--c-animal)"></i>animal</span><span><i style="background:var(--c-movimiento)"></i>movimiento</span></div>';
  }
})();
