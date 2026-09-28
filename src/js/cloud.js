/* VIGÍA · cloud.js — conexión opcional con Supabase (nube).
 * Qué hace: inicio de sesión con Supabase Auth, organizaciones en la nube con membresías y roles,
 * y SINCRONIZACIÓN de metadatos y cadena de custodia (cámaras, grabaciones —sólo metadatos y SHA-256—,
 * hallazgos, derivados, expedientes, evidencias y auditoría) desde la edición local.
 * Qué NO hace: no sube videos, miniaturas ni clips (permanecen en el equipo). El aislamiento en la nube
 * lo aplica PostgreSQL con Row Level Security (supabase/migrations). La clave usada es la PUBLICABLE. */
(function () {
  'use strict';
  const V = window.V; const C = V.cloud = { client: null, user: null, orgId: null };

  C.configurada = () => !!(V.CFG.supabase && V.CFG.supabase.url && V.CFG.supabase.publishableKey && window.supabase && window.supabase.createClient);
  C.cliente = function () {
    if (C.client) return C.client;
    if (!C.configurada()) throw new V.VigiaError('NO_CONFIGURADO', 'Supabase no está configurado en vigia.config.js');
    C.client = window.supabase.createClient(V.CFG.supabase.url, V.CFG.supabase.publishableKey, { auth: { persistSession: true, storageKey: 'vigia.supabase.sesion' } });
    return C.client;
  };
  const chk = (r, what) => { if (r.error) throw new V.VigiaError('NUBE', (what ? what + ': ' : '') + r.error.message, r.error.code || null); return r.data; };

  C.sesion = async () => { const r = await C.cliente().auth.getSession(); C.user = r.data && r.data.session ? r.data.session.user : null; return C.user; };
  C.entrar = async (email, password) => { const d = chk(await C.cliente().auth.signInWithPassword({ email, password }), 'Inicio de sesión'); C.user = d.user; return d.user; };
  C.registrar = async (email, password) => {
    const d = chk(await C.cliente().auth.signUp({ email, password, options: { emailRedirectTo: location.protocol.startsWith('http') ? location.href.split('#')[0] : undefined } }), 'Registro');
    C.user = d.session ? d.user : null; return { requiereConfirmacion: !d.session, user: d.user };
  };
  C.salir = async () => { await C.cliente().auth.signOut(); C.user = null; C.orgId = null; };

  C.organizaciones = async () => {
    const orgs = chk(await C.cliente().from('vigia_organizaciones').select('id,nombre,creado_en').order('nombre'), 'Organizaciones');
    const mems = chk(await C.cliente().from('vigia_miembros').select('org_id,rol').eq('user_id', C.user.id), 'Membresías');
    return orgs.map(o => Object.assign(o, { rol: (mems.find(m => m.org_id === o.id) || {}).rol }));
  };
  C.crearOrganizacion = async nombre => chk(await C.cliente().rpc('vigia_crear_organizacion', { p_nombre: nombre }), 'Crear organización');
  C.agregarMiembro = async (orgId, email, rol) => chk(await C.cliente().rpc('vigia_agregar_miembro', { p_org: orgId, p_email: email, p_rol: rol }), 'Agregar miembro');

  const iso = ms => ms == null ? null : new Date(ms).toISOString();
  /** Construye las filas a sincronizar a partir de la API local (respeta permisos del usuario local). */
  C.filas = async function (api, token, orgId) {
    const f = { camaras: [], grabaciones: [], hallazgos: [], derivados: [], expedientes: [], evidencias: [], auditoria: [], conteos: [], analisis: [] };
    for (const c of await api.listCameras(token)) f.camaras.push({ org_id: orgId, id: c.id, numero: c.numero, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, tz: c.tz, ubicacion: c.ubicacion || null, sede: c.sede || null, zona: c.zona || null, analitica: c.analitica || null, actualizado_en: iso(Date.now()) });
    for (const r of await api.listRecordings(token)) f.grabaciones.push({ org_id: orgId, id: r.id, camara_id: r.cameraId, nombre_archivo: r.nombreArchivo, bytes: r.size, sha256: r.sha256, duracion_s: r.duracion, codec: r.codec, ancho: r.ancho, alto: r.alto, hora_inicio: iso(r.horaInicio), hora_inicio_fuente: r.horaInicioFuente, subido_por: r.subidoPorEmail, importado_en: iso(r.importadoEn), motores: r.motores || [], indexado: !!r.indexado, actualizado_en: iso(Date.now()) });
    for (const h of await api.listFindings(token)) f.hallazgos.push({ org_id: orgId, id: h.id, grabacion_id: h.recordingId, camara_id: h.cameraId, clase: h.clase, etiqueta: h.etiqueta, inicio_s: h.inicio, fin_s: h.fin, t_abs: iso(h.tAbs), score: h.score, motor: h.motor, estado: h.estado, revisado_por: h.revisadoPor || null, categoria: h.categoria || null, detalle: h.detalle || null, atributos: h.atributos || null, track_id: h.trackId != null ? h.trackId : null, experimental: !!h.experimental, actualizado_en: iso(Date.now()) });
    if (api.can(token, 'medios.ver')) for (const d of await api.listDerivatives(token)) f.derivados.push({ org_id: orgId, id: d.id, tipo: d.tipo, grabacion_id: d.recordingId, camara_id: d.cameraId, nombre: d.nombre, sha256: d.sha256, origen_sha256: d.origenSha256, inicio_s: d.inicio, fin_s: d.fin, metodo: d.metodo, transformacion: d.transformacion, creado_por: d.creadoPor, creado_en: iso(d.creadoEn), actualizado_en: iso(Date.now()) });
    for (const c of await api.listCases(token)) {
      f.expedientes.push({ org_id: orgId, id: c.id, codigo: c.codigo, titulo: c.titulo, descripcion: c.descripcion, prioridad: c.prioridad, estado: c.estado, aprobacion: c.aprobacion, creado_por: c.creadoPor, creado_en: iso(c.creadoEn), actualizado_en: iso(Date.now()) });
      const { evidencias } = await api.getCase(token, c.id);
      evidencias.forEach(e => f.evidencias.push({ org_id: orgId, id: e.id, expediente_id: e.caseId, tipo: e.tipo, ref_id: e.refId, clasificacion: e.clasificacion, nota: e.nota, agregado_por: e.agregadoPor, en: iso(e.en), actualizado_en: iso(Date.now()) }));
    }
    for (const a of await api.listAnalyses(token)) {
      const R = a.resultado; const ev = {};
      (await api.listFindings(token, { recordingId: a.recordingId })).filter(h => h.categoria === 'analitica').forEach(h => ev[h.clase] = (ev[h.clase] || 0) + 1);
      f.analisis.push({ org_id: orgId, id: a.id, grabacion_id: a.recordingId, camara_id: a.cameraId, motor: R.motor, ia: !!R.ia, ocupacion: R.ocupacion, puertas: R.puertas, calor: R.calor, parametros: R.parametros, configuracion: a.configuracion, eventos_por_tipo: ev, actualizado_en: iso(Date.now()) });
      R.conteos.forEach(c => f.conteos.push({ org_id: orgId, id: a.recordingId + ':' + c.lineaId, grabacion_id: a.recordingId, camara_id: a.cameraId, linea_id: c.lineaId, linea: c.linea, clase: c.clase, entradas: c.entradas, salidas: c.salidas, cruces: c.cruces, actualizado_en: iso(Date.now()) }));
    }
    if (api.can(token, 'auditoria.ver')) for (const a of (await api.auditLog(token, { limit: 1000 })).items) f.auditoria.push({ org_id: orgId, id: a.id, usuario: a.email, accion: a.accion, recurso: a.recurso, recurso_id: a.recursoId, detalle: a.detalle, ts: iso(a.ts), prev: a.prev, hash: a.hash });
    return f;
  };

  /** Sube las filas por lotes (upsert). La auditoría sólo se inserta (nunca se modifica en la nube). */
  C.sincronizar = async function (api, token, orgId, onProgress) {
    if (!C.user) throw new V.VigiaError('NO_AUTENTICADO', 'Inicie sesión en la nube primero.');
    const f = await C.filas(api, token, orgId); const resumen = {};
    const tablas = [['camaras', 'vigia_camaras'], ['grabaciones', 'vigia_grabaciones'], ['hallazgos', 'vigia_hallazgos'], ['derivados', 'vigia_derivados'], ['expedientes', 'vigia_expedientes'], ['evidencias', 'vigia_evidencias'], ['conteos', 'vigia_conteos'], ['analisis', 'vigia_analisis'], ['auditoria', 'vigia_auditoria']];
    let i = 0;
    for (const [k, t] of tablas) {
      const rows = f[k]; resumen[k] = rows.length;
      for (let p = 0; p < rows.length; p += 500) {
        const lote = rows.slice(p, p + 500);
        chk(await C.cliente().from(t).upsert(lote, { onConflict: 'org_id,id', ignoreDuplicates: k === 'auditoria' }), 'Sincronizar ' + k);
      }
      if (onProgress) onProgress(++i / tablas.length, k);
    }
    chk(await C.cliente().from('vigia_sincronizaciones').insert({ org_id: orgId, resumen }), 'Registro de sincronización');
    await api._audit(api._ctx(token), 'nube.sincronizar', 'organizacion_nube', orgId, resumen);
    return resumen;
  };
  C.conteos = async function (orgId) {
    const out = {};
    for (const t of ['vigia_camaras', 'vigia_grabaciones', 'vigia_hallazgos', 'vigia_derivados', 'vigia_expedientes', 'vigia_evidencias', 'vigia_conteos', 'vigia_analisis']) {
      const r = await C.cliente().from(t).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
      out[t.replace('vigia_', '')] = r.error ? '—' : r.count;
    }
    const s = await C.cliente().from('vigia_sincronizaciones').select('en,resumen').eq('org_id', orgId).order('en', { ascending: false }).limit(1);
    out.ultima = s.data && s.data[0] ? s.data[0].en : null;
    return out;
  };
})();
