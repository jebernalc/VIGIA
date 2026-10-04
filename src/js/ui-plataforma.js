/* VIGÍA · control de la plataforma a gran escala:
 * bandeja de notificaciones · solicitudes de las organizaciones · panel de la plataforma (organizaciones, cuentas, licencias)
 * · mi cuenta y seguridad (contraseña y verificación en dos pasos). */
(function () {
  'use strict';
  const V = window.V; const A = V.app; const C = V.cloud; const esc = V.esc; const I = V.icons;
  const adm = A.views.admin;
  const hoy = () => new Date().toISOString().slice(0, 10);
  const fecha = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : 'sin vencimiento';
  const cuando = t => t ? V.fmtDateTime(Date.parse(t)) : '—';
  const TIPO = { ampliar_usuarios: 'Ampliar cupo de usuarios', ampliar_camaras: 'Ampliar cupo de cámaras', cambiar_plan: 'Cambiar de plan', renovar_licencia: 'Renovar la licencia', reactivar: 'Reactivar la organización', soporte: 'Soporte técnico', otro: 'Otra solicitud' };
  const PLAN = { prueba: 'Prueba', profesional: 'Profesional', empresarial: 'Empresarial' };
  const EST = { pendiente: 'warn', aprobada: 'ok', rechazada: 'bad' };
  I.inbox = I.inbox || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="15" height="15"><path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6l2-8Z"/></svg>';

  // ======================= bandeja de notificaciones =======================
  const N = A.notif = { lista: [], sinLeer: 0, t: 0 };
  N.cargar = async function (forzar) {
    if (!A.session || !A.session.nube) { N.lista = []; N.sinLeer = 0; return; }
    if (N.tok !== A.token) { N.tok = A.token; N.lista = []; N.sinLeer = 0; forzar = true; } // otra sesión: nunca se reutiliza la bandeja anterior
    if (!forzar && Date.now() - N.t < 60000) return;
    N.t = Date.now();
    try { N.lista = await C.notificaciones(); N.sinLeer = N.lista.filter(n => !n.leida_en).length; } catch (_) { }
    N.pintar();
  };
  N.pintar = function () {
    const top = V.$('#top .right'); if (!top || !A.session || !A.session.nube) return;
    let p = V.$('#npill'); if (!p) { p = document.createElement('button'); p.id = 'npill'; p.className = 'pill'; p.type = 'button'; p.title = 'Notificaciones'; top.insertBefore(p, top.firstChild); p.onclick = N.abrir; }
    p.setAttribute('aria-label', N.sinLeer + ' notificaciones sin leer');
    p.innerHTML = I.inbox + ' ' + (N.sinLeer ? '<b style="color:var(--acc)">' + N.sinLeer + '</b>' : '0');
  };
  N.abrir = async function () {
    await N.cargar(true);
    await V.modal('Notificaciones', N.lista.length ? '<div class="col" style="gap:8px">' + N.lista.map(n => `<div class="small" style="border-left:3px solid ${n.leida_en ? 'var(--line2)' : 'var(--acc)'};padding-left:10px"><b>${esc(n.titulo)}</b>${n.para_plataforma ? ' <span class="badge acc">plataforma</span>' : ''}<div class="tx2">${esc(n.cuerpo || '')}</div><div class="tiny muted">${esc(cuando(n.creada_en))}</div></div>`).join('') + '</div>' : '<div class="empty">Sin notificaciones.</div>',
      [{ label: 'Cerrar', value: null }].concat(A.acceso && A.acceso.es_plataforma ? [{ label: 'Ir a Plataforma', value: 'plat' }] : []), { wide: true }).then(v => { if (v === 'plat') A.go('admin', 'plataforma'); });
    if (N.sinLeer) { try { await C.notificacionesMarcar(null); } catch (_) { } N.t = 0; N.cargar(true); }
  };
  const top0 = A.renderTop;
  A.renderTop = async function () { await top0.apply(A, arguments); N.pintar(); N.cargar(false); };

  // ======================= mi cuenta y seguridad =======================
  adm.cuenta = async function (body) {
    if (!A.session || !A.session.nube) { body.innerHTML = '<div class="alert-box">Disponible al ingresar con cuenta.</div>'; return; }
    let mf = { verificados: [] }; try { mf = await C.mfa.estado(); } catch (e) { V.toast(C.mensaje(e), 'warn'); }
    const on = mf.verificados.length > 0; const a = A.acceso || {};
    body.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
      <div class="card"><h2 class="h2">Mi cuenta</h2><div class="small" style="margin-top:8px"><b>${esc(A.session.email)}</b><br>${esc(A.session.orgNombre)} · ${esc(A.session.rolNombre)}${a.propietario ? ' · propietario' : ''}${a.es_plataforma ? ' · <b>administrador de la plataforma</b>' : ''}<br>Licencia de usuario: ${a.licencia_vence ? 'vence ' + esc(fecha(a.licencia_vence)) : 'sin vencimiento'}</div>
        <h3 class="h2" style="font-size:14px;margin-top:16px">Cambiar contraseña</h3>
        <form id="cpw" class="col" style="margin-top:6px"><label class="f">Nueva contraseña (mínimo 8 caracteres)<input type="password" id="cp1" autocomplete="new-password" minlength="8" required></label><label class="f">Repítela<input type="password" id="cp2" autocomplete="new-password" minlength="8" required></label><div><button class="btn sm pri">Guardar contraseña</button></div></form></div>
      <div class="card"><div class="row"><h2 class="h2 grow">Verificación en dos pasos (2FA)</h2><span class="badge ${on ? 'ok' : 'warn'}">${on ? 'activa' : 'inactiva'}</span></div>
        <p class="small tx2" style="margin:8px 0">Además de la contraseña, se pide un código de 6 dígitos de una aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy). Con el doble factor activo, la nube sólo entrega datos a sesiones verificadas con el código.</p>
        ${on ? `<div class="small">Activa desde ${esc(cuando(mf.verificados[0].created_at))}.</div><div class="row" style="margin-top:10px"><button class="btn sm danger" id="c2off" ${a.es_plataforma || a.requiere_2fa ? 'disabled title="Obligatoria para tu cuenta"' : ''}>Desactivar</button>${a.es_plataforma || a.requiere_2fa ? '<span class="tiny muted">Obligatoria para tu cuenta.</span>' : ''}</div>` : '<button class="btn sm pri" id="c2on">Activar doble factor</button>'}
        <p class="tiny muted" style="margin-top:10px">Si pierdes el teléfono, tu administrador puede reiniciar tu doble factor desde «Usuarios, roles y licencias».</p></div></div>`;
    V.$('#cpw').onsubmit = async e => { e.preventDefault(); const p1 = V.$('#cp1').value, p2 = V.$('#cp2').value; if (p1.length < 8) return V.toast('Mínimo 8 caracteres.', 'warn'); if (p1 !== p2) return V.toast('Las contraseñas no coinciden.', 'warn'); try { await C.cambiarClave(p1); V.toast('Contraseña actualizada.'); V.$('#cpw').reset(); } catch (err) { V.toast(C.mensaje(err), 'bad', 8000); } };
    if (V.$('#c2on')) V.$('#c2on').onclick = async () => { if (await A.configurar2fa(false)) adm.render(V.$('#main'), 'cuenta'); };
    if (V.$('#c2off')) V.$('#c2off').onclick = async () => { if (!await V.confirmar('Desactivar doble factor', 'Tu cuenta quedará protegida sólo con la contraseña. ¿Continuar?', 'Desactivar')) return; try { for (const f of mf.verificados) await C.mfa.quitar(f.id); V.toast('Doble factor desactivado.'); } catch (err) { V.toast(C.mensaje(err), 'bad', 8000); } adm.render(V.$('#main'), 'cuenta'); };
  };

  // ======================= usuarios: política 2FA y solicitudes a la plataforma =======================
  adm.usuariosExtra = async function (el, a, orgId, recargar) {
    let sols = []; try { sols = await C.solicitudes(orgId); } catch (_) { }
    el.innerHTML = `<div class="card" style="margin-top:12px"><div class="row"><h2 class="h2 grow">Seguridad del equipo</h2><label class="check"><input type="checkbox" id="u2fa" ${a.requiere_2fa ? 'checked' : ''}> Exigir verificación en dos pasos a todo el equipo</label></div><div class="tiny muted" style="margin-top:6px">Al activarla, cada persona deberá configurar su aplicación de autenticación en su siguiente ingreso.</div></div>
      <div class="card" style="margin-top:12px"><h2 class="h2">Solicitudes a la plataforma</h2><p class="small tx2" style="margin:6px 0 10px">Pida aquí más usuarios, más cámaras, cambio de plan, renovación o soporte. El administrador de la plataforma recibe la solicitud y usted recibe la respuesta en sus notificaciones.</p>
        <form id="usol" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;align-items:end"><label class="f">Tipo<select id="ust">${Object.entries(TIPO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label class="f">Cantidad (si aplica)<input type="number" id="usc" min="1" max="100000" placeholder="p. ej. 10"></label><label class="f" style="grid-column:span 2">Mensaje<input type="text" id="usm" maxlength="1000" placeholder="Explique brevemente la necesidad"></label><div><button class="btn sm pri">Enviar solicitud</button></div></form>
        <table class="table small" style="margin-top:10px"><tr><th>#</th><th>Solicitud</th><th>Estado</th><th>Respuesta</th><th>Fecha</th></tr>${sols.map(s => `<tr><td>${s.id}</td><td>${esc(TIPO[s.tipo] || s.tipo)}${s.cantidad ? ' · ' + s.cantidad : ''}<div class="tiny muted">${esc(s.mensaje || '')}</div></td><td><span class="badge ${EST[s.estado]}">${esc(s.estado)}</span></td><td>${esc(s.respuesta || '')}</td><td>${esc(cuando(s.creada_en))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin solicitudes.</td></tr>'}</table></div>`;
    V.$('#u2fa').onchange = async e => { try { await C.orgRequerir2fa(orgId, e.target.checked); V.toast(e.target.checked ? 'Doble factor obligatorio para el equipo.' : 'Doble factor opcional.'); if (A.acceso) A.acceso.requiere_2fa = e.target.checked; } catch (err) { V.toast(C.mensaje(err), 'bad', 8000); e.target.checked = !e.target.checked; } };
    V.$('#usol').onsubmit = async e => { e.preventDefault(); try { const id = await C.solicitudCrear(orgId, V.$('#ust').value, V.$('#usc').value, V.$('#usm').value.trim()); V.toast('Solicitud #' + id + ' enviada a la plataforma.'); recargar(); } catch (err) { V.toast(C.mensaje(err), 'bad', 8000); } };
  };

  // ======================= panel de la plataforma =======================
  adm.plataforma = async function (body) {
    if (!(A.session && A.session.nube && A.acceso && A.acceso.es_plataforma)) { body.innerHTML = '<div class="alert-box">Sólo para el administrador de la plataforma.</div>'; return; }
    body.innerHTML = '<div class="empty"><span class="spin"></span> Cargando el estado de la plataforma…</div>';
    let r, orgs, cuentas, sols, notif;
    try { [r, orgs, cuentas, sols, notif] = await Promise.all([C.plataformaResumen(), C.orgsPlataforma(), C.plataformaCuentas(), C.solicitudes(null, false), C.notificaciones()]); }
    catch (e) { body.innerHTML = '<div class="alert-box bad">' + esc(C.mensaje(e)) + '</div>'; return; }
    const pend = sols.filter(s => s.estado === 'pendiente'); const orgDe = id => (orgs.find(o => o.org_id === id) || {}).nombre || '—';
    const vig = o => o.licencia_estado === 'activa' && (!o.licencia_vence || o.licencia_vence >= hoy());
    const f = adm._pf || (adm._pf = { q: '' });
    const filtra = (txt) => !f.q || String(txt).toLowerCase().includes(f.q.toLowerCase());
    body.innerHTML = `<div class="kpis">${[
      ['Organizaciones', r.organizaciones, r.org_vigentes + ' con licencia vigente'], ['Por vencer (15 días)', '<span style="color:' + (r.org_por_vencer ? 'var(--warn)' : 'inherit') + '">' + r.org_por_vencer + '</span>', 'licencias de organización'],
      ['Cuentas', r.cuentas, r.cuentas_sin_confirmar + ' sin confirmar · ' + r.cuentas_sin_organizacion + ' sin organización'], ['Licencias de usuario activas', r.miembros_activos, r.con_2fa + ' cuentas con doble factor'],
      ['Solicitudes pendientes', '<span style="color:' + (r.solicitudes_pendientes ? 'var(--acc)' : 'inherit') + '">' + r.solicitudes_pendientes + '</span>', 'por responder'], ['Notificaciones sin leer', r.notificaciones_sin_leer, 'de la plataforma']
    ].map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join('')}</div>

    <div class="card" style="margin-top:12px;overflow:auto"><h2 class="h2">Solicitudes pendientes (${pend.length})</h2><table class="table" style="margin-top:8px;min-width:760px"><tr><th>#</th><th>Organización</th><th>Solicitud</th><th>Solicitante</th><th>Fecha</th><th></th></tr>${pend.map(s => `<tr><td>${s.id}</td><td><b>${esc(orgDe(s.org_id))}</b></td><td>${esc(TIPO[s.tipo] || s.tipo)}${s.cantidad ? ' · <b>' + s.cantidad + '</b>' : ''}<div class="tiny muted">${esc(s.mensaje || '')}</div></td><td class="small">${esc(s.solicitante_email || '')}</td><td class="small">${esc(cuando(s.creada_en))}</td><td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn xs pri" data-sol="${s.id}" data-e="aprobada">Aprobar</button><button class="btn xs" data-sol="${s.id}" data-e="rechazada">Rechazar</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No hay solicitudes pendientes.</td></tr>'}</table>
      ${sols.length > pend.length ? `<details class="small" style="margin-top:8px"><summary class="muted" style="cursor:pointer">Historial (${sols.length - pend.length})</summary><table class="table small">${sols.filter(s => s.estado !== 'pendiente').map(s => `<tr><td>#${s.id}</td><td>${esc(orgDe(s.org_id))}</td><td>${esc(TIPO[s.tipo] || s.tipo)}${s.cantidad ? ' · ' + s.cantidad : ''}</td><td><span class="badge ${EST[s.estado]}">${esc(s.estado)}</span></td><td>${esc(s.respuesta || '')}</td><td>${esc(s.resuelta_por || '')} · ${esc(cuando(s.resuelta_en))}</td></tr>`).join('')}</table></details>` : ''}</div>

    <div class="row" style="margin-top:14px"><input type="search" id="pfq" class="grow" placeholder="Buscar organización o correo…" value="${esc(f.q)}" aria-label="Buscar en organizaciones y cuentas"></div>
    <div class="card" style="margin-top:8px;overflow:auto"><h2 class="h2">Organizaciones (${orgs.length})</h2><table class="table" style="margin-top:8px;min-width:860px"><tr><th>Organización</th><th>Propietario</th><th>Plan</th><th>Usuarios</th><th>Cámaras</th><th>Vence</th><th>Estado</th><th>2FA</th><th></th></tr>${orgs.filter(o => filtra(o.nombre + ' ' + o.propietario)).map(o => `<tr><td><b>${esc(o.nombre)}</b><div class="tiny muted">desde ${esc(fecha(o.creado_en))}</div></td><td class="small">${esc(o.propietario || '')}</td><td>${esc(PLAN[o.plan] || o.plan)}</td><td>${o.usuarios} / ${o.max_usuarios}</td><td>${o.max_camaras}</td><td>${esc(fecha(o.licencia_vence))}</td><td><span class="badge ${vig(o) ? 'ok' : 'bad'}">${vig(o) ? 'vigente' : o.licencia_estado !== 'activa' ? 'suspendida' : 'vencida'}</span></td><td>${o.requiere_2fa ? '<span class="badge ok">obligatorio</span>' : '<span class="badge">opcional</span>'}</td><td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn xs" data-lic="${o.org_id}">Licencia</button><button class="btn xs" data-eq="${o.org_id}">Equipo</button></div></td></tr>`).join('')}</table></div>

    <div class="card" style="margin-top:12px;overflow:auto"><h2 class="h2">Cuentas (${cuentas.length})</h2><table class="table" style="margin-top:8px;min-width:860px"><tr><th>Correo</th><th>Correo confirmado</th><th>Organización y rol</th><th>2FA</th><th>Creada</th><th>Último ingreso</th><th></th></tr>${cuentas.filter(c => filtra(c.email + ' ' + (c.organizaciones || ''))).slice(0, 300).map(c => `<tr><td><b>${esc(c.email)}</b>${c.es_plataforma ? ' <span class="badge acc">plataforma</span>' : ''}</td><td>${c.confirmada ? '<span class="badge ok">sí</span>' : '<span class="badge warn">pendiente</span>'}</td><td class="small">${esc(c.organizaciones || '') || '<span class="muted">sin organización</span>'}</td><td>${c.tiene_2fa ? '<span class="badge ok">activo</span>' : '<span class="badge">no</span>'}</td><td class="small">${esc(cuando(c.creada_en))}</td><td class="small">${c.ultimo_ingreso ? esc(cuando(c.ultimo_ingreso)) : '<span class="muted">nunca</span>'}</td><td>${c.confirmada ? '' : `<button class="btn xs" data-conf="${c.user_id}" data-mail="${esc(c.email)}">Confirmar cuenta</button>`}${c.tiene_2fa && !c.es_plataforma ? `<button class="btn xs" data-r2="${c.user_id}" data-mail="${esc(c.email)}">Reiniciar 2FA</button>` : ''}</td></tr>`).join('')}</table>${cuentas.length > 300 ? '<div class="tiny muted">Se muestran 300; use el buscador.</div>' : ''}</div>

    <div class="card" style="margin-top:12px"><div class="row"><h2 class="h2 grow">Actividad de la plataforma</h2><button class="btn xs" id="pfleer">Marcar todo como leído</button></div><div class="col small" style="gap:6px;margin-top:8px">${notif.filter(n => n.para_plataforma).slice(0, 40).map(n => `<div style="border-left:3px solid ${n.leida_en ? 'var(--line2)' : 'var(--acc)'};padding-left:10px"><b>${esc(n.titulo)}</b> <span class="tiny muted">· ${esc(cuando(n.creada_en))}</span><div class="tx2">${esc(n.cuerpo || '')}</div></div>`).join('') || '<span class="muted">Sin actividad.</span>'}</div></div>`;
    const recargar = () => adm.render(V.$('#main'), 'plataforma');
    V.$('#pfq').onchange = e => { f.q = e.target.value.trim(); recargar(); };
    V.$('#pfleer').onclick = async () => { try { await C.notificacionesMarcar(null); A.notif.t = 0; A.notif.cargar(true); } catch (e) { V.toast(C.mensaje(e), 'bad'); } recargar(); };
    body.onclick = async e => {
      const sol = e.target.closest('[data-sol]'), lic = e.target.closest('[data-lic]'), conf = e.target.closest('[data-conf]'), eq = e.target.closest('[data-eq]'), r2 = e.target.closest('[data-r2]');
      try {
        if (sol) {
          const s = sols.find(x => x.id === +sol.dataset.sol); const ap = sol.dataset.e === 'aprobada';
          const resp = await V.modal((ap ? 'Aprobar' : 'Rechazar') + ' solicitud #' + s.id, `<div class="col"><div class="small"><b>${esc(orgDe(s.org_id))}</b> · ${esc(TIPO[s.tipo] || s.tipo)}${s.cantidad ? ' · ' + s.cantidad : ''}<div class="muted">${esc(s.mensaje || '')}</div></div><label class="f">Respuesta para el solicitante<textarea id="srp" maxlength="1000" placeholder="${ap ? 'Qué se aprobó y desde cuándo' : 'Motivo del rechazo'}"></textarea></label>${ap && s.org_id ? '<div class="tiny muted">Tras aprobar se abrirá la licencia de la organización para aplicar el cambio.</div>' : ''}</div>`, [{ label: 'Cancelar', value: null }, { label: ap ? 'Aprobar' : 'Rechazar', cls: 'pri', collect: bg => ({ t: bg.querySelector('#srp').value }) }]);
          if (!resp) return;
          await C.solicitudResolver(s.id, sol.dataset.e, resp.t); V.toast('Solicitud #' + s.id + ' ' + sol.dataset.e + '.');
          if (ap && s.org_id) { const o = orgs.find(x => x.org_id === s.org_id); if (o) { const sug = Object.assign({}, o); if (s.cantidad && s.tipo === 'ampliar_usuarios') sug.max_usuarios = o.max_usuarios + s.cantidad; if (s.cantidad && s.tipo === 'ampliar_camaras') sug.max_camaras = o.max_camaras + s.cantidad; if (s.tipo === 'reactivar') sug.licencia_estado = 'activa'; return A.editarLicencia(o.org_id, sug, recargar); } }
          return recargar();
        }
        if (lic) return A.editarLicencia(lic.dataset.lic, orgs.find(o => o.org_id === lic.dataset.lic), recargar);
        if (conf) { if (await V.confirmar('Confirmar cuenta', 'Confirmar manualmente el correo ' + conf.dataset.mail + ' permite que ingrese sin abrir el mensaje de confirmación. Hágalo sólo si verificó que el correo pertenece a esa persona.', 'Confirmar')) { await C.confirmarCuenta(conf.dataset.conf); V.toast('Cuenta confirmada.'); recargar(); } return; }
        if (r2) { if (await V.confirmar('Reiniciar doble factor', 'Se eliminará la verificación en dos pasos de ' + r2.dataset.mail + '.', 'Reiniciar')) { await C.reiniciar2fa(null, r2.dataset.r2); V.toast('Doble factor reiniciado.'); recargar(); } return; }
        if (eq) {
          const ms = await C.miembros(eq.dataset.eq);
          await V.modal('Equipo de ' + orgDe(eq.dataset.eq), `<table class="table small"><tr><th>Correo</th><th>Rol</th><th>Licencia</th><th>2FA</th><th>Último ingreso</th></tr>${ms.map(m => `<tr><td>${esc(m.email)}${m.propietario ? ' <span class="badge acc">propietario</span>' : ''}</td><td>${esc(V.ROLES[m.rol] || m.rol)}</td><td>${m.activo ? (m.licencia_vence ? 'vence ' + esc(fecha(m.licencia_vence)) : 'activa') : '<span class="badge bad">suspendida</span>'}</td><td>${m.tiene_2fa ? 'sí' : 'no'}</td><td>${m.ultimo_ingreso ? esc(cuando(m.ultimo_ingreso)) : 'nunca'}</td></tr>`).join('')}</table>`, [{ label: 'Cerrar', value: null }], { wide: true });
        }
      } catch (err) { V.toast(C.mensaje(err), 'bad', 9000); }
    };
  };
})();
