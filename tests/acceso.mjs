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
    const S = window.__S = { users: {}, orgs: {}, mem: [], ev: [], ses: null, n: 0 };
    const uid = () => '00000000-0000-4000-8000-' + String(++S.n).padStart(12, '0');
    const err = m => ({ data: null, error: { message: m } }); const okr = d => ({ data: d, error: null });
    const yo = () => S.ses && S.users[S.ses]; const hoy = () => new Date().toISOString().slice(0, 10);
    const esAdmin = org => S.mem.some(m => m.org === org && m.user === yo().id && m.rol === 'admin' && m.activo && (!m.vence || m.vence >= hoy()));
    const RPC = {
      vigia_mi_acceso: () => S.mem.filter(m => m.user === yo().id).map(m => { const o = S.orgs[m.org]; return { org_id: o.id, org_nombre: o.nombre, sede_inicial: o.sede, rol: m.rol, activo: m.activo, licencia_vence: m.vence, permisos: m.permisos, nombre: m.nombre, plan: o.plan, max_usuarios: o.maxU, max_camaras: o.maxC, org_vence: o.vence, org_estado: o.estado, usuarios: S.mem.filter(x => x.org === o.id).length, propietario: o.por === m.user, es_plataforma: yo().email === 'plataforma@vigia.test', debe_cambiar_clave: !!yo().temp }; }),
      vigia_registrar_propietario: a => { if (Object.values(S.orgs).some(o => o.por === yo().id)) throw 'Esta cuenta ya es propietaria de una organización'; const id = uid(); S.orgs[id] = { id, nombre: a.p_org, sede: a.p_sede, por: yo().id, plan: 'prueba', maxU: 3, maxC: 2, vence: '2099-01-01', estado: 'activa' }; S.mem.push({ org: id, user: yo().id, rol: 'admin', activo: true, vence: null, permisos: {}, nombre: null }); return id; },
      vigia_miembros_listar: a => { if (!esAdmin(a.p_org)) throw 'Sólo el administrador puede ver el equipo'; return S.mem.filter(m => m.org === a.p_org).map(m => ({ user_id: m.user, email: Object.values(S.users).find(u => u.id === m.user).email, nombre: m.nombre, rol: m.rol, activo: m.activo, licencia_vence: m.vence, permisos: m.permisos, propietario: S.orgs[m.org].por === m.user, creado_en: new Date().toISOString(), ultimo_ingreso: null })); },
      vigia_miembro_agregar: a => { if (!esAdmin(a.p_org)) throw 'Sólo el administrador de la organización puede agregar miembros'; const u = S.users[a.p_email.toLowerCase()]; if (!u) throw 'Ese correo aún no está registrado. Pídele que abra la pestaña «Soy del equipo» y cree su cuenta.'; if (S.mem.filter(m => m.org === a.p_org).length >= S.orgs[a.p_org].maxU) throw 'La licencia de la organización permite ' + S.orgs[a.p_org].maxU + ' usuarios y ya están ocupados.'; S.mem.push({ org: a.p_org, user: u.id, rol: a.p_rol, activo: true, vence: null, permisos: {}, nombre: a.p_nombre }); S.ev.push({ org_id: a.p_org, actor_email: yo().email, accion: 'miembro.agregar', detalle: { email: u.email, rol: a.p_rol }, en: new Date().toISOString() }); return u.id; },
      vigia_miembro_actualizar: a => { if (!esAdmin(a.p_org)) throw 'Sólo el administrador puede cambiar roles, permisos y licencias'; const m = S.mem.find(x => x.org === a.p_org && x.user === a.p_user); if (m.rol === 'admin' && ((a.p_rol && a.p_rol !== 'admin') || a.p_activo === false) && !S.mem.some(x => x.org === a.p_org && x.rol === 'admin' && x.activo && x.user !== a.p_user)) throw 'No se puede dejar a la organización sin administrador activo'; if (a.p_rol) m.rol = a.p_rol; if (a.p_activo != null) m.activo = a.p_activo; if (a.p_sin_vencimiento) m.vence = null; else if (a.p_vence) m.vence = a.p_vence; if (a.p_permisos) m.permisos = a.p_permisos; S.ev.push({ org_id: a.p_org, actor_email: yo().email, accion: 'miembro.actualizar', detalle: { rol: a.p_rol, activo: a.p_activo }, en: new Date().toISOString() }); },
      vigia_miembro_quitar: a => { if (!esAdmin(a.p_org)) throw 'no'; S.mem = S.mem.filter(x => !(x.org === a.p_org && x.user === a.p_user)); },
      vigia_miembro_clave_temporal: a => { if (!esAdmin(a.p_org)) throw 'no'; const u = Object.values(S.users).find(x => x.id === a.p_user); u.pw = 'Vg-temporal123-7'; u.temp = true; return u.pw; },
      vigia_orgs_plataforma: () => { throw 'Sólo el administrador de la plataforma'; }
    };
    V.cloud.client = {
      auth: {
        getSession: async () => okr({ session: yo() ? { user: yo().pub } : null }),
        signUp: async ({ email, password, options }) => { email = email.toLowerCase(); if (S.users[email]) return okr({ user: { identities: [] }, session: null }); const id = uid(); S.users[email] = { id, email, pw: password, confirmado: false, pub: { id, email, user_metadata: options.data || {}, identities: [{}] } }; return okr({ user: S.users[email].pub, session: null }); },
        signInWithPassword: async ({ email, password }) => { const u = S.users[email.toLowerCase()]; if (!u || u.pw !== password) return err('Invalid login credentials'); if (!u.confirmado) return err('Email not confirmed'); S.ses = u.email; return okr({ user: u.pub }); },
        signOut: async () => { S.ses = null; return okr(null); },
        updateUser: async ({ password }) => { yo().pw = password; yo().temp = false; return okr({}); },
        resend: async () => okr({}), resetPasswordForEmail: async () => okr({})
      },
      rpc: async (fn, args) => { try { if (!yo()) throw 'no autenticado'; return okr(RPC[fn](args)); } catch (e) { return err(String(e.message || e)); } },
      from: t => ({ select: () => ({ eq: (c, v) => ({ order: () => ({ limit: async () => okr(t === 'vigia_admin_eventos' ? S.ev.filter(e => e.org_id === v).slice().reverse() : []) }) }) }) })
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
  // modo demostración local sigue disponible
  await salir(); await p.click('details summary'); await p.click('#tlocal'); await p.waitForSelector('#boot'); ok(true, 'demostración local sin cuenta sigue disponible');
  console.log('\nAcceso y administración verificados.');
} catch (e) { console.error(e.message); await shot('error'); process.exitCode = 1; }
if (errs.length) { console.log('Errores:\n' + errs.join('\n')); process.exitCode = 1; }
await b.close();
