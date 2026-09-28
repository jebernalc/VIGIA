/* VIGÍA · api.js — "API v1" interna. ÚNICA puerta de acceso a los datos.
 * Todas las operaciones reciben un token de sesión; la organización y el rol se obtienen del
 * servidor de sesiones (aquí, en memoria) y NUNCA de parámetros enviados por la interfaz.
 * Cada lectura/escritura comprueba organización (aislamiento multicliente) y permiso de rol.
 * Registros de otra organización se reportan como NO_ENCONTRADO (no se revela su existencia).
 * La auditoría es encadenada por hash (SHA-256) por organización para detectar alteraciones. */
(function () {
  'use strict';
  const V = window.V;

  class VigiaError extends Error {
    constructor(code, message, detail) { super(message); this.code = code; this.detail = detail || null; this.name = 'VigiaError'; }
    toJSON() { return { error: { codigo: this.code, mensaje: this.message, detalle: this.detail } }; }
  }
  V.VigiaError = VigiaError;
  const E = (code, msg, d) => new VigiaError(code, msg, d);

  // ---------- roles y permisos ----------
  const ROLES = {
    operador: 'Operador de monitoreo', supervisor: 'Supervisor', investigador: 'Investigador',
    admin: 'Administrador institucional', directivo: 'Directivo'
  };
  const PERMS = {
    'camaras.ver': ['operador', 'supervisor', 'investigador', 'admin', 'directivo'],
    'camaras.gestionar': ['supervisor', 'admin'],
    'grabaciones.cargar': ['operador', 'supervisor', 'investigador', 'admin'],
    'medios.ver': ['operador', 'supervisor', 'investigador', 'admin'],
    'evidencia.descargar': ['supervisor', 'investigador', 'admin'],
    'clips.crear': ['operador', 'supervisor', 'investigador', 'admin'],
    'hallazgos.revisar': ['operador', 'supervisor', 'investigador', 'admin'],
    'incidentes.confirmar': ['supervisor', 'investigador', 'admin'],
    'expedientes.ver': ['operador', 'supervisor', 'investigador', 'admin', 'directivo'],
    'expedientes.crear': ['operador', 'supervisor', 'investigador', 'admin'],
    'informes.aprobar': ['supervisor', 'admin'],
    'reglas.crear': ['operador', 'supervisor', 'admin'],
    'vivo.usar': ['operador', 'supervisor', 'investigador', 'admin'],
    'alarmas.gestionar': ['operador', 'supervisor', 'investigador', 'admin'],
    'auditoria.ver': ['supervisor', 'admin'],
    'admin.usuarios': ['admin'],
    'admin.politicas': ['admin'],
    'indicadores.ver': ['operador', 'supervisor', 'investigador', 'admin', 'directivo'],
    'chat.usar': ['operador', 'supervisor', 'investigador', 'admin', 'directivo'],
    'chats.ver_todos': ['supervisor', 'admin'],
    'grabaciones.eliminar': ['admin']
  };
  V.ROLES = ROLES; V.PERMS = PERMS;
  V.can = (rol, perm) => !!(PERMS[perm] && PERMS[perm].includes(rol));

  const CFG = Object.assign({
    maxUploadMB: 2048,            // límite de carga por archivo
    maxIntervaloConsultaH: 24,    // ventana máxima de consulta
    maxClipS: 600,                // duración máxima de clip
    sesionHoras: 8,
    urlTTLmin: 10,                // caducidad de URLs de medios
    pbkdf2Iter: 150000,
    demoPasswords: null           // opcional: {'admin@norte.demo': '...'} desde vigia.config.js
  }, window.VIGIA_CONFIG || {});
  V.CFG = CFG;

  const CLASES_ES = {
    person: 'persona', car: 'automóvil', truck: 'camión', bus: 'bus', motorcycle: 'motocicleta', bicycle: 'bicicleta',
    cat: 'gato', dog: 'perro', backpack: 'mochila', handbag: 'bolso', suitcase: 'maleta', movimiento: 'movimiento (sin clasificar)'
  };
  V.CLASES_ES = CLASES_ES;
  V.claseEs = c => CLASES_ES[c] || c;
  V.GRUPOS_CLASE = { persona: ['person'], vehiculo: ['car', 'truck', 'bus', 'motorcycle', 'bicycle'], animal: ['cat', 'dog', 'bird', 'horse'], movimiento: ['movimiento'], objeto: ['backpack', 'handbag', 'suitcase'] };

  async function pbkdf2(pass, saltHex, iter) {
    const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
    return V.toHex(bits);
  }
  function ctEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

  const R01 = r => ({ x: V.clamp(+r.x || 0, 0, 1), y: V.clamp(+r.y || 0, 0, 1), w: V.clamp(+r.w || 0, 0, 1), h: V.clamp(+r.h || 0, 0, 1) });
  const P01 = p => ({ x: V.clamp(+p.x || 0, 0, 1), y: V.clamp(+p.y || 0, 0, 1) });
  const txt = (s, n) => String(s || '').slice(0, n || 60);
  const num = (v, a, b, d) => { v = +v; return isFinite(v) ? V.clamp(v, a, b) : d; };
  /** Valida y normaliza la configuración de analítica de una cámara (zonas, líneas, puertas, parámetros). */
  function validarAnalitica(a) {
    if (!a) return null;
    const USOS = ['restringida', 'no_parqueo', 'ocupacion', 'general'];
    const zonas = (Array.isArray(a.zonas) ? a.zonas : []).slice(0, 20).map((z, i) => {
      if (!USOS.includes(z.uso)) throw E('VALIDACION', 'Uso de zona inválido: ' + z.uso);
      return { id: txt(z.id || 'z' + i, 30), nombre: txt(z.nombre || 'Zona ' + (i + 1)), uso: z.uso, rect: R01(z.rect || {}), horario: z.horario ? V.horario.validar(z.horario) : undefined, umbral: z.umbral != null ? num(z.umbral, 1, 500, 5) : undefined, merodeoS: z.merodeoS != null ? num(z.merodeoS, 3, 3600, 20) : undefined, parqueoS: z.parqueoS != null ? num(z.parqueoS, 5, 86400, 30) : undefined };
    });
    const lineas = (Array.isArray(a.lineas) ? a.lineas : []).slice(0, 10).map((l, i) => ({ id: txt(l.id || 'l' + i, 30), nombre: txt(l.nombre || 'Línea ' + (i + 1)), a: P01(l.a || {}), b: P01(l.b || {}), sentidoEntrada: +l.sentidoEntrada === -1 ? -1 : 1, clase: ['persona', 'vehiculo'].includes(l.clase) ? l.clase : undefined }));
    const puertas = (Array.isArray(a.puertas) ? a.puertas : []).slice(0, 10).map((p, i) => ({ id: txt(p.id || 'p' + i, 30), nombre: txt(p.nombre || 'Puerta ' + (i + 1)), rect: R01(p.rect || {}), puertaS: p.puertaS != null ? num(p.puertaS, 1, 86400, 10) : undefined, umbral: p.umbral != null ? num(p.umbral, 0.05, 0.95, 0.5) : undefined }));
    const pd = (V.analitica && V.analitica.PARAM_DEF) || {}; const pa = a.parametros || {};
    const parametros = {}; Object.keys(pd).forEach(k => parametros[k] = pa[k] != null ? num(pa[k], 0, 86400, pd[k]) : pd[k]);
    return { zonas, lineas, puertas, parametros };
  }
  V.validarAnalitica = validarAnalitica;

  class Api {
    constructor(db, opts) {
      this.db = db; this.sessions = new Map(); this.fails = new Map(); this.urls = new Map();
      this.opts = Object.assign({ pbkdf2Iter: CFG.pbkdf2Iter }, opts || {});
      this._auditLock = Promise.resolve();
    }

    // =============== sesión ===============
    _ctx(token) {
      const s = this.sessions.get(token);
      if (!s) throw E('NO_AUTENTICADO', 'Sesión no válida. Inicie sesión de nuevo.');
      if (Date.now() > s.exp) { this.sessions.delete(token); throw E('SESION_EXPIRADA', 'La sesión expiró.'); }
      return s;
    }
    _need(ctx, perm) { if (!V.can(ctx.rol, perm)) throw E('PROHIBIDO', 'Su rol (' + ROLES[ctx.rol] + ') no tiene el permiso «' + perm + '».'); }
    async _own(store, id, ctx) {
      if (typeof id !== 'string' || id.length > 80) throw E('VALIDACION', 'Identificador inválido');
      const r = await this.db.get(store, id);
      if (!r || r.org !== ctx.org) throw E('NO_ENCONTRADO', 'Recurso no encontrado en su organización.');
      return r;
    }
    session(token) { const s = this._ctx(token); return { userId: s.userId, email: s.email, nombre: s.nombre, org: s.org, orgNombre: s.orgNombre, rol: s.rol, rolNombre: ROLES[s.rol], exp: s.exp }; }
    can(token, perm) { try { return V.can(this._ctx(token).rol, perm); } catch (_) { return false; } }

    async hasData() { return (await this.db.all('orgs')).length > 0; }

    /** Crea organizaciones y usuarios de demostración con contraseñas aleatorias (o de vigia.config.js). */
    async bootstrapDemo() {
      if (await this.hasData()) throw E('CONFLICTO', 'Ya existen organizaciones.');
      const orgs = [
        { id: V.id('org'), nombre: 'Organización Demo Norte', slug: 'norte', pais: 'CO', region: 'sa-bogota', creadoEn: Date.now() },
        { id: V.id('org'), nombre: 'Organización Demo Sur', slug: 'sur', pais: 'CO', region: 'sa-bogota', creadoEn: Date.now() }
      ];
      for (const o of orgs) await this.db.put('orgs', o);
      const [N, S] = orgs;
      const people = [
        ['admin@norte.demo', 'Ana Administradora', [[N, 'admin']]],
        ['supervisor@norte.demo', 'Sergio Supervisor', [[N, 'supervisor']]],
        ['operador@norte.demo', 'Olga Operadora', [[N, 'operador']]],
        ['investigador@norte.demo', 'Iván Investigador', [[N, 'investigador']]],
        ['directivo@norte.demo', 'Diana Directiva', [[N, 'directivo']]],
        ['admin@sur.demo', 'Andrés Admin Sur', [[S, 'admin']]],
        ['operador@sur.demo', 'Oscar Operador Sur', [[S, 'operador']]],
        ['consultor@demo', 'Carla Consultora (2 organizaciones)', [[N, 'investigador'], [S, 'operador']]]
      ];
      const creds = [];
      for (const [email, nombre, mems] of people) {
        const pass = (CFG.demoPasswords && CFG.demoPasswords[email]) || V.randomSecret(12);
        const salt = V.toHex(crypto.getRandomValues(new Uint8Array(16)));
        const u = { id: V.id('usr'), email, nombre, salt, iter: this.opts.pbkdf2Iter, hash: await pbkdf2(pass, salt, this.opts.pbkdf2Iter), creadoEn: Date.now(), activo: true };
        await this.db.put('users', u);
        for (const [o, rol] of mems) await this.db.put('memberships', { id: V.id('mem'), org: o.id, userId: u.id, rol, creadoEn: Date.now() });
        creds.push({ email, nombre, password: pass, roles: mems.map(([o, r]) => o.nombre + ' → ' + ROLES[r]).join('; ') });
      }
      for (const o of orgs) {
        await this.db.put('policies', { id: 'pol_' + o.id, org: o.id, diasOriginales: 90, diasDerivados: 30, protegerExpedientes: true, borradoAutomatico: false });
        await this._audit({ org: o.id, userId: 'sistema', email: 'sistema' }, 'organizacion.crear', 'org', o.id, { nombre: o.nombre });
      }
      await this.db.put('meta', { k: 'bootstrap', en: Date.now() });
      return { orgs, creds };
    }

    /** Paso 1 del inicio de sesión: valida credenciales y devuelve organizaciones disponibles. */
    async login(email, password, orgId) {
      email = String(email || '').trim().toLowerCase();
      const f = this.fails.get(email) || { n: 0, hasta: 0 };
      if (Date.now() < f.hasta) throw E('LIMITE', 'Demasiados intentos. Espere ' + Math.ceil((f.hasta - Date.now()) / 1000) + ' s.');
      const u = (await this.db.by('users', 'email', email))[0];
      const ok = u && u.activo && ctEq(await pbkdf2(String(password || ''), u.salt, u.iter), u.hash);
      if (!ok) {
        f.n++; if (f.n >= 5) { f.hasta = Date.now() + 60000; f.n = 0; } this.fails.set(email, f);
        throw E('CREDENCIALES', 'Correo o contraseña incorrectos.');
      }
      this.fails.delete(email);
      const mems = await this.db.by('memberships', 'userId', u.id);
      const orgs = [];
      for (const m of mems) { const o = await this.db.get('orgs', m.org); if (o) orgs.push({ id: o.id, nombre: o.nombre, rol: m.rol, rolNombre: ROLES[m.rol] }); }
      if (!orgs.length) throw E('PROHIBIDO', 'El usuario no pertenece a ninguna organización.');
      orgs.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      if (!orgId) { if (orgs.length === 1) orgId = orgs[0].id; else return { requiereOrganizacion: true, orgs }; }
      const sel = orgs.find(o => o.id === orgId);
      if (!sel) throw E('PROHIBIDO', 'No pertenece a esa organización.');
      const token = V.randomSecret(32);
      const s = { token, userId: u.id, email: u.email, nombre: u.nombre, org: sel.id, orgNombre: sel.nombre, rol: sel.rol, exp: Date.now() + CFG.sesionHoras * 3600e3 };
      this.sessions.set(token, s);
      await this._audit(s, 'sesion.iniciar', 'usuario', u.id, { rol: sel.rol });
      return { token, session: this.session(token), orgs };
    }
    async logout(token) { const s = this.sessions.get(token); if (s) { await this._audit(s, 'sesion.cerrar', 'usuario', s.userId, {}); this.sessions.delete(token); } }

    // =============== auditoría encadenada ===============
    async _audit(ctx, accion, recurso, recursoId, detalle) {
      const run = async () => {
        const metaK = 'audit_last_' + ctx.org;
        const last = await this.db.get('meta', metaK);
        const prev = last ? last.hash : '0'.repeat(64);
        const rec = { id: V.id('aud'), org: ctx.org, userId: ctx.userId, email: ctx.email, accion, recurso, recursoId: recursoId || null, detalle: detalle || {}, ts: Date.now(), prev, seq: ((last && last.seq) || 0) + 1 };
        rec.hash = await V.sha256Text(prev + '|' + JSON.stringify([rec.id, rec.org, rec.userId, rec.accion, rec.recurso, rec.recursoId, rec.detalle, rec.ts]));
        await this.db.put('audit', rec);
        await this.db.put('meta', { k: metaK, hash: rec.hash, seq: rec.seq });
        return rec;
      };
      const p = this._auditLock.then(run, run); this._auditLock = p.catch(() => {}); return p;
    }
    async auditLog(token, opts) {
      const ctx = this._ctx(token); this._need(ctx, 'auditoria.ver');
      const all = (await this.db.by('audit', 'org', ctx.org)).sort((a, b) => (b.seq || 0) - (a.seq || 0) || b.ts - a.ts || (b.id > a.id ? 1 : -1));
      const lim = V.clamp((opts && opts.limit) || 200, 1, 1000);
      return { items: all.slice(0, lim), total: all.length };
    }
    async verifyAudit(token) {
      const ctx = this._ctx(token); this._need(ctx, 'auditoria.ver');
      // Se recorre la cadena por enlaces (prev → hash), no por reloj: dos registros del mismo milisegundo no alteran el orden.
      const all = await this.db.by('audit', 'org', ctx.org);
      const porPrev = new Map();
      for (const r of all) { if (porPrev.has(r.prev)) return { ok: false, rotoEn: r.id, registros: all.length, motivo: 'bifurcación de la cadena' }; porPrev.set(r.prev, r); }
      let prev = '0'.repeat(64), n = 0; const vistos = new Set();
      while (porPrev.has(prev) && n <= all.length) {
        const r = porPrev.get(prev); vistos.add(r.id);
        const h = await V.sha256Text(r.prev + '|' + JSON.stringify([r.id, r.org, r.userId, r.accion, r.recurso, r.recursoId, r.detalle, r.ts]));
        if (h !== r.hash) return { ok: false, rotoEn: r.id, registros: all.length, motivo: 'contenido alterado' };
        prev = r.hash; n++;
      }
      if (n !== all.length) { const huerf = all.find(r => !vistos.has(r.id)); return { ok: false, rotoEn: huerf ? huerf.id : null, registros: all.length, motivo: 'registros fuera de la cadena (' + (all.length - n) + ')' }; }
      const meta = await this.db.get('meta', 'audit_last_' + ctx.org);
      if (meta && meta.hash !== prev) return { ok: false, rotoEn: null, registros: all.length, motivo: 'el último eslabón no coincide (registros eliminados al final)' };
      return { ok: true, registros: all.length };
    }

    // =============== usuarios / organización ===============
    async listMembers(token) {
      const ctx = this._ctx(token); this._need(ctx, 'admin.usuarios');
      const mems = await this.db.by('memberships', 'org', ctx.org);
      const out = [];
      for (const m of mems) { const u = await this.db.get('users', m.userId); if (u) out.push({ id: m.id, userId: u.id, email: u.email, nombre: u.nombre, rol: m.rol, rolNombre: ROLES[m.rol], activo: u.activo }); }
      return out;
    }
    async createUser(token, { email, nombre, rol }) {
      const ctx = this._ctx(token); this._need(ctx, 'admin.usuarios');
      email = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw E('VALIDACION', 'Correo inválido');
      if (!ROLES[rol]) throw E('VALIDACION', 'Rol inválido');
      let u = (await this.db.by('users', 'email', email))[0]; let pass = null;
      if (!u) {
        pass = V.randomSecret(12); const salt = V.toHex(crypto.getRandomValues(new Uint8Array(16)));
        u = { id: V.id('usr'), email, nombre: String(nombre || email).slice(0, 80), salt, iter: this.opts.pbkdf2Iter, hash: await pbkdf2(pass, salt, this.opts.pbkdf2Iter), creadoEn: Date.now(), activo: true };
        await this.db.put('users', u);
      }
      const ex = (await this.db.by('memberships', 'userId', u.id)).find(m => m.org === ctx.org);
      if (ex) throw E('CONFLICTO', 'El usuario ya pertenece a la organización');
      await this.db.put('memberships', { id: V.id('mem'), org: ctx.org, userId: u.id, rol, creadoEn: Date.now() });
      await this._audit(ctx, 'usuario.agregar', 'usuario', u.id, { email, rol });
      return { userId: u.id, passwordTemporal: pass };
    }

    // =============== sedes, zonas, cámaras, grupos ===============
    async _ensureNamed(store, ctx, nombre) {
      nombre = String(nombre || '').trim().slice(0, 80); if (!nombre) return null;
      const ex = (await this.db.by(store, 'org', ctx.org)).find(x => V.norm(x.nombre) === V.norm(nombre));
      if (ex) return ex.id;
      const r = { id: V.id(store === 'sites' ? 'sede' : 'zona'), org: ctx.org, nombre, creadoEn: Date.now() };
      await this.db.put(store, r); return r.id;
    }
    async listSites(token) { const ctx = this._ctx(token); return this.db.by('sites', 'org', ctx.org); }
    async listZones(token) { const ctx = this._ctx(token); return this.db.by('zones', 'org', ctx.org); }

    async listCameras(token) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.ver');
      const cams = (await this.db.by('cameras', 'org', ctx.org)).sort((a, b) => a.numero - b.numero);
      const sites = await this.db.by('sites', 'org', ctx.org), zones = await this.db.by('zones', 'org', ctx.org);
      const recs = await this.db.by('recordings', 'org', ctx.org);
      return cams.map(c => Object.assign(c, {
        sede: (sites.find(s => s.id === c.siteId) || {}).nombre || '', zona: (zones.find(z => z.id === c.zoneId) || {}).nombre || '',
        grabaciones: recs.filter(r => r.cameraId === c.id).length
      }));
    }
    async getCamera(token, id) { const ctx = this._ctx(token); this._need(ctx, 'camaras.ver'); return this._own('cameras', id, ctx); }
    async saveCamera(token, data) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.gestionar');
      const nombre = String(data.nombre || '').trim().slice(0, 80);
      if (!nombre) throw E('VALIDACION', 'La cámara requiere un nombre.');
      const tz = data.tz || V.defaultTZ(); if (!V.validTZ(tz)) throw E('VALIDACION', 'Zona horaria inválida: ' + tz);
      const tipo = ['archivo', 'webcam', 'rtsp'].includes(data.tipo) ? data.tipo : 'archivo';
      let rtspUrl = '';
      if (tipo === 'rtsp') {
        rtspUrl = String(data.rtspUrl || '').trim();
        if (!/^rtsps?:\/\/[^\s]+$/i.test(rtspUrl)) throw E('VALIDACION', 'URL RTSP inválida (rtsp://…)');
        rtspUrl = rtspUrl.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@'); // nunca guardar la contraseña en claro
      }
      const mascaras = Array.isArray(data.mascaras) ? data.mascaras.slice(0, 10).map(m => ({ x: V.clamp(+m.x || 0, 0, 1), y: V.clamp(+m.y || 0, 0, 1), w: V.clamp(+m.w || 0, 0, 1), h: V.clamp(+m.h || 0, 0, 1), nombre: String(m.nombre || '').slice(0, 40) })) : [];
      const analitica = data.analitica !== undefined ? validarAnalitica(data.analitica) : undefined;
      let cam;
      if (data.id) { cam = await this._own('cameras', data.id, ctx); }
      else {
        const cams = await this.db.by('cameras', 'org', ctx.org);
        cam = { id: V.id('cam'), org: ctx.org, numero: cams.reduce((m, c) => Math.max(m, c.numero), 0) + 1, creadoEn: Date.now(), creadoPor: ctx.userId };
      }
      Object.assign(cam, {
        nombre, tz, tipo, rtspUrl, mascaras,
        analitica: analitica !== undefined ? analitica : (cam.analitica || null),
        codigo: String(data.codigo || ('CAM-' + String(cam.numero).padStart(2, '0'))).slice(0, 20),
        ubicacion: String(data.ubicacion || '').slice(0, 160),
        siteId: await this._ensureNamed('sites', ctx, data.sede), zoneId: await this._ensureNamed('zones', ctx, data.zona),
        fuente: String(data.fuente || (tipo === 'archivo' ? 'Archivo de video importado' : tipo === 'webcam' ? 'Cámara web local (navegador)' : 'RTSP')).slice(0, 120),
        actualizadoEn: Date.now()
      });
      await this.db.put('cameras', cam);
      await this._audit(ctx, data.id ? 'camara.editar' : 'camara.crear', 'camara', cam.id, { nombre, tipo });
      return cam;
    }
    async listGroups(token) { const ctx = this._ctx(token); this._need(ctx, 'camaras.ver'); return this.db.by('groups', 'org', ctx.org); }
    async saveGroup(token, { id, nombre, cameraIds }) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.gestionar');
      nombre = String(nombre || '').trim().slice(0, 60); if (!nombre) throw E('VALIDACION', 'El grupo requiere nombre');
      const ids = [];
      for (const cid of (cameraIds || [])) { await this._own('cameras', cid, ctx); ids.push(cid); }
      const g = id ? await this._own('groups', id, ctx) : { id: V.id('grp'), org: ctx.org, creadoEn: Date.now() };
      Object.assign(g, { nombre, cameraIds: ids }); await this.db.put('groups', g);
      await this._audit(ctx, 'grupo.guardar', 'grupo', g.id, { nombre, n: ids.length });
      return g;
    }

    // =============== almacenamiento de objetos ===============
    async _putBlob(ctx, bucket, id, blob) {
      const key = bucket + '/' + ctx.org + '/' + id;
      if (bucket === 'originales' && await this.db.get('blobs', key)) throw E('CONFLICTO', 'Los originales son inmutables: no se pueden sobrescribir.');
      await this.db.put('blobs', { key, org: ctx.org, blob, size: blob.size, type: blob.type, creadoEn: Date.now() });
      return key;
    }
    async _getBlob(ctx, key) {
      const b = await this.db.get('blobs', key);
      if (!b || b.org !== ctx.org) throw E('NO_ENCONTRADO', 'Objeto no encontrado en su organización.');
      return b.blob;
    }

    // =============== grabaciones (originales) ===============
    async importRecording(token, cameraId, file, meta) {
      const ctx = this._ctx(token); this._need(ctx, 'grabaciones.cargar');
      const cam = await this._own('cameras', cameraId, ctx);
      if (!(file instanceof Blob)) throw E('VALIDACION', 'Archivo no válido');
      if (file.size === 0) throw E('VALIDACION', 'El archivo está vacío');
      if (file.size > CFG.maxUploadMB * 1048576) throw E('LIMITE', 'El archivo supera el límite de ' + CFG.maxUploadMB + ' MB');
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const s4 = String.fromCharCode(head[4], head[5], head[6], head[7]);
      let contenedor = null;
      if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(s4)) contenedor = 'mp4';
      else if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) contenedor = 'webm';
      if (!contenedor) throw E('FORMATO', 'Formato no soportado. Use MP4/MOV (ISO-BMFF) o WebM. Los bytes iniciales no corresponden a un video.');
      const nombre = V.safeName(file.name || ('video.' + contenedor));
      const meta0 = meta || {};
      const sha256 = await V.sha256Blob(file, meta0.onHashProgress);
      const dup = (await this.db.by('recordings', 'org', ctx.org)).find(r => r.sha256 === sha256);
      if (dup) throw E('CONFLICTO', 'Este archivo ya fue importado (mismo SHA-256).', { recordingId: dup.id });
      const id = V.id('grb');
      const blobKey = await this._putBlob(ctx, 'originales', id, file);
      let inicioDecl = null;
      if (meta0.horaInicioDeclarada) { const t = Date.parse(meta0.horaInicioDeclarada); if (!isNaN(t)) inicioDecl = t; }
      const rec = {
        id, org: ctx.org, cameraId: cam.id, nombreArchivo: nombre, size: file.size, mime: file.type || (contenedor === 'mp4' ? 'video/mp4' : 'video/webm'), contenedor,
        sha256, blobKey, subidoPor: ctx.userId, subidoPorEmail: ctx.email, importadoEn: Date.now(),
        fuenteDeclarada: String(meta0.fuenteDeclarada || cam.fuente || '').slice(0, 160),
        tz: cam.tz, horaInicio: inicioDecl, horaInicioFuente: inicioDecl ? 'declarada_por_usuario' : 'desconocida',
        duracion: null, ancho: null, alto: null, fps: null, codec: null, audio: null, estado: 'pendiente', indexado: false, motores: []
      };
      await this.db.put('recordings', rec);
      const job = { id: V.id('job'), org: ctx.org, tipo: 'indexacion', recordingId: id, cameraId: cam.id, estado: 'pendiente', progreso: 0, etapa: 'en cola', creadoEn: Date.now(), creadoPor: ctx.userId, opciones: { ia: !!meta0.ia } };
      await this.db.put('jobs', job);
      await this._audit(ctx, 'grabacion.importar', 'grabacion', id, { archivo: nombre, bytes: file.size, sha256 });
      V.emit('jobs:changed', { org: ctx.org });
      return { recording: rec, job };
    }
    async listRecordings(token, cameraId) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.ver');
      let r = await this.db.by('recordings', 'org', ctx.org);
      if (cameraId) r = r.filter(x => x.cameraId === cameraId);
      return r.sort((a, b) => b.importadoEn - a.importadoEn);
    }
    async getRecording(token, id) { const ctx = this._ctx(token); this._need(ctx, 'camaras.ver'); return this._own('recordings', id, ctx); }
    async verifyRecording(token, id) {
      const ctx = this._ctx(token); this._need(ctx, 'medios.ver');
      const r = await this._own('recordings', id, ctx); const b = await this._getBlob(ctx, r.blobKey);
      const h = await V.sha256Blob(b);
      await this._audit(ctx, 'grabacion.verificar_hash', 'grabacion', id, { ok: h === r.sha256 });
      return { ok: h === r.sha256, esperado: r.sha256, calculado: h };
    }
    async deleteRecording(token, id) {
      const ctx = this._ctx(token); this._need(ctx, 'grabaciones.eliminar');
      const r = await this._own('recordings', id, ctx);
      if ((await this.db.by('jobs', 'org', ctx.org)).some(j => j.recordingId === id && ['pendiente', 'en_curso'].includes(j.estado))) throw E('CONFLICTO', 'Hay una indexación en curso para esta grabación. Espere a que termine.');
      const pol = await this.db.get('policies', 'pol_' + ctx.org);
      const evs = await this.db.by('evidence', 'org', ctx.org);
      const ders = (await this.db.by('derivatives', 'recordingId', id)).map(d => d.id);
      const finds = (await this.db.by('findings', 'recordingId', id)).map(f => f.id);
      const refs = evs.filter(e => e.refId === id || ders.includes(e.refId) || finds.includes(e.refId));
      if (refs.length && (!pol || pol.protegerExpedientes)) {
        const cases = [...new Set(refs.map(e => e.caseId))];
        throw E('PROTEGIDO', 'La grabación está vinculada a ' + cases.length + ' expediente(s) protegido(s) y no puede eliminarse.', { expedientes: cases });
      }
      for (const st of ['frames', 'detections', 'findings', 'derivatives', 'analysis']) for (const x of await this.db.by(st, 'recordingId', id)) { await this.db.del(st, x.id); if (x.blobKey) await this.db.del('blobs', x.blobKey); }
      await this.db.del('blobs', r.blobKey); await this.db.del('recordings', id);
      await this._audit(ctx, 'grabacion.eliminar', 'grabacion', id, { sha256: r.sha256 });
      return { ok: true };
    }

    // =============== trabajos ===============
    async listJobs(token) { const ctx = this._ctx(token); this._need(ctx, 'camaras.ver'); return (await this.db.by('jobs', 'org', ctx.org)).sort((a, b) => b.creadoEn - a.creadoEn); }
    async requeueAnalysis(token, recordingId, opciones) {
      const ctx = this._ctx(token); this._need(ctx, 'grabaciones.cargar');
      const rec = await this._own('recordings', recordingId, ctx);
      const pend = (await this.db.by('jobs', 'org', ctx.org)).find(j => j.recordingId === rec.id && (j.estado === 'pendiente' || j.estado === 'en_curso'));
      if (pend) throw E('CONFLICTO', 'Ya hay un trabajo en curso para esta grabación.');
      const job = { id: V.id('job'), org: ctx.org, tipo: 'indexacion', recordingId: rec.id, cameraId: rec.cameraId, estado: 'pendiente', progreso: 0, etapa: 'en cola', creadoEn: Date.now(), creadoPor: ctx.userId, opciones: Object.assign({ ia: true, reanalisis: true }, opciones || {}) };
      await this.db.put('jobs', job);
      await this._audit(ctx, 'grabacion.reanalizar', 'grabacion', rec.id, job.opciones);
      V.emit('jobs:changed', { org: ctx.org });
      return job;
    }

    // Capacidad interna para el trabajador (no expuesta a la UI)
    _workerHandle() {
      const self = this;
      return {
        db: self.db,
        async nextJob() {
          const all = (await self.db.all('jobs')).filter(j => j.estado === 'pendiente').sort((a, b) => a.creadoEn - b.creadoEn);
          return all[0] || null;
        },
        async update(job, patch) { Object.assign(job, patch); await self.db.put('jobs', job); V.emit('jobs:changed', { org: job.org, job }); },
        async getBlob(org, key) { return self._getBlob({ org }, key); },
        async putBlob(org, bucket, id, blob) { return self._putBlob({ org }, bucket, id, blob); },
        audit(org, accion, recurso, id, det) { return self._audit({ org, userId: 'sistema', email: 'trabajador' }, accion, recurso, id, det); },
        async resetStuck() { for (const j of await self.db.all('jobs')) if (j.estado === 'en_curso') { j.estado = 'pendiente'; j.etapa = 'reanudado tras recarga'; await self.db.put('jobs', j); } }
      };
    }

    // =============== fotogramas / detecciones / hallazgos ===============
    async listFrames(token, recordingId, a, b, limit) {
      const ctx = this._ctx(token); this._need(ctx, 'medios.ver');
      await this._own('recordings', recordingId, ctx);
      let fr = (await this.db.by('frames', 'recordingId', recordingId)).filter(f => f.org === ctx.org);
      if (a != null) fr = fr.filter(f => f.t >= a - 1e-6); if (b != null) fr = fr.filter(f => f.t <= b + 1e-6);
      fr.sort((x, y) => x.t - y.t);
      return fr.slice(0, limit || 5000);
    }
    async listFindings(token, filtro) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.ver');
      filtro = filtro || {};
      let f = await this.db.by('findings', 'org', ctx.org);
      if (filtro.cameraId) f = f.filter(x => x.cameraId === filtro.cameraId);
      if (filtro.estado) f = f.filter(x => x.estado === filtro.estado);
      if (filtro.recordingId) f = f.filter(x => x.recordingId === filtro.recordingId);
      return f.sort((a, b) => (b.tAbs || b.creadoEn) - (a.tAbs || a.creadoEn));
    }
    async getFinding(token, id) { const ctx = this._ctx(token); this._need(ctx, 'camaras.ver'); return this._own('findings', id, ctx); }
    async reviewFinding(token, id, estado, nota) {
      const ctx = this._ctx(token);
      if (!['revisado', 'descartado', 'confirmado', 'sugerido'].includes(estado)) throw E('VALIDACION', 'Estado inválido');
      this._need(ctx, estado === 'confirmado' ? 'incidentes.confirmar' : 'hallazgos.revisar');
      const f = await this._own('findings', id, ctx);
      if (f.estado === 'confirmado') this._need(ctx, 'incidentes.confirmar'); // sólo quien confirma puede revertir una confirmación
      const antes = f.estado;
      f.estado = estado; f.revisadoPor = ctx.email; f.revisadoEn = Date.now(); if (nota) f.notaRevision = String(nota).slice(0, 500);
      await this.db.put('findings', f);
      await this._audit(ctx, 'hallazgo.revisar', 'hallazgo', id, { antes, despues: estado });
      return f;
    }

    /** Búsqueda de eventos acotada por cámara(s), ventana y clase. Devuelve también cobertura. */
    async searchEvents(token, q) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.ver');
      const cams = [];
      for (const id of (q.cameraIds || [])) cams.push(await this._own('cameras', id, ctx));
      if (!cams.length) throw E('VALIDACION', 'Indique al menos una cámara.');
      const clases = q.clases && q.clases.length ? q.clases : null;
      const recs = (await this.db.by('recordings', 'org', ctx.org)).filter(r => cams.some(c => c.id === r.cameraId));
      const resultados = [], cobertura = [];
      for (const r of recs) {
        const w = V.windowForRecording(q.ventana, r);
        if (!w) continue;
        if ((w.b - w.a) > CFG.maxIntervaloConsultaH * 3600) throw E('LIMITE', 'La ventana supera ' + CFG.maxIntervaloConsultaH + ' h.');
        const motores = r.motores || [];
        const cam = cams.find(c => c.id === r.cameraId);
        const sop = (clases || []).map(c => V.soporteClase(c, motores, cam));
        const soportaClase = sop.every(x => x.ok);
        cobertura.push({ recordingId: r.id, cameraId: r.cameraId, a: w.a, b: w.b, recortada: w.recortada, indexado: r.indexado, motores, soportaClase, motivos: sop.filter(x => !x.ok).map(x => x.motivo), estado: r.estado });
        if (!r.indexado) continue;
        let fs = (await this.db.by('findings', 'recordingId', r.id)).filter(f => f.org === ctx.org && f.fin >= w.a && f.inicio <= w.b);
        if (clases) fs = fs.filter(f => clases.includes(f.clase));
        if (q.motor) fs = fs.filter(f => f.motor === q.motor);
        if (q.atributos) fs = fs.filter(f => f.atributos && (!q.atributos.superior || f.atributos.superior === q.atributos.superior) && (!q.atributos.inferior || f.atributos.inferior === q.atributos.inferior) && (!q.atributos.cualquiera || f.atributos.superior === q.atributos.cualquiera || f.atributos.inferior === q.atributos.cualquiera));
        fs.forEach(f => resultados.push(f));
      }
      resultados.sort((a, b) => (a.tAbs || 0) - (b.tAbs || 0) || a.inicio - b.inicio);
      const lim = V.clamp(Math.floor(+q.limit) || 50, 1, 200), off = Math.max(0, Math.floor(+q.offset) || 0);
      return { total: resultados.length, items: resultados.slice(off, off + lim), offset: off, limit: lim, cobertura };
    }

    // =============== medios con autorización ===============
    /** Devuelve una URL de objeto con caducidad para un medio. kind: original|derivado|fotograma */
    async mediaURL(token, kind, id, motivo) {
      const ctx = this._ctx(token);
      motivo = motivo || 'ver';
      this._need(ctx, motivo === 'descargar' ? 'evidencia.descargar' : 'medios.ver');
      let key, name, rec;
      if (kind === 'original') { rec = await this._own('recordings', id, ctx); key = rec.blobKey; name = rec.nombreArchivo; }
      else if (kind === 'derivado') { rec = await this._own('derivatives', id, ctx); key = rec.blobKey; name = rec.nombre; }
      else if (kind === 'fotograma') { rec = await this._own('frames', id, ctx); key = rec.blobKey; name = 'miniatura_' + id + '.jpg'; }
      else if (kind === 'alerta') { rec = await this._own('alerts', id, ctx); key = rec.blobKey; name = 'alerta_' + id + '.jpg'; }
      else throw E('VALIDACION', 'Tipo de medio inválido');
      const blob = await this._getBlob(ctx, key);
      const url = URL.createObjectURL(blob);
      const exp = Date.now() + CFG.urlTTLmin * 60000;
      this.urls.set(url, exp); setTimeout(() => { URL.revokeObjectURL(url); this.urls.delete(url); }, CFG.urlTTLmin * 60000);
      if (kind !== 'fotograma' && kind !== 'alerta') await this._audit(ctx, motivo === 'descargar' ? 'medio.descargar' : 'medio.ver', kind, id, { nombre: name });
      return { url, blob, name, exp };
    }
    async getDerivative(token, id) { const ctx = this._ctx(token); this._need(ctx, 'medios.ver'); return this._own('derivatives', id, ctx); }
    async listDerivatives(token, recordingId) {
      const ctx = this._ctx(token); this._need(ctx, 'medios.ver');
      let d = await this.db.by('derivatives', 'org', ctx.org); if (recordingId) d = d.filter(x => x.recordingId === recordingId);
      return d.sort((a, b) => b.creadoEn - a.creadoEn);
    }
    /** Registra un derivado (clip o fotograma original) con cadena de custodia. */
    async saveDerivative(token, recordingId, blob, info) {
      const ctx = this._ctx(token); this._need(ctx, info.tipo === 'clip' ? 'clips.crear' : 'medios.ver');
      const rec = recordingId ? await this._own('recordings', recordingId, ctx) : null;
      if (!rec) { if (!info.cameraId) throw E('VALIDACION', 'El derivado requiere grabación o cámara de origen'); await this._own('cameras', info.cameraId, ctx); }
      const id = V.id(info.tipo === 'clip' ? 'clip' : 'fot');
      const sha256 = await V.sha256Blob(blob);
      const blobKey = await this._putBlob(ctx, 'derivados', id, blob);
      // Los campos de custodia (org, hashes, autor, fechas) los fija el servidor y nunca el llamador.
      const d = Object.assign({ transformacion: 'ninguna' }, info, {
        id, org: ctx.org, recordingId: rec ? rec.id : null, cameraId: rec ? rec.cameraId : info.cameraId,
        origenSha256: rec ? rec.sha256 : null, sha256, size: blob.size, mime: blob.type, blobKey,
        creadoPor: ctx.email, creadoEn: Date.now()
      });
      d.nombre = V.safeName(info.nombre || (id + (d.mime.includes('mp4') ? '.mp4' : d.mime.includes('webm') ? '.webm' : '.png')));
      await this.db.put('derivatives', d);
      await this._audit(ctx, d.tipo + '.crear', 'derivado', id, { origen: recordingId, sha256, inicio: d.inicio, fin: d.fin, metodo: d.metodo });
      return d;
    }
    async verifyDerivative(token, id) {
      const ctx = this._ctx(token); this._need(ctx, 'medios.ver');
      const d = await this._own('derivatives', id, ctx); const b = await this._getBlob(ctx, d.blobKey);
      const h = await V.sha256Blob(b); let orig = null;
      if (d.recordingId) { const r = await this.db.get('recordings', d.recordingId); orig = r ? (r.sha256 === d.origenSha256) : false; }
      return { ok: h === d.sha256, esperado: d.sha256, calculado: h, origenCoincide: orig };
    }

    // =============== chats ===============
    async createChat(token, titulo) {
      const ctx = this._ctx(token); this._need(ctx, 'chat.usar');
      const c = { id: V.id('chat'), org: ctx.org, userId: ctx.userId, titulo: String(titulo || 'Conversación').slice(0, 80), creadoEn: Date.now(), estado: {} };
      await this.db.put('chats', c); return c;
    }
    async listChats(token) {
      const ctx = this._ctx(token); this._need(ctx, 'chat.usar');
      const all = await this.db.by('chats', 'org', ctx.org);
      return (V.can(ctx.rol, 'chats.ver_todos') ? all : all.filter(c => c.userId === ctx.userId)).sort((a, b) => b.creadoEn - a.creadoEn);
    }
    async _chatOwn(ctx, chatId) {
      const c = await this._own('chats', chatId, ctx);
      if (c.userId !== ctx.userId && !V.can(ctx.rol, 'chats.ver_todos')) throw E('NO_ENCONTRADO', 'Conversación no encontrada.');
      return c;
    }
    async getChat(token, chatId) { const ctx = this._ctx(token); return this._chatOwn(ctx, chatId); }
    async saveChatState(token, chatId, estado) { const ctx = this._ctx(token); const c = await this._chatOwn(ctx, chatId); c.estado = estado; await this.db.put('chats', c); }
    async listMessages(token, chatId) {
      const ctx = this._ctx(token); await this._chatOwn(ctx, chatId);
      return (await this.db.by('messages', 'chatId', chatId)).filter(m => m.org === ctx.org).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
    }
    async addMessage(token, chatId, msg) {
      const ctx = this._ctx(token); const c = await this._chatOwn(ctx, chatId);
      const m = { id: V.id('msg'), org: ctx.org, chatId, autor: msg.rol === 'usuario' ? ctx.email : 'VIGÍA', rol: msg.rol, texto: String(msg.texto || '').slice(0, 4000), plan: msg.plan || null, resultado: msg.resultado || null, ts: Date.now() };
      await this.db.put('messages', m);
      if (msg.rol === 'usuario' && c.titulo === 'Conversación') { c.titulo = m.texto.slice(0, 60); await this.db.put('chats', c); }
      return m;
    }

    // =============== expedientes ===============
    async listCases(token) { const ctx = this._ctx(token); this._need(ctx, 'expedientes.ver'); return (await this.db.by('cases', 'org', ctx.org)).sort((a, b) => b.creadoEn - a.creadoEn); }
    async getCase(token, id) {
      const ctx = this._ctx(token); this._need(ctx, 'expedientes.ver');
      const c = await this._own('cases', id, ctx);
      const evidencias = (await this.db.by('evidence', 'caseId', id)).filter(e => e.org === ctx.org).sort((a, b) => a.en - b.en);
      const notas = (await this.db.by('notes', 'caseId', id)).filter(e => e.org === ctx.org).sort((a, b) => a.en - b.en);
      const informes = (await this.db.by('reports', 'caseId', id)).filter(e => e.org === ctx.org).sort((a, b) => b.en - a.en);
      return { caso: c, evidencias, notas, informes };
    }
    async createCase(token, { titulo, descripcion, prioridad }) {
      const ctx = this._ctx(token); this._need(ctx, 'expedientes.crear');
      titulo = String(titulo || '').trim().slice(0, 120); if (!titulo) throw E('VALIDACION', 'El expediente requiere título');
      const n = (await this.db.by('cases', 'org', ctx.org)).length + 1;
      const c = { id: V.id('exp'), org: ctx.org, codigo: 'EXP-' + new Date().getFullYear() + '-' + String(n).padStart(4, '0'), titulo, descripcion: String(descripcion || '').slice(0, 2000), prioridad: ['baja', 'media', 'alta'].includes(prioridad) ? prioridad : 'media', estado: 'abierto', aprobacion: 'borrador', protegido: true, creadoPor: ctx.email, creadoEn: Date.now() };
      await this.db.put('cases', c);
      await this._audit(ctx, 'expediente.crear', 'expediente', c.id, { codigo: c.codigo });
      return c;
    }
    async updateCase(token, id, patch) {
      const ctx = this._ctx(token); this._need(ctx, 'expedientes.crear');
      const c = await this._own('cases', id, ctx);
      if (c.aprobacion === 'aprobado') this._need(ctx, 'informes.aprobar'); // un expediente aprobado sólo lo modifica quien aprueba
      if (patch.estado && ['abierto', 'en_revision', 'cerrado'].includes(patch.estado)) c.estado = patch.estado;
      if (patch.aprobacion) {
        if (!['borrador', 'pendiente', 'aprobado'].includes(patch.aprobacion)) throw E('VALIDACION', 'Aprobación inválida');
        if (patch.aprobacion === 'aprobado') { this._need(ctx, 'informes.aprobar'); c.aprobadoPor = ctx.email; c.aprobadoEn = Date.now(); }
        c.aprobacion = patch.aprobacion;
      }
      if (patch.titulo) c.titulo = String(patch.titulo).slice(0, 120);
      if (patch.descripcion != null) c.descripcion = String(patch.descripcion).slice(0, 2000);
      await this.db.put('cases', c);
      await this._audit(ctx, 'expediente.actualizar', 'expediente', id, patch);
      return c;
    }
    async addEvidence(token, caseId, { tipo, refId, clasificacion, nota }) {
      const ctx = this._ctx(token); this._need(ctx, 'expedientes.crear');
      await this._own('cases', caseId, ctx);
      const store = { hallazgo: 'findings', clip: 'derivatives', fotograma: 'derivatives', sinopsis: 'derivatives', grabacion: 'recordings' }[tipo];
      if (!store) throw E('VALIDACION', 'Tipo de evidencia inválido');
      const ref = await this._own(store, refId, ctx);
      const dup = (await this.db.by('evidence', 'caseId', caseId)).find(e => e.refId === refId);
      if (dup) return dup;
      const cls = ['hipotesis', 'sugerido_ia', 'revisado', 'confirmado'].includes(clasificacion) ? clasificacion : (tipo === 'hallazgo' ? ({ sugerido: 'sugerido_ia', revisado: 'revisado', confirmado: 'confirmado' }[ref.estado] || 'sugerido_ia') : 'revisado');
      const e = { id: V.id('evi'), org: ctx.org, caseId, tipo, refId, clasificacion: cls, nota: String(nota || '').slice(0, 1000), agregadoPor: ctx.email, en: Date.now(), sha256: ref.sha256 || null, recordingId: ref.recordingId || (tipo === 'grabacion' ? ref.id : null) };
      await this.db.put('evidence', e);
      await this._audit(ctx, 'expediente.agregar_evidencia', 'expediente', caseId, { tipo, refId });
      return e;
    }
    async addNote(token, caseId, texto, tipo) {
      const ctx = this._ctx(token); this._need(ctx, 'expedientes.crear');
      await this._own('cases', caseId, ctx);
      texto = String(texto || '').trim().slice(0, 4000); if (!texto) throw E('VALIDACION', 'Nota vacía');
      const n = { id: V.id('nota'), org: ctx.org, caseId, texto, tipo: tipo === 'hipotesis' ? 'hipotesis' : 'nota', autor: ctx.email, en: Date.now() };
      await this.db.put('notes', n);
      await this._audit(ctx, 'expediente.nota', 'expediente', caseId, { tipo: n.tipo });
      return n;
    }
    async saveReport(token, caseId, html, formato, shaBinario) {
      const ctx = this._ctx(token); this._need(ctx, 'expedientes.crear');
      const c = await this._own('cases', caseId, ctx);
      const prev = (await this.db.by('reports', 'caseId', caseId)).length;
      const r = { id: V.id('inf'), org: ctx.org, caseId, version: prev + 1, formato: formato || 'html', sha256: shaBinario || await V.sha256Text(html || ''), html: html || null, generadoPor: ctx.email, en: Date.now(), aprobacion: c.aprobacion };
      await this.db.put('reports', r);
      await this._audit(ctx, 'informe.generar', 'expediente', caseId, { version: r.version, sha256: r.sha256 });
      return r;
    }

    // =============== reglas y alertas ===============
    async createRule(token, { cameraId, clase, duracionMin, destinatario, confirmado, horario, prioridad }) {
      const ctx = this._ctx(token); this._need(ctx, 'reglas.crear');
      const cam = await this._own('cameras', cameraId, ctx);
      if (!['persona', 'vehiculo', 'movimiento'].includes(clase) && !(V.analitica && V.analitica.TIPOS[clase] && clase !== 'cruce_linea')) throw E('VALIDACION', 'Clase no soportada por las reglas: ' + clase);
      const hz = V.horario.validar(horario);
      // con horario, la regla puede quedar vigente hasta 30 días (vigilancia recurrente); sin horario, hasta 24 h
      const d = V.clamp(Math.round(+duracionMin || 30), 1, hz ? 30 * 24 * 60 : 24 * 60);
      if (!confirmado) throw E('CONFIRMACION', 'La activación de reglas requiere confirmación explícita.');
      const r = { id: V.id('regla'), org: ctx.org, cameraId: cam.id, clase, desde: Date.now(), hasta: Date.now() + d * 60000, destinatario: String(destinatario || 'rol:supervisor').slice(0, 80), estado: 'activa', creadaPor: ctx.email, creadaEn: Date.now(), disparos: 0, horario: hz, prioridad: V.alarmas && V.alarmas.SLA_S[prioridad] ? prioridad : undefined };
      await this.db.put('rules', r);
      await this._audit(ctx, 'regla.activar', 'regla', r.id, { camara: cam.nombre, clase, minutos: d, horario: hz ? V.horario.texto(hz) : null });
      V.emit('rules:changed', { org: ctx.org });
      return r;
    }
    async listRules(token) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.ver');
      const rs = await this.db.by('rules', 'org', ctx.org);
      for (const r of rs) if (r.estado === 'activa' && Date.now() > r.hasta) { r.estado = 'vencida'; await this.db.put('rules', r); }
      return rs.sort((a, b) => b.creadaEn - a.creadaEn);
    }
    async cancelRule(token, id) {
      const ctx = this._ctx(token); this._need(ctx, 'reglas.crear');
      const r = await this._own('rules', id, ctx); r.estado = 'cancelada'; await this.db.put('rules', r);
      await this._audit(ctx, 'regla.cancelar', 'regla', id, {}); V.emit('rules:changed', { org: ctx.org }); return r;
    }
    async _fireAlert(org, rule, data) {
      const a = Object.assign({ id: V.id('alerta'), org, ruleId: rule.id, cameraId: rule.cameraId, clase: rule.clase, destinatario: rule.destinatario, estado: 'nueva', ts: Date.now() }, V.alarmas ? V.alarmas.inicial(rule.clase, rule.prioridad) : {}, data);
      await this.db.put('alerts', a); rule.disparos = (rule.disparos || 0) + 1; rule.ultimoDisparo = Date.now(); await this.db.put('rules', rule);
      await this._audit({ org, userId: 'sistema', email: 'motor-reglas' }, 'alerta.disparar', 'regla', rule.id, { clase: rule.clase });
      V.emit('alerts:new', a); return a;
    }
    async listAlerts(token) { const ctx = this._ctx(token); this._need(ctx, 'camaras.ver'); return (await this.db.by('alerts', 'org', ctx.org)).sort((a, b) => b.ts - a.ts); }
    async ackAlert(token, id) { const ctx = this._ctx(token); this._need(ctx, 'alarmas.gestionar'); const a = await this._own('alerts', id, ctx); if (a.estado !== 'nueva') return a; return this.updateAlert(token, id, { accion: 'reconocer' }); }

    // =============== políticas ===============
    async getPolicy(token) { const ctx = this._ctx(token); return this.db.get('policies', 'pol_' + ctx.org); }
    async savePolicy(token, p) {
      const ctx = this._ctx(token); this._need(ctx, 'admin.politicas');
      const pol = await this.db.get('policies', 'pol_' + ctx.org);
      pol.diasOriginales = V.clamp(Math.round(+p.diasOriginales || 90), 1, 3650); pol.diasDerivados = V.clamp(Math.round(+p.diasDerivados || 30), 1, 3650);
      pol.protegerExpedientes = !!p.protegerExpedientes;
      await this.db.put('policies', pol); await this._audit(ctx, 'politica.retencion', 'politica', pol.id, pol); return pol;
    }
    async retentionPreview(token) {
      const ctx = this._ctx(token); this._need(ctx, 'admin.politicas'); const pol = await this.db.get('policies', 'pol_' + ctx.org);
      if (!pol) return [];
      const recs = await this.db.by('recordings', 'org', ctx.org); const evs = await this.db.by('evidence', 'org', ctx.org);
      const lim = Date.now() - pol.diasOriginales * 86400e3;
      return recs.filter(r => r.importadoEn < lim).map(r => ({ id: r.id, nombre: r.nombreArchivo, protegido: evs.some(e => e.recordingId === r.id) }));
    }

    // =============== analítica ===============
    async getAnalysis(token, recordingId) {
      const ctx = this._ctx(token); this._need(ctx, 'camaras.ver');
      await this._own('recordings', recordingId, ctx);
      return (await this.db.by('analysis', 'recordingId', recordingId)).find(a => a.org === ctx.org) || null;
    }
    async listAnalyses(token) { const ctx = this._ctx(token); this._need(ctx, 'camaras.ver'); return this.db.by('analysis', 'org', ctx.org); }
    /** Resumen de conteos, ocupación y eventos para cámaras y ventana. */
    async analyticsSummary(token, q) {
      const ctx = this._ctx(token); this._need(ctx, 'indicadores.ver');
      const cams = []; for (const id of (q.cameraIds || [])) cams.push(await this._own('cameras', id, ctx));
      const recs = (await this.db.by('recordings', 'org', ctx.org)).filter(r => cams.some(c => c.id === r.cameraId));
      const out = { lineas: [], ocupacion: [], eventos: {}, cobertura: [], entradas: 0, salidas: 0 };
      for (const r of recs) {
        const w = q.ventana ? V.windowForRecording(q.ventana, r) : { a: 0, b: r.duracion || 0 };
        if (!w) continue;
        const cam = cams.find(c => c.id === r.cameraId);
        const an = (await this.db.by('analysis', 'recordingId', r.id)).find(a => a.org === ctx.org);
        const sop = V.soporteClase('cruce_linea', r.motores || [], cam);
        out.cobertura.push({ recordingId: r.id, cameraId: r.cameraId, camara: cam.codigo, a: w.a, b: w.b, recortada: w.recortada, analizado: !!an, soportaConteo: sop.ok, motivo: sop.motivo || null });
        if (!an) continue;
        for (const l of an.resultado.conteos) {
          const cs = l.cruces.filter(c => c.t >= w.a && c.t <= w.b && (!q.clase || (l.clase || 'persona') === q.clase));
          const e = cs.filter(c => c.sentido === 'entrada').length, s = cs.filter(c => c.sentido === 'salida').length;
          out.lineas.push({ recordingId: r.id, camara: cam.codigo, cameraId: cam.id, tz: cam.tz, horaInicio: r.horaInicio, linea: l.linea, lineaId: l.lineaId, clase: l.clase, entradas: e, salidas: s, cruces: cs });
          out.entradas += e; out.salidas += s;
        }
        for (const o of an.resultado.ocupacion) { const ser = o.serie.filter(x => x.t >= w.a && x.t <= w.b); out.ocupacion.push({ camara: cam.codigo, zona: o.zona, max: ser.reduce((m, x) => Math.max(m, x.n), 0) }); }
        const fs = (await this.db.by('findings', 'recordingId', r.id)).filter(f => f.org === ctx.org && f.categoria === 'analitica' && f.fin >= w.a && f.inicio <= w.b);
        fs.forEach(f => { out.eventos[f.clase] = (out.eventos[f.clase] || 0) + 1; });
      }
      return out;
    }

    // =============== indicadores ===============
    async metrics(token) {
      const ctx = this._ctx(token); this._need(ctx, 'indicadores.ver');
      const [cams, recs, jobs, dets, finds, cases, alerts, rules, ders] = await Promise.all(['cameras', 'recordings', 'jobs', 'detections', 'findings', 'cases', 'alerts', 'rules', 'derivatives'].map(s => this.db.by(s, 'org', ctx.org)));
      const done = jobs.filter(j => j.estado === 'completado' && j.duracionMs);
      const porClase = {}; dets.forEach(d => { porClase[d.clase] = (porClase[d.clase] || 0) + 1; });
      const hallPorEstado = { sugerido: 0, revisado: 0, descartado: 0, confirmado: 0 }; finds.forEach(f => { hallPorEstado[f.estado] = (hallPorEstado[f.estado] || 0) + 1; });
      const live = V.live ? V.live.status(ctx.org) : [];
      return {
        camaras: cams.length, camarasConectadas: live.filter(l => l.estado === 'conectada').length,
        camarasPorTipo: cams.reduce((o, c) => (o[c.tipo] = (o[c.tipo] || 0) + 1, o), {}),
        archivos: recs.length, archivosProcesados: recs.filter(r => r.indexado).length, horasVideo: recs.reduce((a, r) => a + (r.duracion || 0), 0) / 3600,
        bytesOriginales: recs.reduce((a, r) => a + r.size, 0),
        detecciones: dets.length, porClase, hallazgos: finds.length, hallPorEstado,
        revisados: hallPorEstado.revisado + hallPorEstado.confirmado + hallPorEstado.descartado, incidentes: hallPorEstado.confirmado,
        trabajos: { pendiente: jobs.filter(j => j.estado === 'pendiente').length, en_curso: jobs.filter(j => j.estado === 'en_curso').length, completado: jobs.filter(j => j.estado === 'completado').length, fallido: jobs.filter(j => j.estado === 'fallido').length },
        procesamiento: done.map(j => ({ id: j.id, ms: j.duracionMs, videoS: j.videoS || 0, factor: j.videoS ? (j.videoS * 1000 / j.duracionMs) : null })).slice(-20),
        tiempoMedioMs: done.length ? done.reduce((a, j) => a + j.duracionMs, 0) / done.length : null,
        expedientes: cases.length, expedientesAbiertos: cases.filter(c => c.estado !== 'cerrado').length,
        alertas: alerts.length, alertasNuevas: alerts.filter(a => a.estado === 'nueva').length, reglasActivas: rules.filter(r => r.estado === 'activa' && r.hasta > Date.now()).length,
        clips: ders.filter(d => d.tipo === 'clip').length, fotogramasExportados: ders.filter(d => d.tipo === 'fotograma').length
      };
    }
  }
  V.Api = Api;

  /** Traduce una ventana de consulta a posiciones (s) de una grabación. Devuelve null si no se solapa. */
  /** ¿Puede el análisis realizado sobre una grabación responder por esta clase? Devuelve {ok, motivo}. */
  V.soporteClase = function (c, motores, cam) {
    const coco = motores.some(m => m.startsWith('coco'));
    if (c === 'movimiento') return motores.includes('movimiento-v1') ? { ok: true } : { ok: false, motivo: 'sin detección de movimiento' };
    const T = V.analitica && V.analitica.TIPOS[c];
    if (T) {
      if (!motores.includes('analitica-v1')) return { ok: false, motivo: 'la grabación no se procesó con el motor de analítica' };
      if (T.ia && !coco) return { ok: false, motivo: '«' + T.nombre + '» requiere el detector IA (personas/vehículos)' };
      const a = cam && cam.analitica;
      if (T.cfg === 'linea' && !(a && a.lineas.length)) return { ok: false, motivo: 'la cámara no tiene líneas de conteo configuradas' };
      if (T.cfg === 'puerta' && !(a && a.puertas.length)) return { ok: false, motivo: 'la cámara no tiene puertas configuradas' };
      if (T.cfg && T.cfg.startsWith('zona:') && !(a && a.zonas.some(z => z.uso === T.cfg.slice(5)))) return { ok: false, motivo: 'la cámara no tiene zona de tipo «' + T.cfg.slice(5).replace('_', ' ') + '»' };
      return { ok: true };
    }
    return coco ? { ok: true } : { ok: false, motivo: 'sin análisis IA de objetos' };
  };

  V.windowForRecording = function (w, r) {
    if (!w || r.duracion == null) return null;
    const dur = r.duracion;
    let a, b;
    if (w.modo === 'posicion') {
      if (w.recordingId && w.recordingId !== r.id) return null;
      a = w.a; b = w.b;
    } else if (w.modo === 'ultimos') {
      // "últimos N disponibles": para archivo histórico = final de la grabación disponible
      a = dur - w.segundos; b = dur;
    } else if (w.modo === 'absoluta') {
      if (r.horaInicio == null) return null;
      a = (w.a - r.horaInicio) / 1000; b = (w.b - r.horaInicio) / 1000;
    } else if (w.modo === 'todo') { a = 0; b = dur; }
    else return null;
    if (b < 0 || a > dur) return null;
    const ca = Math.max(0, a), cb = Math.min(dur, b);
    return { a: ca, b: cb, recortada: ca !== a || cb !== b, pedida: { a, b } };
  };
})();
