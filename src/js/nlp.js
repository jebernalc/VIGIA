/* VIGÍA · nlp.js — intérprete determinista de solicitudes en español (sin servicios externos).
 * interpretar(texto, contexto) -> plan { intent, camaras, ventana, clases, clip, caso, regla, supuestos, faltantes, confianza }
 * El intérprete sólo EXTRAE entidades; nunca ejecuta nada ni modifica permisos. El texto de notas,
 * OCR o nombres de archivo nunca pasa por aquí como instrucción. */
(function (root) {
  'use strict';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!]/g, ' ').replace(/\s+/g, ' ').trim();

  const NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cuarenta_y_cinco: 45, cincuenta: 50, sesenta: 60, noventa: 90, cien: 100 };
  function numWords(t) {
    t = t.replace(/\bmedia hora\b/g, '30 minutos').replace(/\bun cuarto de hora\b/g, '15 minutos').replace(/\bcuarenta y cinco\b/g, '45').replace(/\bhora y media\b/g, '90 minutos');
    t = t.replace(/\b(treinta|cuarenta|cincuenta) y (uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, (m, a, b) => String(NUM[a] + NUM[b]));
    return t.replace(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|noventa|cien)\b(?=\s+(segundos?|minutos?|horas?|seg|min|s|m|h|mas|camaras?|clips?)\b)/g, m => String(NUM[m]));
  }
  const UNIT = u => /^h/.test(u) ? 3600 : /^m/.test(u) ? 60 : 1;
  const DUR_RE = /(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m|horas?|h)\b/;
  function hms(str) { // "00:01:00" | "1:30" (mm:ss si <3 partes y contexto posición) -> segundos
    const p = str.split(':').map(Number); if (p.some(isNaN)) return null;
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 3600 + p[1] * 60; // HH:MM por defecto
    return null;
  }

  // Eventos de analítica (se evalúan antes que las clases genéricas)
  const EVENTOS = [
    { re: /\bpuertas? (abiertas?|sin cerrar|quedo abierta|quedaron abiertas)|\babrieron la puerta|\bpuerta\b.*\babierta/, g: 'puerta_abierta' },
    { re: /\b(humo|incendios?|fuego|conato)\b/, g: 'humo' },
    { re: /\b(mal (parqueados?|estacionados?|parqueadas?|estacionadas?)|parqueo indebido|estacionamiento indebido|zona de no (parquear|parqueo|estacionar)|parqueados? donde no)\b/, g: 'mal_parqueado' },
    { re: /\b(merodeo|merodeando|merodea|merodearon|rondando|permanece|permanecio|permanecieron|tiempo en (la )?zona|sospechos[oa]s? quiet[oa]s?)\b/, g: 'merodeo' },
    { re: /\b(intrusion(es)?|intrus[oa]s?|zona restringida|ingreso no autorizado|acceso no autorizado|entraron a la bodega)\b/, g: 'intrusion' },
    { re: /\b(objetos? abandonados?|paquetes? abandonados?|bultos?|maletas? abandonadas?|objeto sospechoso|dejaron (algo|un objeto|una caja))\b/, g: 'objeto_abandonado' },
    { re: /\b(manipulacion|sabotaje|vandalismo de camara|camaras? (tapadas?|cubiertas?|obstruidas?|movidas?|desenfocadas?|bloqueadas?)|(tapo|taparon|cubrio|cubrieron|obstruyo|obstruyeron|bloqueo|bloquearon|movio|movieron|giraron|desenfoco|desenfocaron) (la |las )?camaras?)\b/, g: 'manipulacion' },
    { re: /\b(aglomeracion(es)?|multitud(es)?|ocupacion maxima|sobrecupo|exceso de aforo)\b/, g: 'aglomeracion' },
    { re: /\b(en grupo|tailgating|colados?|se colaron|entraron juntos|ingreso grupal)\b/, g: 'ingreso_grupal' },
    { re: /\b(cruces? de linea|cruzaron la linea|cruzo la linea)\b/, g: 'cruce_linea' }
  ];
  const COLORES = { negro: 'negro', negra: 'negro', negros: 'negro', negras: 'negro', oscuro: 'negro', blanco: 'blanco', blanca: 'blanco', blancos: 'blanco', blancas: 'blanco', gris: 'gris', grises: 'gris', rojo: 'rojo', roja: 'rojo', rojos: 'rojo', rojas: 'rojo', naranja: 'naranja', naranjas: 'naranja', anaranjado: 'naranja', anaranjada: 'naranja', amarillo: 'amarillo', amarilla: 'amarillo', verde: 'verde', verdes: 'verde', azul: 'azul', azules: 'azul', celeste: 'azul', morado: 'morado', morada: 'morado', violeta: 'morado', lila: 'morado', rosado: 'rosado', rosada: 'rosado', rosa: 'rosado', fucsia: 'rosado', marron: 'marrón', cafe: 'marrón', beige: 'marrón' };
  const PRENDA_SUP = /\b(camisa|camiseta|chaqueta|saco|buzo|blusa|abrigo|chaleco|sudadera|polo|chamarra|uniforme|parte superior|torso)\b/;
  const PRENDA_INF = /\b(pantalon(es)?|jean(s)?|falda|short(s)?|bermuda|sudadera de abajo|parte inferior|piernas)\b/;
  function atributosDe(t) {
    const re = new RegExp('\\b(' + Object.keys(COLORES).join('|') + ')\\b', 'g'); const out = {}; let m;
    while ((m = re.exec(t))) {
      const c = COLORES[m[1]]; const antes = t.slice(Math.max(0, m.index - 28), m.index);
      if (PRENDA_INF.test(antes)) out.inferior = c; else if (PRENDA_SUP.test(antes)) out.superior = c; else if (!out.cualquiera) out.cualquiera = c;
    }
    return Object.keys(out).length ? out : null;
  }

  const CLASES = [
    { re: /\b(personas?|gente|individuos?|peatones?|sujetos?|hombres?|mujeres?|alguien)\b/, g: 'persona' },
    { re: /\b(vehiculos?|carros?|autos?|automoviles?|coches?|motos?|motocicletas?|camion(es)?|camionetas?|bus(es)?|buses|bicicletas?|bicis?)\b/, g: 'vehiculo' },
    { re: /\b(animales?|gatos?|perros?)\b/, g: 'animal' },
    { re: /\b(mochilas?|bolsos?|maletas?)\b/, g: 'objeto' },
    { re: /\b(movimientos?|actividad|cambios?)\b/, g: 'movimiento' }
  ];

  function camarasDe(t, ctx) {
    const cams = ctx.camaras || [], out = new Set(); let origen = null;
    if (/\btodas las camaras\b|\ben todas\b|\bcualquier camara\b|\balgunas? (de las )?camaras?\b|\ben las camaras\b/.test(t)) { cams.forEach(c => out.add(c.id)); return { ids: [...out], origen: 'todas' }; }
    // grupos
    for (const g of (ctx.grupos || [])) { const n = norm(g.nombre); if (n && (t.includes('grupo ' + n) || new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t))) { g.cameraIds.forEach(i => out.add(i)); origen = 'grupo:' + g.nombre; } }
    // "camara(s) 1, 2 y 3" | "cam 2" | "cam-01"
    const m = t.match(/\bcam(?:ara)?s?\s*[-#]?\s*((?:\d+)(?:\s*(?:,|y|e)\s*\d+)*)/);
    if (m) { m[1].split(/\s*(?:,|y|e)\s*/).map(Number).forEach(n => { const c = cams.find(c => c.numero === n) || cams.find(c => norm(c.codigo) === 'cam-' + String(n).padStart(2, '0')); if (c) out.add(c.id); else out.add('__no_existe_' + n); }); origen = origen || 'mencionada'; }
    // por nombre
    for (const c of cams) { const n = norm(c.nombre); if (n.length >= 4 && t.includes(n)) { out.add(c.id); origen = origen || 'mencionada'; } }
    if (!out.size) for (const c of cams) { const ws = norm(c.nombre).replace(/\(.*?\)/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !['camara', 'principal', 'entrada', 'general'].includes(w)); if (ws.some(w => new RegExp('\\b' + w + 's?\\b').test(t))) { out.add(c.id); origen = origen || 'mencionada (por nombre)'; } }
    return { ids: [...out], origen };
  }

  function ventanaDe(t, ctx) {
    let m;
    if ((m = t.match(/\b(?:entre|desde|de)\s+(?:las?\s+)?(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:y|a|hasta|al?)\s+(?:las?\s+)?(\d{1,2}:\d{2}(?::\d{2})?)/))) {
      const a = hms(m[1]), b = hms(m[2]); if (a != null && b != null) return { modo: 'hms', a, b, texto: 'entre ' + m[1] + ' y ' + m[2] };
    }
    if ((m = t.match(/\b(?:del?|desde el)\s+(minuto|segundo)\s+(\d+(?:[.,]\d+)?)\s+(?:al?|hasta el)\s+(?:minuto|segundo\s+)?(\d+(?:[.,]\d+)?)/))) {
      const u = m[1] === 'minuto' ? 60 : 1; return { modo: 'posicion', a: parseFloat(m[2].replace(',', '.')) * u, b: parseFloat(m[3].replace(',', '.')) * u, texto: m[0] };
    }
    if ((m = t.match(/\bultim[oa]s?\s+(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m|horas?|h)\b/))) {
      const s = parseFloat(m[1].replace(',', '.')) * UNIT(m[2]); return { modo: 'ultimos', segundos: s, texto: m[0] };
    }
    if ((m = t.match(/\bultim[oa]\s+(hora|minuto)\b/))) return { modo: 'ultimos', segundos: m[1] === 'hora' ? 3600 : 60, texto: m[0] };
    if (/\btod[oa] (el|la) (video|grabacion|archivo)|\bcompleto\b|\btodo el periodo\b/.test(t)) return { modo: 'todo', texto: 'toda la grabación' };
    if (/\bhoy\b/.test(t)) return { modo: 'hoy', texto: 'hoy' };
    if (/\bayer\b/.test(t)) return { modo: 'ayer', texto: 'ayer' };
    if (/\b(ahora|ahorita|en este momento|en vivo|actualmente|ya mismo)\b/.test(t)) return { modo: 'ahora', texto: 'ahora' };
    return null;
  }

  function interpretar(texto, ctx) {
    ctx = ctx || {}; const est = ctx.estado || {};
    const t0 = norm(texto); let t = numWords(t0);
    const esSeguimiento = /^(y |ahora |pero )?(solo|solamente|unicamente)\b/.test(t);
    if (esSeguimiento) t = t.replace(/^(y |ahora |pero )/, '');
    const plan = { texto, intent: null, camaras: [], camarasOrigen: null, ventana: null, clases: [], supuestos: [], faltantes: [], confianza: 0.9 };
    const has = re => re.test(t);

    // ---- clases ----
    const eventos = EVENTOS.filter(e => e.re.test(t)).map(e => e.g);
    if (eventos.length) plan.clases = eventos;
    else for (const c of CLASES) if (c.re.test(t)) plan.clases.push(c.g);
    const atr = atributosDe(t);
    if (atr && (plan.clases.includes('persona') || /\b(vestid[oa]s?|de color|con (camisa|camiseta|chaqueta|saco|buzo|blusa|pantalon|jean|falda|uniforme))\b/.test(t))) { plan.atributos = atr; plan.clases = ['persona']; }
    if (plan.clases.length > 1 && plan.clases.includes('movimiento') && /\b(sin clasificar|solo movimiento)\b/.test(t) === false) plan.clases = plan.clases.filter(c => c !== 'movimiento' || !/\bcambios?\b/.test(t));

    // ---- intención ----
    if (has(/^(ayuda|help|\?)$|\bque puedes hacer\b|\bcomo te uso\b|\bcomandos\b|\bejemplos\b/)) plan.intent = 'ayuda';
    else if (has(/\b(avisame|alertame|notificame|alerta si|avisar si|vigila si|vigilar si|crea(r)? una regla|regla)\b/)) plan.intent = 'regla';
    else if (esSeguimiento && plan.clases.length) { plan.intent = (est.ultimoIntent === 'fotogramas' || !est.ultimoIntent) ? 'buscar' : est.ultimoIntent; plan.supuestos.push('Consulta de seguimiento: se reutilizan cámara y ventana anteriores con las nuevas clases.'); plan.seguimiento = true; }
    else if (has(/\b(amplia|ampliar|extiende|extender|agranda)\b/) || has(/^(y )?(\d+(?:[.,]\d+)?)\s*(segundos?|minutos?|horas?)\s+(mas\s+)?(antes|despues)\b/)) plan.intent = 'ampliar';
    else if (has(/\b(resume|resumen|resumir|estado del?)\b.*\b(caso|expediente)\b/)) plan.intent = 'resumir_caso';
    else if (!has(/\b(indicadores?|detecciones|hallazgos|expedientes|alertas|clips)\b/) && (has(/\bcuant[oa]s\b.*\b(ingres\w*|entr\w*|sal\w*|cruz\w*)\b/) || has(/\bcuant[oa]s\b.*\b(personas?|gente|vehiculos?|carros?|motos?|visitantes?)\b.*\b(hay|habia|estan|pasaron|visitaron)\b/) || has(/\b(conteo|aforo|contar|ocupacion actual|ocupacion del|flujo de personas|ingresos y salidas)\b/))) plan.intent = 'conteo';
    else if (has(/\b(genera|generar|crea|crear|elabora|elaborar|haz)\b.*\binforme\b/)) plan.intent = 'informe';
    else if (has(/\b(anade|agrega|anadir|agregar|adjunta|adjuntar|incluye|incluir)\b.*\b(caso|expediente)\b/)) plan.intent = 'agregar_caso';
    else if (has(/\b(abre|abrir|crea|crear|inicia|iniciar|nuevo)\b.*\b(caso|expediente)\b/)) plan.intent = 'abrir_caso';
    else if (has(/\b(clip|recorta|recortar|extrae (un |el )?(video|segmento)|segmento de video|corta|cortar)\b/) || (has(/\bextrae\b/) && has(/\b(antes|despues)\b/))) plan.intent = 'clip';
    else if (has(/\b(indicadores?|estadisticas?|metricas?|totales|tablero|kpi|cuant[oa]s)\b/) && !has(/\bcuant[oa]s? (personas|vehiculos)\b.*\b(entre|ultim)/)) plan.intent = 'indicadores';
    else if (has(/\b(que (sucede|pasa|ocurre|hay)|como esta|como se ve)\b/) && has(/\b(ahora|ahorita|en este momento|en vivo|actualmente)\b/)) plan.intent = 'ahora';
    else if (has(/\b(encuentra|encontrar|busca|buscar|detecta|detectar|hubo|aparece|aparecen|aparecio|localiza|rastrea|hay)\b/) || (plan.clases.length && !has(/\b(fotogramas?|imagen(es)?|capturas?|fotos?)\b/))) plan.intent = 'buscar';
    else if (has(/\b(fotogramas?|imagen(es)?|capturas?|fotos?|cuadros?|muestrame|mostrar|muestra|ver)\b/)) plan.intent = has(/\b(ahora|en vivo|en este momento)\b/) ? 'ahora' : 'fotogramas';
    else if (has(/\b(camaras|camara)\b/) && has(/\b(que|cuales|lista|listar|estado|disponibles|tengo|hay)\b/)) plan.intent = 'listar_camaras';

    if (plan.intent === 'conteo') { plan.conteo = { clase: plan.clases.includes('vehiculo') ? 'vehiculo' : 'persona', sentido: has(/\bsal\w*/) && !has(/\b(ingres|entr)\w*/) ? 'salida' : 'entrada' }; }
    // ---- cámaras ----
    const cm = camarasDe(t, ctx);
    plan.camaras = cm.ids.filter(i => !i.startsWith('__'));
    const inexistentes = cm.ids.filter(i => i.startsWith('__')).map(i => i.replace('__no_existe_', ''));
    if (inexistentes.length) plan.camarasInexistentes = inexistentes;
    plan.camarasOrigen = cm.origen;
    if (!plan.camaras.length && !inexistentes.length) {
      if (est.ultimasCamaras && est.ultimasCamaras.length && (plan.intent === 'ampliar' || plan.seguimiento || /\b(esa|esta|misma)\s+camara\b/.test(t) || plan.intent === 'clip')) { plan.camaras = est.ultimasCamaras.slice(); plan.camarasOrigen = 'contexto'; }
      else if (ctx.seleccion && ctx.seleccion.cameraIds && ctx.seleccion.cameraIds.length) { plan.camaras = ctx.seleccion.cameraIds.slice(); plan.camarasOrigen = 'seleccion'; }
    }

    // ---- ventana ----
    plan.ventana = ventanaDe(t, ctx);
    if (plan.intent === 'ahora' && (!plan.ventana || plan.ventana.modo !== 'ahora')) plan.ventana = { modo: 'ahora', texto: 'ahora' };
    if (plan.intent === 'fotogramas' && plan.ventana && plan.ventana.modo === 'ahora') plan.intent = 'ahora';

    // ---- clip ----
    if (plan.intent === 'clip') {
      const mA = t.match(/(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m)\s+antes/), mD = t.match(/(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m)\s+despues/);
      const mDur = t.match(/\bclip de (\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m)\b/);
      plan.clip = { antes: mA ? parseFloat(mA[1].replace(',', '.')) * UNIT(mA[2]) : null, despues: mD ? parseFloat(mD[1].replace(',', '.')) * UNIT(mD[2]) : null };
      if (mDur && plan.clip.antes == null && plan.clip.despues == null) { const d = parseFloat(mDur[1].replace(',', '.')) * UNIT(mDur[2]); plan.clip.antes = d / 2; plan.clip.despues = d / 2; }
      if (/\b(este|ese|el|del|al|dicho)\s+hallazgo\b|\bhallazgo\b|\bde esto\b|\beste evento\b/.test(t) || !plan.ventana) plan.referencia = { hallazgo: ctx.hallazgoSeleccionado || est.ultimoHallazgoId || null };
      if (plan.clip.antes == null && plan.clip.despues == null && !plan.ventana) { plan.clip.antes = 10; plan.clip.despues = 20; plan.supuestos.push('No se indicaron márgenes: se usan 10 s antes y 20 s después.'); }
      if (plan.referencia && !plan.referencia.hallazgo && !plan.ventana) plan.faltantes.push('hallazgo');
    }
    // ---- ampliar ----
    if (plan.intent === 'ampliar') {
      const mA = t.match(/(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m|horas?|h)\s+(?:mas\s+)?antes/), mD = t.match(/(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min|m|horas?|h)\s+(?:mas\s+)?despues/);
      const md = t.match(DUR_RE);
      plan.ampliar = { antes: mA ? parseFloat(mA[1].replace(',', '.')) * UNIT(mA[2]) : 0, despues: mD ? parseFloat(mD[1].replace(',', '.')) * UNIT(mD[2]) : 0 };
      if (!mA && !mD && md) { const s = parseFloat(md[1].replace(',', '.')) * UNIT(md[2]); plan.ampliar = { antes: s, despues: s }; }
      plan.intentBase = est.ultimoIntent || 'buscar';
      if (!est.ultimaVentana) plan.faltantes.push('ventana_previa');
      plan.clases = plan.clases.length ? plan.clases : (est.ultimasClases || []);
    }
    // ---- caso ----
    if (['abrir_caso', 'resumir_caso', 'agregar_caso', 'informe'].includes(plan.intent)) {
      const mq = texto.match(/["“«']([^"”»']{3,120})["”»']/); const mc = t.match(/\bexp-?\s?(\d{4})-(\d{1,4})\b/);
      const mt = t.match(/\b(?:titulado|llamado|denominado|con titulo|titulo)\s+(.{3,120})$/);
      plan.caso = { titulo: mq ? mq[1] : mt ? mt[1] : null, codigo: mc ? ('EXP-' + mc[1] + '-' + mc[2].padStart(4, '0')) : null, conHallazgo: /\bhallazgo\b|\beste\b|\besto\b|\bclip\b/.test(t) };
      plan.referencia = { hallazgo: ctx.hallazgoSeleccionado || est.ultimoHallazgoId || null, clip: est.ultimoClipId || null };
    }
    // ---- regla ----
    if (plan.intent === 'regla') {
      const md = t.match(/\b(?:durante|por|en los proximos|las proximas|los proximos|proximos|proximas)\s+(\d+(?:[.,]\d+)?)\s*(minutos?|min|m|horas?|h)\b/);
      const clase = plan.clases.find(c => ['persona', 'vehiculo', 'movimiento', 'puerta_abierta', 'humo', 'mal_parqueado', 'merodeo', 'intrusion', 'objeto_abandonado', 'manipulacion', 'aglomeracion', 'ingreso_grupal'].includes(c)) || null;
      plan.regla = { clase, duracionMin: md ? parseFloat(md[1].replace(',', '.')) * UNIT(md[2]) / 60 : 30, destinatario: /\bsupervisor/.test(t) ? 'rol:supervisor' : /\ba mi\b|\bme\b|\bavisame|alertame|notificame/.test(t) ? 'yo' : 'rol:supervisor' };
      if (!md) plan.supuestos.push('Sin duración indicada: la regla dura 30 minutos.');
      if (!clase) plan.faltantes.push('clase_regla');
    }

    // ---- faltantes y supuestos ----
    const necesitaCam = ['fotogramas', 'buscar', 'ahora', 'regla', 'conteo'].includes(plan.intent);
    if (necesitaCam && !plan.camaras.length) plan.faltantes.push('camara');
    if (plan.camarasOrigen === 'seleccion') plan.supuestos.push('No se mencionó cámara: se usa la selección actual del panel.');
    if (plan.camarasOrigen === 'contexto') plan.supuestos.push('Se reutilizan las cámaras de la consulta anterior.');
    if (['fotogramas', 'buscar', 'conteo'].includes(plan.intent) && !plan.ventana) {
      if (plan.seguimiento && est.ultimaVentana) { plan.ventana = est.ultimaVentana; }
      else if (ctx.seleccion && ctx.seleccion.ventana) { plan.ventana = ctx.seleccion.ventana; plan.supuestos.push('Sin ventana en el texto: se usa la ventana seleccionada (' + (ctx.seleccion.ventana.texto || '') + ').'); }
      else { plan.ventana = { modo: 'todo', texto: 'toda la grabación disponible' }; plan.supuestos.push('Sin ventana: se consulta toda la grabación disponible.'); }
    }
    if (plan.intent === 'buscar' && !plan.clases.length) { plan.clases = ['persona', 'vehiculo']; plan.supuestos.push('Sin clase indicada: se buscan personas y vehículos.'); }
    if (!plan.intent) { plan.intent = 'desconocido'; plan.confianza = 0.2; }
    if (plan.supuestos.length) plan.confianza = Math.min(plan.confianza, 0.75);
    if (plan.faltantes.length) plan.confianza = Math.min(plan.confianza, 0.5);
    return plan;
  }

  const INTENTS = {
    ayuda: 'Ayuda', listar_camaras: 'Consultar cámaras', fotogramas: 'Solicitar fotogramas', ahora: '¿Qué sucede ahora?', buscar: 'Buscar eventos',
    clip: 'Extraer clip', abrir_caso: 'Abrir expediente', agregar_caso: 'Añadir al expediente', resumir_caso: 'Resumir expediente', informe: 'Generar informe',
    indicadores: 'Consultar indicadores', conteo: 'Conteo de entradas/salidas y ocupación', regla: 'Regla de vigilancia temporal', ampliar: 'Ampliar ventana (seguimiento)', desconocido: 'No reconocida'
  };
  const api = { interpretar, norm, INTENTS, hms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VIGIA_NLP = api;
})(typeof window !== 'undefined' ? window : globalThis);
