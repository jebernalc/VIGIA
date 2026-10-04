// Acceso con cuenta y administración de usuarios, roles, permisos y licencias (cliente de Supabase simulado, sin red).
// El simulador reproduce las reglas de las funciones SQL de supabase/migrations/0005 para probar la INTERFAZ de punta a punta.
import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const shots = path.resolve('tests/capturas'); fs.mkdirSync(shots, { recursive: true });
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errs.push(m.text()); });
const ok = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('OK  ' + m); };
const shot = n => p.screenshot({ path: path.join(shots, 'acceso_' + n + '.png') });
try {
  await p.goto('file://' + path.resolve('app/VIGIA.html')); await p.waitForSelector('.acceso');
  await p.evaluate(() => {
    const S = window.__S = { users: {}, orgs: {}, mem: [], ev: [], sol: [], notif: [], ses: null, aal: 'aal1', n: 0 };
    const esPlat = () => yo() && yo().email === 'plataforma@vigia.test' && (!yo().factor || S.aal === 'aal2');
    const notificar = (dest, plat, titulo, cuerpo) => S.notif.push({ id: S.notif.length + 1, destinatario: dest, para_plataforma: !!plat, tipo: 't', titulo, cuerpo, datos: {}, creada_en: new Date().toISOString(), leida_en: null });
    const uid = () => '00000000-0000-4000-8000-' + String(++S.n).padStart(12, '0');
    const err = m => ({ data: null, error: { message: m } }); const okr = d => ({ data: d, error: null });
    const yo = () => S.ses && S.users[S.ses]; const hoy = () => new Date().toISOString().slice(0, 10);
    const esAdmin = org => S.mem.some(m => m.org === org && m.user === yo().id && m.rol === 'admin' && m.activo && (!m.vence || m.vence >= hoy()));
    const RPC = {
      vigia_mi_acceso: () => S.mem.filter(m => m.user === yo().id).map(m => { const o = S.orgs[m.org]; return { org_id: o.id, org_nombre: o.nombre, sede_inicial: o.sede, rol: m.rol, activo: m.activo, licencia_vence: m.vence, permisos: m.permisos, nombre: m.nombre, plan: o.plan, max_usuarios: o.maxU, max_camaras: o.maxC, org_vence: o.vence, org_estado: o.estado, usuarios: S.mem.filter(x => x.org === o.id).length, propietario: o.por === m.user, es_plataforma: yo().email === 'plataforma@vigia.test', debe_cambiar_clave: !!yo().temp, requiere_2fa: !!o.req2fa }; }),
      vigia_registrar_propietario: a => { if (Object.values(S.orgs).some(o => o.por === yo().id)) throw 'Esta cuenta ya es propietaria de una organización'; const id = uid(); S.orgs[id] = { id, nombre: a.p_org, sede: a.p_sede, por: yo().id, plan: 'prueba', maxU: 3, maxC: 2, vence: '2099-01-01', estado: 'activa' }; S.mem.push({ org: id, user: yo().id, rol: 'admin', activo: true, vence: null, permisos: {}, nombre: null }); notificar(null, true, 'Nueva organización: ' + a.p_org, yo().email); return id; },
      vigia_miembros_listar: a => { if (!esAdmin(a.p_org)) throw 'Sólo el administrador puede ver el equipo'; return S.mem.filter(m => m.org === a.p_org).map(m => ({ user_id: m.user, email: Object.values(S.users).find(u => u.id === m.user).email, nombre: m.nombre, rol: m.rol, activo: m.activo, licencia_vence: m.vence, permisos: m.permisos, propietario: S.orgs[m.org].por === m.user, creado_en: new Date().toISOString(), ultimo_ingreso: null, tiene_2fa: !!Object.values(S.users).find(u => u.id === m.user).factor })); },
      vigia_miembro_agregar: a => { if (!esAdmin(a.p_org)) throw 'Sólo el administrador de la organización puede agregar miembros'; const u = S.users[a.p_email.toLowerCase()]; if (!u) throw 'Ese correo aún no está registrado. Pídele que abra la pestaña «Soy del equipo» y cree su cuenta.'; if (S.mem.filter(m => m.org === a.p_org).length >= S.orgs[a.p_org].maxU) throw 'La licencia de la organización permite ' + S.orgs[a.p_org].maxU + ' usuarios y ya están ocupados.'; S.mem.push({ org: a.p_org, user: u.id, rol: a.p_rol, activo: true, vence: null, permisos: {}, nombre: a.p_nombre }); S.ev.push({ org_id: a.p_org, actor_email: yo().email, accion: 'miembro.agregar', detalle: { email: u.email, rol: a.p_rol }, en: new Date().toISOString() }); return u.id; },
      vigia_miembro_actualizar: a => { if (!esAdmin(a.p_org)) throw 'Sólo el administrador puede cambiar roles, permisos y licencias'; const m = S.mem.find(x => x.org === a.p_org && x.user === a.p_user); if (m.rol === 'admin' && ((a.p_rol && a.p_rol !== 'admin') || a.p_activo === false) && !S.mem.some(x => x.org === a.p_org && x.rol === 'admin' && x.activo && x.user !== a.p_user)) throw 'No se puede dejar a la organización sin administrador activo'; if (a.p_rol) m.rol = a.p_rol; if (a.p_activo != null) m.activo = a.p_activo; if (a.p_sin_vencimiento) m.vence = null; else if (a.p_vence) m.vence = a.p_vence; if (a.p_permisos) m.permisos = a.p_permisos; S.ev.push({ org_id: a.p_org, actor_email: yo().email, accion: 'miembro.actualizar', detalle: { rol: a.p_rol, activo: a.p_activo }, en: new Date().toISOString() }); },
      vigia_miembro_quitar: a => { if (!esAdmin(a.p_org)) throw 'no'; S.mem = S.mem.filter(x => !(x.org === a.p_org && x.user === a.p_user)); },
      vigia_miembro_clave_temporal: a => { if (!esAdmin(a.p_org)) throw 'no'; const u = Object.values(S.users).find(x => x.id === a.p_user); u.pw = 'Vg-temporal123-7'; u.temp = true; return u.pw; },
      vigia_orgs_plataforma: () => { if (!esPlat()) throw 'Sólo el administrador de la plataforma'; return Object.values(S.orgs).map(o => ({ org_id: o.id, nombre: o.nombre, plan: o.plan, max_usuarios: o.maxU, max_camaras: o.maxC, licencia_vence: o.vence, licencia_estado: o.estado, usuarios: S.mem.filter(m => m.org === o.id).length, propietario: Object.values(S.users).find(u => u.id === o.por).email, creado_en: new Date().toISOString(), requiere_2fa: !!o.req2fa })); },
      vigia_org_licencia: a => { if (!esPlat()) throw 'Sólo el administrador de la plataforma puede cambiar la licencia de una organización'; const o = S.orgs[a.p_org]; o.plan = a.p_plan; o.maxU = a.p_max_usuarios; o.maxC = a.p_max_camaras; o.vence = a.p_vence; o.estado = a.p_estado; S.mem.filter(m => m.org === o.id && m.rol === 'admin').forEach(m => notificar(m.user, false, 'La licencia de ' + o.nombre + ' fue actualizada', '')); },
      vigia_org_requerir_2fa: a => { if (!esAdmin(a.p_org)) throw 'no'; S.orgs[a.p_org].req2fa = a.p_requerir; },
      vigia_solicitud_crear: a => { if (!esAdmin(a.p_org)) throw 'Sólo el administrador de la organización puede enviar solicitudes a la plataforma'; const id = S.sol.length + 1; S.sol.push({ id, org_id: a.p_org, solicitante: yo().id, solicitante_email: yo().email, tipo: a.p_tipo, cantidad: a.p_cantidad, mensaje: a.p_mensaje, estado: 'pendiente', respuesta: null, resuelta_por: null, creada_en: new Date().toISOString(), resuelta_en: null }); notificar(null, true, 'Solicitud #' + id, a.p_tipo); return id; },
      vigia_solicitud_resolver: a => { if (!esPlat()) throw 'Sólo el administrador de la plataforma resuelve solicitudes'; const x = S.sol.find(q => q.id === a.p_id); if (x.estado !== 'pendiente') throw 'La solicitud ya fue resuelta'; x.estado = a.p_estado; x.respuesta = a.p_respuesta; x.resuelta_por = yo().email; x.resuelta_en = new Date().toISOString(); notificar(x.solicitante, false, 'Tu solicitud #' + x.id + ' fue ' + a.p_estado, a.p_respuesta || ''); },
      vigia_notificaciones_marcar: () => { S.notif.forEach(n => { if (n.destinatario === yo().id || (n.para_plataforma && esPlat())) n.leida_en = new Date().toISOString(); }); },
      vigia_plataforma_resumen: () => { if (!esPlat()) throw 'Sólo el administrador de la plataforma'; const us = Object.values(S.users); return [{ organizaciones: Object.keys(S.orgs).length, org_vigentes: Object.keys(S.orgs).length, org_por_vencer: 0, cuentas: us.length, cuentas_sin_confirmar: us.filter(u => !u.confirmado).length, cuentas_sin_organizacion: us.filter(u => !S.mem.some(m => m.user === u.id)).length, miembros_activos: S.mem.filter(m => m.activo).length, con_2fa: us.filter(u => u.factor).length, solicitudes_pendientes: S.sol.filter(x => x.estado === 'pendiente').length, notificaciones_sin_leer: S.notif.filter(n => n.para_plataforma && !n.leida_en).length }]; },
      vigia_plataforma_cuentas: () => { if (!esPlat()) throw 'Sólo el administrador de la plataforma'; return Object.values(S.users).map(u => ({ user_id: u.id, email: u.email, confirmada: u.confirmado, creada_en: new Date().toISOString(), ultimo_ingreso: null, tiene_2fa: !!u.factor, organizaciones: S.mem.filter(m => m.user === u.id).map(m => S.orgs[m.org].nombre + ' (' + m.rol + ')').join(' · '), es_plataforma: u.email === 'plataforma@vigia.test' })); },
      vigia_plataforma_confirmar_cuenta: a => { if (!esPlat()) throw 'no'; Object.values(S.users).find(u => u.id === a.p_user).confirmado = true; },
      vigia_solicitar_restablecimiento: a => { const u = S.users[a.p_email]; if (u) S.mem.filter(m => m.user === u.id).forEach(m => S.mem.filter(x => x.org === m.org && x.rol === 'admin').forEach(x => notificar(x.user, false, 'Solicitud de restablecimiento de acceso', a.p_email))); }
    };
    V.cloud.client = {
      auth: {
        getSession: async () => okr({ session: yo() ? { user: yo().pub } : null }),
        signUp: async ({ email, password, options }) => { email = email.toLowerCase(); if (S.users[email]) return okr({ user: { identities: [] }, session: null }); const id = uid(); S.users[email] = { id, email, pw: password, confirmado: false, pub: { id, email, user_metadata: options.data || {}, identities: [{}] } }; notificar(null, true, 'Nueva cuenta registrada: ' + email, ''); return okr({ user: S.users[email].pub, session: null }); },
        signInWithPassword: async ({ email, password }) => { const u = S.users[email.toLowerCase()]; if (!u || u.pw !== password) return err('Invalid login credentials'); if (!u.confirmado) return err('Email not confirmed'); S.ses = u.email; S.aal = 'aal1'; return okr({ user: u.pub }); },
        signOut: async () => { S.ses = null; return okr(null); },
        updateUser: async ({ password }) => { yo().pw = password; yo().temp = false; return okr({}); },
        resend: async () => okr({}), resetPasswordForEmail: async () => okr({}),
        mfa: {
          listFactors: async () => { const f = yo().factor ? [Object.assign({ factor_type: 'totp', created_at: new Date().toISOString() }, yo().factor)] : []; return okr({ totp: f.filter(x => x.status === 'verified'), all: f }); },
          getAuthenticatorAssuranceLevel: async () => okr({ currentLevel: S.aal, nextLevel: yo().factor && yo().factor.status === 'verified' ? 'aal2' : 'aal1' }),
          enroll: async () => { yo().factor = { id: 'f_' + yo().id, status: 'unverified' }; return okr({ id: yo().factor.id, totp: { qr_code: 'data:image/svg+xml;utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>'), secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/VIGIA' } }); },
          challengeAndVerify: async ({ code }) => { if (code !== '123456') return err('Invalid TOTP code entered'); yo().factor.status = 'verified'; S.aal = 'aal2'; return okr({}); },
          unenroll: async () => { yo().factor = null; return okr({}); }
        }
      },
      rpc: async (fn, args) => { try { if (!yo() && fn !== 'vigia_solicitar_restablecimiento') throw 'no autenticado'; if (!RPC[fn]) throw 'Could not find the function public.' + fn; return okr(RPC[fn](args)); } catch (e) { return err(String(e.message || e)); } },
      from: t => { const fl = []; const q = { select: () => q, eq: (c, v) => { fl.push([c, v]); return q; }, order: () => q, limit: () => q, then: (res, rej) => { let rows = t === 'vigia_admin_eventos' ? S.ev.slice().reverse() : t === 'vigia_solicitudes' ? S.sol.filter(x => esPlat() || x.solicitante === yo().id || esAdmin(x.org_id)).slice().reverse() : t === 'vigia_notificaciones' ? S.notif.filter(n => n.destinatario === yo().id || (n.para_plataforma && esPlat())).slice().reverse() : []; fl.forEach(([c, v]) => { rows = rows.filter(r => r[c] === v); }); return Promise.resolve(okr(rows)).then(res, rej); } }; return q; }
    };
    V.app.renderLogin();
  });
  await p.waitForSelector('.acceso [data-tab=propietario]');
  ok(await p.locator('.acceso [data-tab]').allTextContents().then(t => t.join('|') === 'Ingresar|Registrar propietario|Soy del equipo'), 'pantalla de acceso con tres pestañas');
  const confirmar = email => p.evaluate(e => { window.__S.users[e].confirmado = true; }, email);
  const registrar = async (tab, email, pw, org, sede) => { await p.click(`.acceso [data-tab=${tab}]`); if (org) { await p.fill('#aorg', org); await p.fill('#asede', sede); } await p.fill('#aemail', email); await p.fill('#apw', pw); await p.click('#ago'); await p.waitForFunction(() => /Cuenta creada/.test(document.querySelector('#amsg').textContent)); };
  const entrar = async (email, pw) => { await p.click('.acceso [data-tab=ingresar]'); await p.fill('#aemail', email); await p.fill('#apw', pw); await p.click('#ago'); };
  const salir = async () => { await p.click('#lo'); await p.waitForSelector('.acceso'); };
  // propietario
  await p.click('.acceso [data-tab=propietario]'); await shot('01_registrar_propietario');
  await registrar('propietario', 'dueno@club.test', 'ClaveSegura1', 'Club de Prueba', 'Sede principal');
  ok(/confirmación/.test(await p.textContent('#amsg')), 'propietario: cuenta creada, pide confirmar el correo');
  await entrar('dueno@club.test', 'ClaveSegura1'); await p.waitForFunction(() => /confirmado/.test(document.querySelector('#amsg').textContent));
  ok(await p.isVisible('#aresend'), 'sin confirmar no entra y ofrece reenviar el correo');
  await confirmar('dueno@club.test'); await entrar('dueno@club.test', 'ClaveSegura1'); await p.waitForSelector('.shell');
  ok((await p.textContent('#nav')).includes('Club de Prueba') && (await p.textContent('#nav')).includes('Administrador'), 'primer ingreso: organización creada y propietario como administrador');
  // equipo
  await salir(); await p.click('.acceso [data-tab=equipo]'); await shot('02_soy_del_equipo');
  await registrar('equipo', 'operador@club.test', 'ClaveSegura2'); await confirmar('operador@club.test');
  await entrar('operador@club.test', 'ClaveSegura2'); await p.waitForFunction(() => /aún no perteneces/.test(document.querySelector('#amsg').textContent));
  ok(true, 'miembro sin organización: se le indica avisar al administrador');
  await p.evaluate(() => V.cloud.salir());
  await registrar('equipo', 'directivo@club.test', 'ClaveSegura3'); await confirmar('directivo@club.test');
  await registrar('equipo', 'extra@club.test', 'ClaveSegura4'); await confirmar('extra@club.test');
  // administración
  await entrar('dueno@club.test', 'ClaveSegura1'); await p.waitForSelector('.shell');
  await p.click('[data-nav=admin]'); await p.click('#atabs [data-t=usuarios]'); await p.waitForSelector('#umadd');
  await p.fill('#umail', 'nadie@club.test'); await p.click('#umadd button.pri'); await p.waitForSelector('text=aún no está registrado');
  ok(true, 'agregar un correo sin cuenta se rechaza con la instrucción correcta');
  await p.waitForSelector('#umadd'); await p.fill('#umail', 'operador@club.test'); await p.selectOption('#urol', 'operador'); await p.click('#umadd button.pri'); await p.waitForSelector('text=Miembro agregado');
  await p.waitForSelector('tr[data-u] >> nth=1'); await p.fill('#umail', 'directivo@club.test'); await p.selectOption('#urol', 'directivo'); await p.click('#umadd button.pri'); await p.waitForFunction(() => document.querySelectorAll('tr[data-u]').length === 3);
  ok(await p.isDisabled('#umadd button.pri') && /Cupo de la licencia agotado/.test(await p.textContent('#umadd')), 'cupo de usuarios de la licencia (3) aplicado');
  await p.waitForTimeout(300); await shot('03_usuarios_roles_licencias');
  const fila = email => p.locator('tr[data-u]', { hasText: email });
  await fila('operador@club.test').locator('[data-c=rol]').selectOption('supervisor'); await p.waitForSelector('text=Rol actualizado: Supervisor');
  ok(true, 'cambio de rol desde la tabla');
  await p.waitForTimeout(400); await fila('operador@club.test').locator('[data-c=permisos]').click(); await p.waitForSelector('.modal [data-p]');
  await p.selectOption('.modal [data-p="evidencia.descargar"]', '0'); await p.selectOption('.modal [data-p="admin.politicas"]', '1'); await shot('04_permisos_individuales'); await p.click('.modal .btn.pri'); await p.waitForSelector('text=Permisos guardados');
  await p.waitForFunction(() => /2 excepción/.test(document.querySelector('#abody').textContent)); ok(true, 'permisos individuales: 1 concedido y 1 denegado');
  await p.waitForTimeout(400); await fila('dueno@club.test').locator('[data-c=activo]').click(); await p.waitForSelector('text=sin administrador activo');
  ok(true, 'no se puede suspender al único administrador');
  await p.waitForTimeout(400); await fila('directivo@club.test').locator('[data-c=activo]').click(); await p.waitForSelector('text=Licencia suspendida');
  await p.waitForTimeout(400); await fila('operador@club.test').locator('[data-c=clave]').click(); await p.click('.modal .btn.pri'); await p.waitForSelector('#ctpw');
  const temporal = await p.textContent('#ctpw'); ok(/^Vg-/.test(temporal), 'clave temporal generada y mostrada una sola vez'); await p.click('.modal .btn.pri');
  await p.waitForFunction(() => /miembro\.actualizar/.test(document.querySelector('#abody').textContent)); ok(true, 'registro de cambios de administración visible');
  // el supervisor entra con la clave temporal, debe cambiarla y recibe sus permisos individuales
  await salir(); await entrar('operador@club.test', temporal); await p.waitForSelector('#nc1'); await p.fill('#nc1', 'MiClaveNueva9'); await p.fill('#nc2', 'MiClaveNueva9'); await p.click('.modal .btn.pri'); await p.waitForSelector('.shell');
  const per = await p.evaluate(() => ({ rol: V.app.session.rol, descarga: V.app.api.can(V.app.token, 'evidencia.descargar'), politicas: V.app.api.can(V.app.token, 'admin.politicas'), usuarios: V.app.api.can(V.app.token, 'admin.usuarios'), confirmar: V.app.api.can(V.app.token, 'incidentes.confirmar') }));
  ok(per.rol === 'supervisor' && per.descarga === false && per.politicas === true && per.usuarios === false && per.confirmar === true, 'clave temporal → cambio obligatorio → rol supervisor con excepciones aplicadas en la API');
  const lim = await p.evaluate(async () => { const a = V.app.api, t = V.app.token; await a.saveCamera(t, { nombre: 'C1', tipo: 'archivo' }); await a.saveCamera(t, { nombre: 'C2', tipo: 'archivo' }); try { await a.saveCamera(t, { nombre: 'C3', tipo: 'archivo' }); return 'sin límite'; } catch (e) { return e.code; } });
  ok(lim === 'LICENCIA', 'límite de cámaras de la licencia (2) aplicado');
  await p.click('[data-nav=admin]'); await p.click('#atabs [data-t=usuarios]'); await p.waitForSelector('text=no permite gestionar usuarios'); ok(true, 'un supervisor no ve la administración de usuarios');
  // licencia suspendida: no entra
  await salir(); await entrar('directivo@club.test', 'ClaveSegura3'); await p.waitForFunction(() => /suspendida/.test(document.querySelector('#amsg').textContent));
  ok(!(await p.isVisible('.shell')), 'usuario con licencia suspendida no puede ingresar'); await shot('05_licencia_suspendida');
  // aislamiento local: otra organización en el mismo navegador no ve las cámaras
  await p.evaluate(() => V.cloud.salir()); await registrar('propietario', 'otro@empresa.test', 'ClaveSegura5', 'Otra Empresa', 'Central'); await confirmar('otro@empresa.test'); await entrar('otro@empresa.test', 'ClaveSegura5'); await p.waitForSelector('.shell');
  ok(await p.evaluate(async () => (await V.app.api.listCameras(V.app.token)).length) === 0, 'otra organización en el mismo navegador no ve las cámaras de la primera');
  // ---- solicitud a la plataforma (administrador de la organización)
  await salir(); await entrar('dueno@club.test', 'ClaveSegura1'); await p.waitForSelector('.shell');
  await p.click('[data-nav=admin]'); await p.click('#atabs [data-t=usuarios]'); await p.waitForSelector('#usol');
  ok(!(await p.isVisible('#atabs [data-t=plataforma]')), 'un administrador de organización no ve la pestaña Plataforma');
  await p.selectOption('#ust', 'ampliar_usuarios'); await p.fill('#usc', '5'); await p.fill('#usm', 'Necesitamos 5 operadores más'); await p.click('#usol button.pri'); await p.waitForSelector('text=Solicitud #1 enviada');
  await p.waitForFunction(() => /pendiente/.test((document.querySelector('#uextra') || {}).textContent || '')); ok(true, 'solicitud de ampliación enviada a la plataforma');
  // ---- administrador de la plataforma: doble factor obligatorio, solicitudes, licencias y cuentas
  await salir(); await registrar('propietario', 'plataforma@vigia.test', 'ClavePlataforma1', 'VIGÍA Plataforma', 'Central'); await confirmar('plataforma@vigia.test');
  await entrar('plataforma@vigia.test', 'ClavePlataforma1'); await p.waitForSelector('.modal img[alt^="Código QR"]'); await shot('06_activar_doble_factor');
  await p.fill('#mfc', '000000'); await p.click('.modal .btn.pri'); await p.waitForSelector('text=El código no es correcto');
  await p.waitForSelector('#mfc'); await p.fill('#mfc', '123456'); await p.click('.modal .btn.pri'); await p.waitForSelector('.shell');
  ok(true, 'administrador de la plataforma: doble factor obligatorio (código errado rechazado, correcto aceptado)');
  await p.waitForFunction(() => { const n = document.querySelector('#npill'); return n && /[1-9]/.test(n.textContent); }); ok(true, 'bandeja de notificaciones con avisos sin leer (cuentas nuevas, organizaciones, solicitudes)');
  await p.click('[data-nav=admin]'); await p.click('#atabs [data-t=plataforma]'); await p.waitForSelector('[data-sol]'); await p.waitForTimeout(300); await shot('07_plataforma');
  const kp = await p.$$eval('#abody .kpi', e => e.map(x => x.innerText.replace(/\n/g, ' '))); console.log('   ', kp.join(' | '));
  ok(/Organizaciones 3/.test(kp[0]) && /Solicitudes pendientes 1/.test(kp[4]), 'panel de la plataforma: 3 organizaciones y 1 solicitud pendiente');
  await p.click('[data-sol][data-e=aprobada]'); await p.fill('#srp', 'Aprobado: 5 usuarios adicionales'); await p.click('.modal .btn.pri'); await p.waitForSelector('#lmu');
  ok(await p.inputValue('#lmu') === '8', 'al aprobar se abre la licencia con el cupo sugerido (3 + 5 = 8)');
  await p.selectOption('#lpl', 'profesional'); await p.click('.modal .btn.pri'); await p.waitForSelector('text=Licencia actualizada');
  await p.waitForFunction(() => /3 \/ 8/.test(document.querySelector('#abody').textContent)); ok(true, 'licencia de la organización ampliada a 8 usuarios, plan Profesional');
  await p.evaluate(() => V.cloud.client.auth.signUp({ email: 'nuevo@club.test', password: 'ClaveSegura9', options: {} }));
  await p.click('#atabs [data-t=plataforma]'); await p.waitForSelector('[data-conf]'); await p.click('[data-conf]'); await p.click('.modal .btn.pri'); await p.waitForSelector('text=Cuenta confirmada');
  ok(await p.evaluate(() => window.__S.users['nuevo@club.test'].confirmado), 'la plataforma confirma manualmente una cuenta');
  await p.click('#atabs [data-t=cuenta]'); await p.waitForSelector('#cpw'); ok(/activa/.test(await p.textContent('#abody')) && await p.isDisabled('#c2off'), 'mi cuenta: doble factor activo y obligatorio para la plataforma'); await shot('08_mi_cuenta_seguridad');
  // reingreso: pide el código
  await salir(); await entrar('plataforma@vigia.test', 'ClavePlataforma1'); await p.waitForSelector('#mfc'); await p.fill('#mfc', '123456'); await p.click('.modal .btn.pri'); await p.waitForSelector('.shell'); ok(true, 'reingreso con contraseña + código de 6 dígitos');
  // el dueño recibe la respuesta y ve el nuevo cupo; exige 2FA al equipo
  await salir(); await entrar('dueno@club.test', 'ClaveSegura1'); await p.waitForSelector('.shell'); await p.waitForFunction(() => { const n = document.querySelector('#npill'); return n && /[1-9]/.test(n.textContent); });
  await p.click('#npill'); await p.waitForSelector('text=Tu solicitud #1 fue aprobada'); ok(true, 'el solicitante recibe la respuesta en sus notificaciones'); await p.click('.modal [data-x]');
  await p.click('[data-nav=admin]'); await p.click('#atabs [data-t=usuarios]'); await p.waitForSelector('#u2fa'); await p.check('#u2fa'); await p.waitForSelector('text=Doble factor obligatorio para el equipo');
  await salir(); await entrar('operador@club.test', 'MiClaveNueva9'); await p.waitForSelector('.modal img[alt^="Código QR"]'); await p.fill('#mfc', '123456'); await p.click('.modal .btn.pri'); await p.waitForSelector('.shell'); ok(true, 'la organización exige doble factor: el miembro lo configura al ingresar');
  // olvidé mi contraseña: aviso al administrador
  await salir(); await p.fill('#aemail', 'operador@club.test'); await p.click('#aforgot'); await p.waitForFunction(() => /avisamos a tu administrador/.test(document.querySelector('#amsg').textContent));
  ok(await p.evaluate(() => window.__S.notif.some(n => n.titulo === 'Solicitud de restablecimiento de acceso')), 'olvidé mi contraseña: enlace por correo y aviso al administrador');
  // modo demostración local sigue disponible
  await p.click('details summary'); await p.click('#tlocal'); await p.waitForSelector('#boot'); ok(true, 'demostración local sin cuenta sigue disponible');
  console.log('\nAcceso y administración verificados.');
} catch (e) { console.error(e.message); await shot('error'); process.exitCode = 1; }
if (errs.length) { console.log('Errores:\n' + errs.join('\n')); process.exitCode = 1; }
await b.close();
