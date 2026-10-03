/* VIGÍA · ui-core.js — arranque, sesión, navegación, componentes comunes */
(function () {
  'use strict';
  const V = window.V; const esc = V.esc;
  const A = V.app = { view: 'chat', seleccion: { cameraIds: [], ventana: { modo: 'ultimos', segundos: 300, texto: 'últimos 5 min' } }, ctxTab: 'reproductor', urlCache: new Map() };

  // ---------- iconos (SVG en línea, sin dependencias) ----------
  const I = V.icons = {};
  const ic = (p, vb) => '<svg viewBox="' + (vb || '0 0 24 24') + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  Object.assign(I, {
    logo: '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#19c2ad"/><stop offset="1" stop-color="#3987e5"/></linearGradient></defs><path d="M3 20C8 11 13.5 7 20 7s12 4 17 13c-5 9-10.5 13-17 13S8 29 3 20Z" fill="none" stroke="url(#lg)" stroke-width="3"/><circle cx="20" cy="20" r="6.5" fill="url(#lg)"/><circle cx="22" cy="18" r="2" fill="#0c0f13"/></svg>',
    ops: ic('<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>'),
    chat: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/>'),
    find: ic('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="M8.5 11h5M11 8.5v5"/>'),
    case: ic('<path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 12h16"/>'),
    kpi: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    admin: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    bell: ic('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
    send: ic('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>'),
    play: ic('<path d="m6 4 14 8-14 8V4Z"/>'),
    clip: ic('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    img: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
    dl: ic('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>'),
    up: ic('<path d="M12 21V9m0 0-4 4m4-4 4 4M4 7V4h16v3"/>'),
    live: ic('<circle cx="12" cy="12" r="2.5"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>'),
    shield: ic('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
    x: ic('<path d="M18 6 6 18M6 6l12 12"/>'),
    menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    out: ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    check: ic('<path d="m5 12 5 5L20 7"/>'),
    panel: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>'),
    map: ic('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
    cpu: ic('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>')
  });

  // ---------- notificaciones ----------
  V.toast = function (msg, kind, ms) {
    let box = V.$('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), ms || 5000);
    return t;
  };
  V.errMsg = e => (e && e.code ? '[' + e.code + '] ' : '') + (e && e.message ? e.message : String(e));
  V.fail = e => { console.error(e); V.toast(V.errMsg(e), 'bad', 8000); };

  V.modal = function (title, bodyHTML, buttons, opts) {
    return new Promise(resolve => {
      const bg = document.createElement('div'); bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '" style="' + (opts && opts.wide ? 'width:min(980px,100%)' : '') + '"><div class="mh"><b class="grow">' + esc(title) + '</b><button class="btn ghost sm" data-x aria-label="Cerrar">' + I.x + '</button></div><div class="mb">' + bodyHTML + '</div>' + (buttons && buttons.length ? '<div class="mf">' + buttons.map((b, i) => '<button class="btn ' + (b.cls || '') + '" data-b="' + i + '">' + esc(b.label) + '</button>').join('') + '</div>' : '') + '</div>';
      document.body.appendChild(bg);
      const close = v => { bg.remove(); document.removeEventListener('keydown', kd); resolve(v); };
      const kd = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', kd);
      bg.addEventListener('click', e => {
        if (e.target === bg || e.target.closest('[data-x]')) return close(null);
        const b = e.target.closest('[data-b]'); if (b) { const def = buttons[+b.dataset.b]; const val = def.value !== undefined ? def.value : (def.collect ? def.collect(bg) : true); if (def.validate && !def.validate(bg)) return; close(val); }
      });
      if (opts && opts.onOpen) opts.onOpen(bg);
      const f = bg.querySelector('input,select,textarea,button.pri'); if (f) f.focus();
    });
  };
  V.confirmar = (title, text, okLabel) => V.modal(title, '<p>' + esc(text) + '</p>', [{ label: 'Cancelar', value: false }, { label: okLabel || 'Confirmar', cls: 'pri', value: true }]);

  // ---------- medios autorizados (URL con caducidad) ----------
  A.mediaURL = async function (kind, id, motivo) {
    const k = kind + ':' + id + ':' + (motivo || 'ver');
    const c = A.urlCache.get(k); if (c && c.exp > Date.now() + 5000) return c.url;
    const r = await A.api.mediaURL(A.token, kind, id, motivo); A.urlCache.set(k, r); return r.url;
  };
  /** Carga imágenes/video marcados con data-media="kind:id" dentro de un contenedor. */
  A.hydrate = function (root) {
    V.$$('[data-media]', root || document).forEach(async el => {
      if (el.dataset.loaded) return; el.dataset.loaded = '1';
      const [kind, id] = el.dataset.media.split(':');
      try { el.src = await A.mediaURL(kind, id); }
      catch (e) { el.replaceWith(Object.assign(document.createElement('div'), { className: 'muted small', style: 'padding:12px', textContent: 'Sin acceso: ' + e.message })); }
    });
  };
  A.download = async function (kind, id) {
    try { const r = await A.api.mediaURL(A.token, kind, id, 'descargar'); await V.downloadBlob(r.blob, r.name); V.toast('Descarga registrada en auditoría: ' + r.name); }
    catch (e) { V.fail(e); }
  };

  // ---------- arranque ----------
  A.boot = async function () {
    try { const th = localStorage.getItem('vigia.tema'); if (th) document.documentElement.dataset.theme = th; } catch (_) { }
    const db = await new V.DB(A.dbName || 'vigia_v1').open();
    A.api = new V.Api(db);
    V.worker.start(A.api);
    try { const t = sessionStorage.getItem('vigia.token'); if (t) sessionStorage.removeItem('vigia.token'); } catch (_) { }
    if (!db.persistente) V.toast('Aviso: el navegador no permite almacenamiento persistente (' + db.motivoMemoria + '). Los datos se perderán al cerrar.', 'warn', 12000);
    V.on('jobs:changed', () => A.onData('jobs'));
    V.on('data:changed', () => A.onData('data'));
    V.on('live:changed', () => A.onData('live'));
    V.on('alerts:new', a => { if (A.session && a.org === A.session.org) { V.toast('⚠ ALERTA: ' + a.clase + ' detectado (regla temporal). Revise Centro de operaciones.', 'warn', 10000); A.renderTop(); } });
    V.on('ia:estado', () => A.renderTop());
    try { if (localStorage.getItem('vigia.ia.auto') === '1') V.ia.cargar().catch(() => { }); } catch (_) { }
    A.renderLogin();
  };
  let dataTimer = null;
  A.onData = function (what) {
    if (!A.session) return;
    clearTimeout(dataTimer);
    dataTimer = setTimeout(() => { A.renderTop(); if (A.views[A.view] && A.views[A.view].onData) A.views[A.view].onData(what); }, what === 'jobs' ? 250 : 120);
  };

  // ---------- inicio de sesión ----------
  A.renderLogin = async function (msg) {
    const hasData = await A.api.hasData();
    document.body.innerHTML = `<main class="login"><div class="login-card">
      <div class="brand">${I.logo}<span>VIGÍA</span></div>
      <p class="tx2" style="margin:6px 0 18px">Plataforma de monitoreo y análisis de video · ejecución 100% local en este navegador.</p>
      ${hasData ? '' : `<div class="alert-box info" style="margin-bottom:14px">Primera ejecución: no hay organizaciones. Cree el entorno de demostración (2 organizaciones y 8 usuarios con contraseñas aleatorias que se mostrarán UNA sola vez).</div>
      <button class="btn pri" id="boot" style="width:100%;justify-content:center">Crear entorno de demostración</button>`}
      <form id="lf" class="col ${hasData ? '' : 'hidden'}" autocomplete="on">
        <label class="f">Correo<input type="email" id="le" required autocomplete="username" placeholder="admin@norte.demo"></label>
        <label class="f">Contraseña<input type="password" id="lp" required autocomplete="current-password"></label>
        <div id="orgpick"></div>
        <div id="lerr" class="small" style="color:var(--bad);min-height:18px">${esc(msg || '')}</div>
        <button class="btn pri" style="justify-content:center">Ingresar</button>
      </form>
      ${hasData ? '<button type="button" class="btn sm" id="regen" style="width:100%;justify-content:center;margin-top:12px">¿No tiene las contraseñas? Generar usuarios nuevos</button><div class="tiny muted" style="margin-top:4px">Las contraseñas no se pueden recuperar (sólo se guarda su hash). Generar usuarios nuevos borra los datos de VIGÍA en este navegador y muestra credenciales nuevas.</div>' : ''}
      <details style="margin-top:18px" class="small muted"><summary>Opciones</summary>
        <p>Los datos (videos, índices, expedientes) se guardan sólo en este navegador (IndexedDB). No se envía nada a Internet.</p>
        <button class="btn sm danger" id="reset">Borrar TODOS los datos locales de VIGÍA</button></details>
    </div></main>`;
    const q = s => V.$(s);
    if (q('#boot')) q('#boot').onclick = async () => {
      q('#boot').disabled = true; q('#boot').innerHTML = '<span class="spin"></span> Generando credenciales seguras…';
      try {
        const { creds } = await A.api.bootstrapDemo();
        const txt = 'VIGÍA — credenciales de demostración (generadas ' + new Date().toISOString() + ')\nNO son credenciales de producción.\n\n' + creds.map(c => c.email + '\t' + c.password + '\t' + c.roles).join('\n');
        await V.modal('Credenciales de demostración (se muestran una sola vez)', `<div class="alert-box">Guárdelas ahora. Se almacenan únicamente como hash PBKDF2-SHA-256 y no pueden recuperarse. Para restablecer, borre los datos locales.</div>
          <table class="creds"><tr><th>Usuario</th><th>Rol</th><th>Contraseña</th></tr>${creds.map(c => `<tr><td>${esc(c.email)}</td><td>${esc(c.roles)}</td><td>${esc(c.password)}</td></tr>`).join('')}</table>
          <div class="row"><button class="btn sm" id="dlc">${I.dl} Descargar .txt</button><button class="btn sm" id="cpc">Copiar</button></div>`, [{ label: 'Ya las guardé', cls: 'pri' }], {
          wide: true, onOpen: bg => {
            bg.querySelector('#dlc').onclick = () => V.downloadBlob(new Blob([txt], { type: 'text/plain' }), 'vigia_credenciales_demo.txt');
            bg.querySelector('#cpc').onclick = () => navigator.clipboard.writeText(txt).then(() => V.toast('Copiadas'), () => V.toast('No se pudo copiar', 'warn'));
          }
        });
        A._demoCreds = creds; // sólo en memoria de esta pestaña, para autocompletar
        A.renderLogin();
      } catch (e) { V.fail(e); A.renderLogin(); }
    };
    if (q('#regen')) q('#regen').onclick = () => q('#reset').click();
    q('#reset').onclick = async () => {
      if (!await V.confirmar('Borrar datos locales', 'Se eliminarán organizaciones, usuarios, videos, índices, expedientes y auditoría de este navegador. No se puede deshacer.', 'Borrar todo')) return;
      V.live.stopAll(); await A.api.db.destroy(); location.reload();
    };
    if (A._demoCreds && q('#lf')) {
      const box = document.createElement('div'); box.className = 'small';
      box.innerHTML = '<div class="muted" style="margin:10px 0 4px">Acceso rápido (sólo en esta pestaña):</div><div class="row">' + A._demoCreds.map((c, i) => '<button type="button" class="chip" data-i="' + i + '">' + esc(c.email) + '</button>').join('') + '</div>';
      q('#lf').appendChild(box);
      box.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const c = A._demoCreds[+b.dataset.i]; q('#le').value = c.email; q('#lp').value = c.password; };
    }
    if (q('#lf')) q('#lf').onsubmit = async e => {
      e.preventDefault(); q('#lerr').textContent = '';
      const org = V.$('input[name=org]:checked');
      try {
        const r = await A.api.login(q('#le').value, q('#lp').value, org ? org.value : null);
        if (r.requiereOrganizacion) {
          q('#orgpick').innerHTML = '<fieldset class="col" style="border:1px solid var(--line2);border-radius:8px;padding:10px"><legend class="small tx2">Seleccione la organización</legend>' + r.orgs.map((o, i) => '<label class="check"><input type="radio" name="org" value="' + o.id + '" ' + (i ? '' : 'checked') + '> ' + esc(o.nombre) + ' <span class="badge">' + esc(o.rolNombre) + '</span></label>').join('') + '</fieldset>';
          return;
        }
        A.token = r.token; A.session = r.session; A.start();
      } catch (err) { q('#lerr').textContent = V.errMsg(err); }
    };
  };

  A.logout = async function () { V.live.stopAll(); if (V.cloud && V.cloud.user) await V.cloud.salir().catch(() => { }); if (A.views.chat.reset) A.views.chat.reset(); A.seleccion = { cameraIds: [], ventana: { modo: 'ultimos', segundos: 300, texto: 'últimos 5 min' } }; A.ctxTab = 'reproductor'; if (A.views.expedientes) A.views.expedientes.sel = null; if (A.views.hallazgos) A.views.hallazgos.f = { estado: '', cameraId: '', clase: '' }; await A.api.logout(A.token); A.token = null; A.session = null; A.urlCache.clear(); A.chatId = null; A.renderLogin(); };

  // ---------- shell ----------
  const NAV = [['ops', 'Centro de operaciones', 'ops'], ['alarmas', 'Central de alarmas', 'bell'], ['plano', 'Plano del sitio', 'map'], ['chat', 'Chat', 'chat'], ['analitica', 'Analítica y casos de uso', 'kpi'], ['hallazgos', 'Hallazgos', 'find'], ['expedientes', 'Expedientes', 'case'], ['indicadores', 'Indicadores', 'kpi'], ['admin', 'Administración', 'admin']];
  A.views = {};
  A.start = function () {
    document.body.innerHTML = `<div class="shell"><header class="top" id="top"></header>
      <nav class="nav" id="nav" aria-label="Navegación principal">${NAV.map(([k, l, i]) => `<button data-nav="${k}">${I[i]}<span>${l}</span></button>`).join('')}
      <div class="sep"></div><div class="small muted" style="padding:6px 12px">${esc(A.session.orgNombre)}<br>${esc(A.session.rolNombre)}</div></nav>
      <main class="main" id="main"></main></div>`;
    V.$('#nav').onclick = e => { const b = e.target.closest('[data-nav]'); if (b) { A.go(b.dataset.nav); V.$('#nav').classList.remove('open'); } };
    A.seleccion.cameraIds = [];
    A.go(A.session.rol === 'directivo' ? 'indicadores' : 'chat');
  };
  A.go = function (view, arg) {
    A.view = view;
    V.$$('#nav [data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === view));
    A.renderTop();
    const m = V.$('#main'); m.innerHTML = '';
    const v = A.views[view]; if (v) Promise.resolve().then(() => v.render(m, arg)).catch(V.fail);
  };
  A.renderTop = async function () {
    const top = V.$('#top'); if (!top || !A.session) return;
    let alertas = 0, jobs = 0;
    try { alertas = (await A.api.listAlerts(A.token)).filter(a => a.estado === 'nueva').length; jobs = (await A.api.listJobs(A.token)).filter(j => j.estado === 'pendiente' || j.estado === 'en_curso').length; } catch (_) { }
    const ia = V.ia.estado;
    top.innerHTML = `<button class="btn ghost sm menu-btn" id="mb" aria-label="Menú">${I.menu}</button>
      <div class="brand" style="font-size:15px">${I.logo.replace('width:34px', '')}<span>VIGÍA</span></div>
      <span class="badge hide-sm">${esc(A.session.orgNombre)}</span>
      <div class="right row">
        ${jobs ? `<span class="pill" data-go="ops" title="Trabajos de indexación en curso"><span class="spin"></span> ${jobs} trabajo(s)</span>` : ''}
        <span class="pill hide-sm" data-go="admin:ia" title="Motor de visión">${I.cpu.replace('<svg', '<svg width="14" height="14"')} IA: ${ia === 'listo' ? '<span class="dot ok"></span> COCO-SSD' : ia === 'cargando' ? '<span class="spin"></span> cargando' : ia === 'error' ? '<span class="dot bad"></span> error' : 'sólo movimiento'}</span>
        <span class="pill" data-go="alarmas" title="Alarmas nuevas (central de alarmas)" aria-label="${alertas} alertas nuevas">${I.bell.replace('<svg', '<svg width="15" height="15"')} ${alertas ? '<b style="color:var(--warn)">' + alertas + '</b>' : '0'}</span>
        <button class="btn ghost sm" id="th" title="Tema claro/oscuro" aria-label="Cambiar tema">${I.sun}</button>
        <span class="small tx2 hide-sm">${esc(A.session.nombre)}</span>
        <button class="btn ghost sm" id="lo" title="Cerrar sesión" aria-label="Cerrar sesión">${I.out}</button>
      </div>`;
    top.onclick = e => {
      const g = e.target.closest('[data-go]'); if (g) { const [v, a] = g.dataset.go.split(':'); A.go(v, a); }
      if (e.target.closest('#lo')) A.logout();
      if (e.target.closest('#mb')) V.$('#nav').classList.toggle('open');
      if (e.target.closest('#th')) { const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = cur; try { localStorage.setItem('vigia.tema', cur); } catch (_) { } }
    };
  };

  // ---------- helpers de presentación ----------
  A.claseColor = c => { if (V.analitica && V.analitica.esEvento(c)) return c === 'humo' || c === 'manipulacion' || c === 'intrusion' ? 'var(--bad)' : 'var(--c-evento)'; for (const [g, arr] of Object.entries(V.GRUPOS_CLASE)) if (arr.includes(c)) return 'var(--c-' + g + ')'; return 'var(--c-otro)'; };
  A.estadoBadge = e => ({ sugerido: '<span class="badge info">sugerido por motor</span>', revisado: '<span class="badge acc">revisado</span>', descartado: '<span class="badge">descartado</span>', confirmado: '<span class="badge bad">incidente confirmado</span>' }[e] || '<span class="badge">' + esc(e) + '</span>');
  A.tiempo = function (rec, t, tz) {
    if (rec && rec.horaInicio != null) return esc(V.fmtDateTime(rec.horaInicio + t * 1000, tz || rec.tz)) + ' <span class="muted">· pos. ' + V.fmtDur(t) + '</span>';
    return 'pos. ' + V.fmtDur(t) + ' <span class="badge warn" title="El archivo no trae hora de captura">sin hora de captura</span>';
  };
  A.camSelect = function (cams, sel, attrs) {
    return '<select ' + (attrs || '') + '>' + cams.map(c => '<option value="' + c.id + '" ' + (c.id === sel ? 'selected' : '') + '>Cámara ' + c.numero + ' · ' + esc(c.nombre) + '</option>').join('') + '</select>';
  };
  A.bboxHTML = function (b, label, color) {
    if (!b) return '';
    return '<div class="bbox" style="left:' + (b.x * 100) + '%;top:' + (b.y * 100) + '%;width:' + (b.w * 100) + '%;height:' + (b.h * 100) + '%;border-color:' + color + '"><span style="background:' + color + '">' + esc(label) + '</span></div>';
  };

  /** Selector de expediente para "añadir al caso" */
  A.pickCase = async function () {
    const cases = (await A.api.listCases(A.token)).filter(c => c.estado !== 'cerrado');
    const html = `<div class="col">${cases.length ? '<label class="f">Expediente existente<select id="pc">' + cases.map(c => '<option value="' + c.id + '">' + esc(c.codigo + ' · ' + c.titulo) + '</option>').join('') + '</select></label><div class="muted small">o bien</div>' : ''}<label class="f">Nuevo expediente (título)<input type="text" id="pn" placeholder="p. ej. Ingreso no autorizado portería"></label>
      <label class="f">Clasificación de esta evidencia<select id="pk"><option value="">Automática (según estado del hallazgo)</option><option value="hipotesis">Hipótesis</option><option value="sugerido_ia">Hallazgo sugerido por IA</option><option value="revisado">Hallazgo revisado</option><option value="confirmado">Incidente confirmado</option></select></label>
      <label class="f">Nota (opcional)<input type="text" id="pnota"></label></div>`;
    const r = await V.modal('Añadir al expediente', html, [{ label: 'Cancelar', value: null }, { label: 'Añadir', cls: 'pri', collect: bg => ({ caseId: bg.querySelector('#pc') && bg.querySelector('#pc').value, nuevo: bg.querySelector('#pn').value.trim(), clasificacion: bg.querySelector('#pk').value, nota: bg.querySelector('#pnota').value }) }]);
    if (!r) return null;
    if (r.nuevo) { const c = await A.api.createCase(A.token, { titulo: r.nuevo }); r.caseId = c.id; }
    if (!r.caseId) { V.toast('Elija o cree un expediente', 'warn'); return null; }
    return r;
  };
  A.addToCase = async function (tipo, refId) {
    try {
      const r = await A.pickCase(); if (!r) return;
      await A.api.addEvidence(A.token, r.caseId, { tipo, refId, clasificacion: r.clasificacion || undefined, nota: r.nota });
      V.toast('Evidencia añadida al expediente');
    } catch (e) { V.fail(e); }
  };
})();
