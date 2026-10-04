/* VIGÍA · acceso con cuenta (Supabase Auth) y administración de usuarios, roles, permisos y licencias.
 * Pantalla de acceso con tres pestañas: Ingresar · Registrar propietario · Soy del equipo.
 * La identidad, el rol, los permisos individuales y la licencia se leen de la nube en cada ingreso;
 * los videos y el análisis permanecen en este navegador. */
(function () {
  'use strict';
  const V = window.V; const A = V.app; const C = V.cloud; const esc = V.esc; const I = V.icons;
  const VERSION = (V.VERSION || '1.2.0');
  // el enlace de «olvidé mi contraseña» vuelve con type=recovery en la URL: se anota antes de que el cliente lo consuma
  let recuperacion = /type=recovery/.test(location.hash || '') || /type=recovery/.test(location.search || '');
  const loginLocal = A.renderLogin;
  const PLAN = { prueba: 'Prueba', profesional: 'Profesional', empresarial: 'Empresarial' };
  const fecha = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : 'sin vencimiento';
  const hoy = () => new Date().toISOString().slice(0, 10);
  const claveOk = p => typeof p === 'string' && p.length >= 8;

  /** Formulario de nueva contraseña (clave temporal o recuperación). Devuelve true si se cambió. */
  async function pedirNuevaClave(titulo, texto) {
    for (;;) {
      const r = await V.modal(titulo, `<div class="col"><p class="small tx2">${esc(texto)}</p>
        <label class="f">Nueva contraseña (mínimo 8 caracteres)<input type="password" id="nc1" autocomplete="new-password" minlength="8"></label>
        <label class="f">Repítela<input type="password" id="nc2" autocomplete="new-password" minlength="8"></label></div>`,
        [{ label: 'Cancelar', value: null }, { label: 'Guardar contraseña', cls: 'pri', collect: bg => ({ a: bg.querySelector('#nc1').value, b: bg.querySelector('#nc2').value }) }]);
      if (!r) return false;
      if (!claveOk(r.a)) { V.toast('La contraseña debe tener al menos 8 caracteres.', 'warn'); continue; }
      if (r.a !== r.b) { V.toast('Las contraseñas no coinciden.', 'warn'); continue; }
      try { await C.cambiarClave(r.a); V.toast('Contraseña actualizada.'); return true; } catch (e) { V.toast(C.mensaje(e), 'bad', 8000); }
    }
  }

  /** Con la cuenta ya verificada: lee organización, rol, permisos y licencia, y abre la sesión. */
  A.entrarConCuenta = async function (avisar) {
    const user = C.user; if (!user) return false;
    let acc = await C.acceso();
    const meta = user.user_metadata || {};
    if (!acc.length && meta.vigia_org) { // propietario que confirmó su correo: se crea la organización en su primer ingreso
      try { await C.registrarPropietario(meta.vigia_org, meta.vigia_sede || null); acc = await C.acceso(); } catch (e) { avisar(C.mensaje(e)); }
    }
    if (recuperacion) { recuperacion = false; try { history.replaceState(null, '', location.pathname); } catch (_) { } await pedirNuevaClave('Crea tu nueva contraseña', 'Llegaste desde el enlace de recuperación. Escribe la contraseña que usarás de ahora en adelante.'); }
    if (!acc.length) {
      avisar('Tu cuenta (' + user.email + ') está creada, pero aún no perteneces a una organización. Avísale a tu administrador para que te agregue con ese correo y te asigne un rol. Si eres el dueño, usa «Registrar propietario».', 'info');
      return false;
    }
    if (acc[0].debe_cambiar_clave) {
      const ok = await pedirNuevaClave('Crea tu contraseña', 'Ingresaste con una clave temporal. Por seguridad debes crear ahora una contraseña propia.');
      if (!ok) { await C.salir().catch(() => { }); avisar('Debes crear tu contraseña para continuar.'); return false; }
    }
    let a = acc[0];
    if (acc.length > 1) {
      const id = await V.modal('Elige la organización', '<div class="col">' + acc.map((x, i) => `<label class="check"><input type="radio" name="aorg" value="${x.org_id}" ${i ? '' : 'checked'}> ${esc(x.org_nombre)} <span class="badge">${esc(V.ROLES[x.rol] || x.rol)}</span>${C.bloqueo(x) ? ' <span class="badge bad">licencia no vigente</span>' : ''}</label>`).join('') + '</div>',
        [{ label: 'Cancelar', value: null }, { label: 'Entrar', cls: 'pri', collect: bg => (bg.querySelector('input[name=aorg]:checked') || {}).value }]);
      if (!id) return false; a = acc.find(x => x.org_id === id) || a;
    }
    const bloqueo = C.bloqueo(a);
    // el administrador entra aunque la licencia de la organización no esté vigente, sólo para ver su estado
    if (bloqueo && !(a.rol === 'admin' && a.activo && (!a.licencia_vence || a.licencia_vence >= hoy()))) { avisar(bloqueo); return false; }
    const licencia = { plan: a.plan, maxUsuarios: a.max_usuarios, maxCamaras: a.max_camaras, vence: a.org_vence, estado: a.org_estado, usuarios: a.usuarios, usuarioVence: a.licencia_vence, vigente: !bloqueo };
    const r = await A.api.loginNube({ userId: user.id, email: user.email, nombre: a.nombre || meta.nombre, orgId: a.org_id, orgNombre: a.org_nombre, rol: a.rol, permisos: a.permisos || {}, licencia });
    A.token = r.token; A.session = r.session; A.acceso = Object.assign({}, a, { licencia }); C.orgId = a.org_id;
    A.start();
    if (bloqueo) { V.toast(bloqueo + ' Sólo está disponible la administración.', 'warn', 12000); A.go('admin', 'usuarios'); }
    return true;
  };

  A.renderLogin = async function (msg) {
    if (!C.configurada() || A._modoLocal) {
      await loginLocal(msg);
      if (C.configurada()) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ghost'; b.style.marginTop = '12px'; b.textContent = '← Volver al acceso con cuenta'; b.onclick = () => { A._modoLocal = false; A.renderLogin(); }; V.$('.login-card').appendChild(b); }
      return;
    }
    let tab = A._tabAcceso || 'ingresar';
    document.body.innerHTML = `<main class="login"><div class="login-card acceso">
      <div class="brand">${I.logo}<span>VIGÍA</span></div>
      <div class="tiny mono muted" style="letter-spacing:.14em;margin:2px 0 14px">MONITOREO Y ANÁLISIS DE VIDEO · v${esc(VERSION)}</div>
      <h2 class="h2">Acceso</h2>
      <div class="tabs" role="tablist" aria-label="Tipo de acceso" style="padding:0;margin:8px 0 12px">
        <button type="button" role="tab" data-tab="ingresar">Ingresar</button><button type="button" role="tab" data-tab="propietario">Registrar propietario</button><button type="button" role="tab" data-tab="equipo">Soy del equipo</button></div>
      <p id="ahint" class="small tx2" style="margin:0 0 10px"></p>
      <form id="af" class="col" novalidate>
        <div id="aown" class="col" hidden>
          <label class="f">Nombre de la organización<input type="text" id="aorg" maxlength="120" autocomplete="organization" placeholder="Ej. Club El Nogal"></label>
          <label class="f">Nombre de la primera sede<input type="text" id="asede" maxlength="120" placeholder="Ej. Sede principal"></label></div>
        <label class="f">Correo<input type="email" id="aemail" autocomplete="username" required></label>
        <label class="f" id="apwl">Contraseña<span class="pwbox"><input type="password" id="apw" autocomplete="current-password" minlength="8" required><button type="button" class="btn sm" id="ashow" aria-pressed="false">Mostrar</button></span></label>
        <div id="amsg" class="small" role="status" aria-live="polite" style="min-height:18px">${msg ? '<span style="color:var(--bad)">' + esc(msg) + '</span>' : ''}</div>
        <div class="row"><button class="btn pri" id="ago">Ingresar</button><button type="button" class="btn sm" id="aresend" hidden>Reenviar correo de confirmación</button></div>
        <div class="row small" id="alinks" style="gap:16px"><button type="button" class="linkbtn" id="aforgot">Olvidé mi contraseña</button><button type="button" class="linkbtn" id="aacc">Olvidé mi cuenta</button></div>
      </form>
      <div id="ahelp" class="alert-box info small" hidden style="margin-top:12px"><b>¿Cuál es mi cuenta?</b><br>Tu cuenta es el <b>correo</b> con el que te registraste; no hay otro nombre de usuario. Busca en tu bandeja (y en spam) el mensaje de confirmación de VIGÍA / «Supabase Auth»: llegó al correo que usaste. Si eres del equipo, pregúntale a tu administrador: él ve tu correo en <i>Administración → Usuarios, roles y licencias</i>.</div>
      <details style="margin-top:18px" class="small muted"><summary>Otras opciones</summary>
        <p>Las cuentas, roles y licencias se administran en la nube. Los videos y su análisis se guardan sólo en este navegador.</p>
        <button type="button" class="btn sm" id="tlocal">Demostración local sin cuenta</button></details>
    </div></main>`;
    const q = s => V.$(s);
    const aviso = (t, tipo) => { q('#amsg').innerHTML = t ? '<span style="color:var(--' + (tipo === 'ok' ? 'ok' : tipo === 'info' ? 'info' : 'bad') + ')">' + esc(t) + '</span>' : ''; };
    const HINT = { ingresar: 'Ingresa con tu correo y contraseña.', propietario: 'El propietario crea la organización y queda como administrador. Recibirás un correo para confirmar la cuenta.', equipo: 'Crea tu cuenta y avisa a tu administrador: él te agrega a la organización con tu correo y tu rol.' };
    const BTN = { ingresar: 'Ingresar', propietario: 'Crear cuenta de propietario', equipo: 'Crear mi cuenta' };
    const pinta = () => {
      A._tabAcceso = tab;
      V.$$('.acceso [data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      q('#ahint').textContent = HINT[tab]; q('#ago').textContent = BTN[tab]; q('#aown').hidden = tab !== 'propietario'; q('#alinks').hidden = tab !== 'ingresar';
      q('#apw').autocomplete = tab === 'ingresar' ? 'current-password' : 'new-password'; q('#aresend').hidden = true;
    };
    pinta();
    V.$('.acceso .tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; aviso(''); pinta(); } };
    q('#ashow').onclick = () => { const p = q('#apw'); const ver = p.type === 'password'; p.type = ver ? 'text' : 'password'; q('#ashow').textContent = ver ? 'Ocultar' : 'Mostrar'; q('#ashow').setAttribute('aria-pressed', ver); };
    q('#tlocal').onclick = () => { A._modoLocal = true; A.renderLogin(); };
    q('#aacc').onclick = () => { q('#ahelp').hidden = !q('#ahelp').hidden; };
    q('#aforgot').onclick = async () => {
      const email = q('#aemail').value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return aviso('Escribe tu correo arriba y vuelve a pulsar «Olvidé mi contraseña».');
      try { await C.recuperarClave(email); aviso('Si ese correo tiene cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa también spam.', 'ok'); } catch (e) { aviso(C.mensaje(e)); }
    };
    q('#aresend').onclick = async () => { try { await C.reenviarConfirmacion(q('#aemail').value.trim()); aviso('Correo de confirmación reenviado.', 'ok'); } catch (e) { aviso(C.mensaje(e)); } };
    q('#af').onsubmit = async e => {
      e.preventDefault(); aviso('');
      const email = q('#aemail').value.trim().toLowerCase(), pw = q('#apw').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return aviso('Escribe un correo válido.');
      if (!claveOk(pw)) return aviso('La contraseña debe tener al menos 8 caracteres.');
      const b = q('#ago'); b.disabled = true; const txt = b.textContent; b.innerHTML = '<span class="spin"></span> Un momento…';
      try {
        if (tab === 'ingresar') {
          await C.entrar(email, pw);
          if (!await A.entrarConCuenta(aviso)) { b.disabled = false; b.textContent = txt; }
          return;
        }
        let datos = {};
        if (tab === 'propietario') {
          const org = q('#aorg').value.trim(), sede = q('#asede').value.trim();
          if (org.length < 2) { aviso('Escribe el nombre de la organización.'); b.disabled = false; b.textContent = txt; return; }
          datos = { vigia_org: org.slice(0, 120), vigia_sede: sede.slice(0, 120) };
        }
        const r = await C.registrarCuenta(email, pw, datos);
        if (r.requiereConfirmacion) {
          aviso(tab === 'propietario' ? 'Cuenta creada. Abre el correo de confirmación que te enviamos y luego ingresa: tu organización se crea en ese primer ingreso.' : 'Cuenta creada. Confirma tu correo con el mensaje que te enviamos y avísale a tu administrador para que te agregue.', 'ok');
          q('#aresend').hidden = false; tab = 'ingresar'; A._tabAcceso = tab; const keep = q('#amsg').innerHTML; pinta(); q('#amsg').innerHTML = keep; q('#aresend').hidden = false;
        } else if (!await A.entrarConCuenta(aviso)) { /* sin organización todavía: el aviso ya explica qué hacer */ }
      } catch (err) { const m = C.mensaje(err); aviso(m); if (/confirmado/.test(m)) q('#aresend').hidden = false; }
      b.disabled = false; if (q('#ago')) q('#ago').textContent = BTN[tab];
    };
    // sesión de nube ya abierta en este navegador (recarga o regreso desde el correo): entrar sin pedir la clave otra vez
    try { if (await C.sesion()) { aviso('Recuperando tu sesión…', 'info'); if (!await A.entrarConCuenta(aviso) && q('#amsg') && !q('#amsg').textContent) aviso(''); } } catch (e) { if (q('#amsg')) aviso(C.mensaje(e)); }
  };

  // ======================= ADMINISTRACIÓN · usuarios, roles y licencias =======================
  const adm = A.views.admin; const usuariosLocal = adm.usuarios;
  const PERM_TXT = {
    'camaras.ver': 'Ver cámaras, grabaciones y hallazgos', 'camaras.gestionar': 'Crear y configurar cámaras, zonas y plano', 'grabaciones.cargar': 'Importar y analizar videos', 'medios.ver': 'Ver video e imágenes',
    'evidencia.descargar': 'Descargar originales y paquetes de evidencia', 'clips.crear': 'Extraer clips', 'hallazgos.revisar': 'Revisar o descartar hallazgos', 'incidentes.confirmar': 'Confirmar incidentes y reabrir alarmas',
    'expedientes.ver': 'Ver expedientes', 'expedientes.crear': 'Crear y editar expedientes', 'informes.aprobar': 'Aprobar informes', 'reglas.crear': 'Crear reglas de alerta', 'vivo.usar': 'Usar video en vivo',
    'alarmas.gestionar': 'Gestionar la central de alarmas', 'auditoria.ver': 'Ver la auditoría', 'admin.usuarios': 'Administrar usuarios, roles y licencias', 'admin.politicas': 'Políticas, retención y sincronización',
    'indicadores.ver': 'Ver indicadores', 'chat.usar': 'Usar el chat', 'chats.ver_todos': 'Ver chats de otros usuarios', 'grabaciones.eliminar': 'Eliminar grabaciones'
  };
  const estadoLic = m => !m.activo ? ['suspendida', 'bad'] : (m.licencia_vence && m.licencia_vence < hoy()) ? ['vencida', 'bad'] : (m.licencia_vence && (new Date(m.licencia_vence) - Date.now()) < 15 * 86400e3) ? ['por vencer', 'warn'] : ['activa', 'ok'];

  adm.usuarios = async function (body) {
    if (!A.session || !A.session.nube) return usuariosLocal(body);
    if (!A.api.can(A.token, 'admin.usuarios')) { body.innerHTML = '<div class="alert-box">Su rol no permite gestionar usuarios, roles ni licencias.</div>'; return; }
    const orgId = A.session.nube.orgId;
    body.innerHTML = '<div class="empty"><span class="spin"></span> Cargando equipo y licencias…</div>';
    let ms, acc, eventos = [], orgs = null;
    try { [ms, acc] = await Promise.all([C.miembros(orgId), C.acceso()]); } catch (e) { body.innerHTML = '<div class="alert-box bad">' + esc(C.mensaje(e)) + '</div>'; return; }
    const a = acc.find(x => x.org_id === orgId) || A.acceso || {};
    try { eventos = await C.eventosAdmin(orgId); } catch (_) { }
    if (a.es_plataforma) { try { orgs = await C.orgsPlataforma(); } catch (_) { } }
    const usados = ms.length, cupo = a.max_usuarios || 0; const orgVig = a.org_estado === 'activa' && (!a.org_vence || a.org_vence >= hoy());
    const nExc = m => Object.keys(m.permisos || {}).length;
    body.innerHTML = `
      <div class="card"><div class="row"><h2 class="h2 grow">Licencia de ${esc(a.org_nombre || A.session.orgNombre)}</h2><span class="badge ${orgVig ? 'ok' : 'bad'}">${orgVig ? 'vigente' : (a.org_estado !== 'activa' ? 'suspendida' : 'vencida')}</span>${a.es_plataforma ? `<button class="btn sm" data-lic="${orgId}">Editar licencia</button>` : ''}</div>
        <div class="kpis" style="margin-top:10px">
          <div class="kpi"><div class="l">Plan</div><div class="v" style="font-size:22px">${esc(PLAN[a.plan] || a.plan || '—')}</div><div class="s">vence: ${esc(fecha(a.org_vence))}</div></div>
          <div class="kpi"><div class="l">Usuarios</div><div class="v" style="font-size:22px">${usados} <span class="muted" style="font-size:14px">de ${cupo}</span></div><div class="prog" style="margin-top:6px"><i style="width:${Math.min(100, cupo ? usados / cupo * 100 : 0)}%;background:${usados >= cupo ? 'var(--bad)' : 'var(--acc)'}"></i></div></div>
          <div class="kpi"><div class="l">Cámaras permitidas</div><div class="v" style="font-size:22px">${a.max_camaras || '—'}</div><div class="s">por organización</div></div>
          <div class="kpi"><div class="l">Licencias de usuario</div><div class="v" style="font-size:22px">${ms.filter(m => estadoLic(m)[1] !== 'bad').length} <span class="muted" style="font-size:14px">activas</span></div><div class="s">${ms.filter(m => estadoLic(m)[1] === 'bad').length} suspendidas o vencidas</div></div></div>
        ${a.es_plataforma ? '' : '<div class="tiny muted" style="margin-top:8px">El plan, los cupos y el vencimiento de la organización los fija el administrador de la plataforma.</div>'}</div>

      <form class="card" id="umadd" style="margin-top:12px"><h2 class="h2">Agregar miembro</h2>
        <p class="small tx2" style="margin:6px 0 10px">La persona debe crear antes su cuenta en la pestaña <b>«Soy del equipo»</b> de la pantalla de acceso. Luego la agregas aquí con su correo y su rol.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px"><label class="f">Correo<input type="email" id="umail" placeholder="correo@ejemplo.com" autocomplete="off" required></label><label class="f">Nombre (opcional)<input type="text" id="unom" maxlength="80"></label><label class="f">Rol<select id="urol">${Object.entries(V.ROLES).map(([k, v]) => `<option value="${k}" ${k === 'operador' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
        <div class="row" style="margin-top:10px"><button class="btn pri" ${usados >= cupo ? 'disabled title="Cupo de usuarios de la licencia agotado"' : ''}>${I.plus} Agregar miembro</button>${usados >= cupo ? '<span class="small" style="color:var(--bad)">Cupo de la licencia agotado (' + cupo + ' usuarios).</span>' : ''}</div></form>

      <div class="card" style="margin-top:12px;overflow:auto"><h2 class="h2">Miembros (${ms.length})</h2>
        <table class="table" style="margin-top:8px;min-width:820px"><tr><th>Persona</th><th>Rol</th><th>Licencia</th><th>Vence</th><th>Permisos</th><th>Último ingreso</th><th></th></tr>
        ${ms.map(m => { const [et, cl] = estadoLic(m); const yo = m.user_id === A.session.nube.userId; return `<tr data-u="${m.user_id}">
          <td><b>${esc(m.nombre || m.email.split('@')[0])}</b>${m.propietario ? ' <span class="badge acc">propietario</span>' : ''}${yo ? ' <span class="badge">tú</span>' : ''}<div class="tiny muted">${esc(m.email)}</div></td>
          <td><select data-c="rol" aria-label="Rol de ${esc(m.email)}">${Object.entries(V.ROLES).map(([k, v]) => `<option value="${k}" ${m.rol === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
          <td><span class="badge ${cl}">${et}</span><div style="margin-top:4px"><button class="btn xs" data-c="activo" data-v="${m.activo ? '0' : '1'}">${m.activo ? 'Suspender' : 'Reactivar'}</button></div></td>
          <td><input type="date" data-c="vence" value="${esc(m.licencia_vence || '')}" aria-label="Vencimiento de la licencia de ${esc(m.email)}" style="width:140px">${m.licencia_vence ? '<div><button class="linkbtn tiny" data-c="sinv">sin vencimiento</button></div>' : '<div class="tiny muted">sin vencimiento</div>'}</td>
          <td><button class="btn xs" data-c="permisos">${nExc(m) ? nExc(m) + ' excepción(es)' : 'Según el rol'}</button></td>
          <td class="small">${m.ultimo_ingreso ? esc(V.fmtDateTime(Date.parse(m.ultimo_ingreso))) : '<span class="muted">nunca</span>'}</td>
          <td><div class="row" style="gap:4px;flex-wrap:nowrap">${yo ? '' : '<button class="btn xs" data-c="clave">Clave temporal</button><button class="btn xs danger" data-c="quitar">Quitar</button>'}</div></td></tr>`; }).join('')}</table>
        <div class="tiny muted" style="margin-top:8px">Los cambios de rol, permisos y licencia se aplican en el siguiente ingreso de la persona. Una licencia suspendida o vencida impide entrar y corta la sincronización con la nube.</div></div>

      ${orgs ? `<div class="card" style="margin-top:12px;overflow:auto"><h2 class="h2">Organizaciones de la plataforma (${orgs.length})</h2><table class="table" style="margin-top:8px;min-width:720px"><tr><th>Organización</th><th>Propietario</th><th>Plan</th><th>Usuarios</th><th>Cámaras</th><th>Vence</th><th>Estado</th><th></th></tr>${orgs.map(o => `<tr><td><b>${esc(o.nombre)}</b></td><td class="small">${esc(o.propietario || '')}</td><td>${esc(PLAN[o.plan] || o.plan)}</td><td>${o.usuarios} / ${o.max_usuarios}</td><td>${o.max_camaras}</td><td>${esc(fecha(o.licencia_vence))}</td><td><span class="badge ${o.licencia_estado === 'activa' && (!o.licencia_vence || o.licencia_vence >= hoy()) ? 'ok' : 'bad'}">${esc(o.licencia_estado === 'activa' && o.licencia_vence && o.licencia_vence < hoy() ? 'vencida' : o.licencia_estado)}</span></td><td><button class="btn xs" data-lic="${o.org_id}">Licencia</button></td></tr>`).join('')}</table></div>` : ''}

      <div class="card" style="margin-top:12px"><h2 class="h2">Registro de cambios de administración</h2><div class="col tiny" style="gap:4px;margin-top:8px">${eventos.map(e => `<div><span class="muted">${esc(V.fmtDateTime(Date.parse(e.en)))}</span> · ${esc(e.actor_email || 'sistema')} · <b>${esc(e.accion)}</b> <span class="muted">${esc(Object.entries(e.detalle || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(' · '))}</span></div>`).join('') || '<span class="muted">Sin cambios registrados.</span>'}</div></div>
      <div id="uperm"></div>`;
    const recargar = () => adm.render(V.$('#main'), 'usuarios');
    const hacer = async (fn, ok) => { try { await fn(); if (ok) V.toast(ok); recargar(); } catch (e) { V.toast(C.mensaje(e), 'bad', 9000); recargar(); } };
    V.$('#umadd').onsubmit = e => { e.preventDefault(); const mail = V.$('#umail').value.trim(); if (!mail) return; hacer(() => C.miembroAgregar(orgId, mail, V.$('#urol').value, V.$('#unom').value.trim()), 'Miembro agregado.'); };
    const de = el => ms.find(m => m.user_id === el.closest('[data-u]').dataset.u);
    body.onchange = e => {
      const el = e.target.closest('[data-c]'); if (!el || !el.closest('[data-u]')) return; const m = de(el);
      if (el.dataset.c === 'rol') hacer(() => C.miembroActualizar(orgId, m.user_id, { rol: el.value }), 'Rol actualizado: ' + V.ROLES[el.value]);
      if (el.dataset.c === 'vence' && el.value) hacer(() => C.miembroActualizar(orgId, m.user_id, { vence: el.value }), 'Vencimiento de la licencia: ' + fecha(el.value));
    };
    body.onclick = async e => {
      const lic = e.target.closest('[data-lic]'); if (lic) return editarLicencia(lic.dataset.lic, (orgs || []).find(o => o.org_id === lic.dataset.lic) || { org_id: orgId, nombre: a.org_nombre, plan: a.plan, max_usuarios: a.max_usuarios, max_camaras: a.max_camaras, licencia_vence: a.org_vence, licencia_estado: a.org_estado }, recargar);
      const el = e.target.closest('button[data-c]'); if (!el || !el.closest('[data-u]')) return; const m = de(el); const k = el.dataset.c;
      if (k === 'activo') return hacer(() => C.miembroActualizar(orgId, m.user_id, { activo: el.dataset.v === '1' }), el.dataset.v === '1' ? 'Licencia reactivada.' : 'Licencia suspendida: la persona ya no puede ingresar.');
      if (k === 'sinv') return hacer(() => C.miembroActualizar(orgId, m.user_id, { sinVencimiento: true }), 'Licencia sin vencimiento.');
      if (k === 'quitar') { if (await V.confirmar('Quitar miembro', '¿Quitar a ' + m.email + ' de la organización? Pierde el acceso de inmediato; su cuenta no se borra.', 'Quitar')) hacer(() => C.miembroQuitar(orgId, m.user_id), 'Miembro quitado.'); return; }
      if (k === 'clave') {
        if (!await V.confirmar('Clave temporal', 'Se generará una contraseña temporal para ' + m.email + ' y se cerrarán sus sesiones. Al ingresar deberá crear una contraseña propia.', 'Generar')) return;
        try {
          const pw = await C.claveTemporal(orgId, m.user_id); const site = location.origin + location.pathname;
          const cuerpo = 'Hola,\n\nTu acceso a VIGÍA fue restablecido.\n\nEnlace: ' + site + '\nCorreo: ' + m.email + '\nContraseña temporal: ' + pw + '\n\nAl ingresar, el sistema te pedirá crear una contraseña propia de inmediato.';
          await V.modal('Clave temporal de ' + m.email, `<p class="small tx2">Se muestra una sola vez y no queda guardada en claro. Sus sesiones abiertas se cerraron.</p><p class="mono" style="font-size:18px;user-select:all" id="ctpw">${esc(pw)}</p><div class="row"><button class="btn sm" id="ctcp">Copiar contraseña</button><button class="btn sm" id="ctmsg">Copiar mensaje completo</button></div><p class="tiny muted">Correo de la persona (para enviárselo): <span style="user-select:all">${esc(m.email)}</span></p>`, [{ label: 'Entendido', cls: 'pri' }], { onOpen: bg => { const cp = t => navigator.clipboard.writeText(t).then(() => V.toast('Copiado'), () => V.toast('No se pudo copiar; selecciónela manualmente.', 'warn')); bg.querySelector('#ctcp').onclick = () => cp(pw); bg.querySelector('#ctmsg').onclick = () => cp(cuerpo); } });
          recargar();
        } catch (err) { V.toast(C.mensaje(err), 'bad', 9000); }
        return;
      }
      if (k === 'permisos') {
        const perms = Object.keys(V.PERMS); const act = m.permisos || {};
        const r = await V.modal('Permisos de ' + m.email, `<p class="small tx2">Parte del rol <b>${esc(V.ROLES[m.rol])}</b>. Aquí puedes <b>conceder</b> o <b>denegar</b> permisos concretos sólo a esta persona.</p>
          <table class="table small"><tr><th>Permiso</th><th>Según el rol</th><th>Para esta persona</th></tr>${perms.map(p => `<tr><td>${esc(PERM_TXT[p] || p)}<div class="tiny mono muted">${p}</div></td><td>${V.can(m.rol, p) ? '<span class="badge ok">sí</span>' : '<span class="badge">no</span>'}</td><td><select data-p="${p}"><option value="">Según el rol</option><option value="1" ${act[p] === true ? 'selected' : ''}>Conceder</option><option value="0" ${act[p] === false ? 'selected' : ''}>Denegar</option></select></td></tr>`).join('')}</table>`,
          [{ label: 'Cancelar', value: null }, { label: 'Guardar permisos', cls: 'pri', collect: bg => { const o = {}; bg.querySelectorAll('[data-p]').forEach(s => { if (s.value) o[s.dataset.p] = s.value === '1'; }); return o; } }], { wide: true });
        if (r) hacer(() => C.miembroActualizar(orgId, m.user_id, { permisos: r }), 'Permisos guardados.');
      }
    };
  };

  async function editarLicencia(orgId, o, recargar) {
    const r = await V.modal('Licencia de ' + (o.nombre || 'la organización'), `<div class="col">
      <label class="f">Plan<select id="lpl">${Object.entries(PLAN).map(([k, v]) => `<option value="${k}" ${o.plan === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">Usuarios permitidos<input type="number" id="lmu" min="1" max="100000" value="${o.max_usuarios || 5}"></label>
      <label class="f">Cámaras permitidas<input type="number" id="lmc" min="1" max="100000" value="${o.max_camaras || 8}"></label>
      <label class="f">Vence (vacío = sin vencimiento)<input type="date" id="lve" value="${esc(o.licencia_vence || '')}"></label>
      <label class="f">Estado<select id="les"><option value="activa" ${o.licencia_estado === 'activa' ? 'selected' : ''}>Activa</option><option value="suspendida" ${o.licencia_estado === 'suspendida' ? 'selected' : ''}>Suspendida</option></select></label></div>`,
      [{ label: 'Cancelar', value: null }, { label: 'Guardar licencia', cls: 'pri', collect: bg => ({ plan: bg.querySelector('#lpl').value, maxUsuarios: bg.querySelector('#lmu').value, maxCamaras: bg.querySelector('#lmc').value, vence: bg.querySelector('#lve').value, estado: bg.querySelector('#les').value }) }]);
    if (!r) return;
    try { await C.orgLicencia(orgId, r); V.toast('Licencia actualizada.'); } catch (e) { V.toast(C.mensaje(e), 'bad', 9000); }
    recargar();
  }
})();
