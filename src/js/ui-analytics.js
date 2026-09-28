/* VIGÍA · ui-analytics.js — Analítica y casos de uso: catálogo, configuración de zonas/líneas/puertas,
 * resultados por grabación (conteos, ocupación, mapa de calor, puertas) y eventos. */
(function () {
  'use strict';
  const V = window.V, A = V.app, I = V.icons, esc = V.esc;
  const AN = () => V.analitica;

  // Casos de uso del mercado que NO se implementan en esta fase (con motivo)
  const FASE_POSTERIOR = [
    ['Reconocimiento facial / listas de vigilancia', 'Biometría: requiere base legal (Ley 1581 de 2012 en Colombia), evaluación de impacto, consentimiento y medición de sesgos. Excluido por defecto.'],
    ['Lectura de placas (LPR/ANPR)', 'Requiere modelo OCR especializado y cámaras dedicadas (ángulo, IR, obturación). Integrable vía conector de terceros.'],
    ['Detección de fuego/llama con cámara térmica', 'Requiere sensor térmico o modelo certificado; el humo actual es heurístico y experimental.'],
    ['EPP (casco, chaleco) y cumplimiento', 'Requiere modelo entrenado con clases de EPP; COCO-SSD no las incluye.'],
    ['Caída de persona / persona en el suelo', 'Requiere estimación de pose; alta tasa de falsos positivos con detectores genéricos.'],
    ['Detección de armas', 'Requiere modelo especializado y protocolo de verificación humana antes de alertar.'],
    ['Re-identificación entre cámaras (seguir a una persona por el sitio)', 'Requiere modelo de apariencia (embeddings) y calibración multi-cámara.'],
    ['Búsqueda en lenguaje natural por contenido visual (tipo «persona con bolso de marca»)', 'Requiere embeddings visión-lenguaje locales por organización (ARCHITECTURE.md).'],
    ['Audio: disparos, vidrios rotos, gritos', 'Requiere micrófonos y modelo de audio.'],
    ['Filas y tiempo de espera', 'Derivable del seguimiento + zona; pendiente de validación en sitio.']
  ];

  const view = A.views.analitica = {};
  view.camId = null; view.recId = null;
  view.render = async function (m) {
    const cams = await A.api.listCameras(A.token);
    if (!view.camId || !cams.find(c => c.id === view.camId)) view.camId = (cams.find(c => c.analitica) || cams[0] || {}).id || null;
    const cam = cams.find(c => c.id === view.camId);
    const recs = cam ? await A.api.listRecordings(A.token, cam.id) : [];
    if (!view.recId || !recs.find(r => r.id === view.recId)) view.recId = (recs.find(r => (r.motores || []).includes('analitica-v1')) || recs[0] || {}).id || null;
    const rec = recs.find(r => r.id === view.recId);
    const g = A.api.can(A.token, 'camaras.gestionar'), up = A.api.can(A.token, 'grabaciones.cargar');
    m.innerHTML = `<div class="view"><div class="row" style="margin-bottom:12px"><h1 class="h1 grow">Analítica y casos de uso</h1>
      ${up ? `<button class="btn" id="vdemo">${I.play} Cargar demostración de casos de uso</button>` : ''}
      ${cams.length ? `<select id="vcam" aria-label="Cámara">${cams.map(c => `<option value="${c.id}" ${c.id === view.camId ? 'selected' : ''}>${esc(c.codigo + ' · ' + c.nombre)}</option>`).join('')}</select>` : ''}
      ${cam && g ? `<button class="btn pri" id="vcfg">Configurar zonas, líneas y puertas</button>` : ''}</div>
      ${!cams.length ? '<div class="empty">No hay cámaras. Use «Cargar demostración de casos de uso» para crear una cámara con zonas, línea de acceso y puerta ya configuradas.</div>' : ''}
      <div id="vcat"></div><div id="vres" style="margin-top:14px"></div><div id="vev" style="margin-top:14px"></div></div>`;
    if (V.$('#vdemo')) V.$('#vdemo').onclick = () => A.cargarDemoCasos();
    if (V.$('#vcam')) V.$('#vcam').onchange = e => { view.camId = e.target.value; view.recId = null; view.render(m); };
    if (V.$('#vcfg')) V.$('#vcfg').onclick = async () => { if (await A.analyticsEditor(cam)) view.render(m); };
    if (!cam) return;
    V.$('#vcat').innerHTML = catalogo(cam, rec);
    V.$('#vcat').onclick = async e => { const b = e.target.closest('[data-cfg]'); if (b && g) { if (await A.analyticsEditor(cam)) view.render(m); } };
    await resultados(cam, recs, rec);
  };
  view.onData = what => { if (what !== 'jobs' && A.view === 'analitica') view.render(V.$('#main')); };

  function estadoCaso(k, T, cam, rec) {
    const a = cam.analitica; const mot = rec ? rec.motores || [] : [];
    if (T.cfg === 'linea' && !(a && a.lineas.length)) return ['warn', 'Configure una línea'];
    if (T.cfg === 'puerta' && !(a && a.puertas.length)) return ['warn', 'Configure una puerta'];
    if (T.cfg && T.cfg.startsWith('zona:') && !(a && a.zonas.some(z => z.uso === T.cfg.slice(5)))) return ['warn', 'Configure una zona «' + T.cfg.slice(5).replace('_', ' ') + '»'];
    if (T.ia && V.ia.estado !== 'listo' && !mot.some(x => x.startsWith('coco'))) return ['warn', 'Requiere motor IA local'];
    if (rec && !mot.includes('analitica-v1')) return ['info', 'Listo · reanalizar grabación'];
    return ['ok', T.exp ? 'Activo (experimental)' : 'Activo'];
  }
  function catalogo(cam, rec) {
    const T = AN().TIPOS;
    return `<div class="card"><div class="row"><h2 class="h2 grow">Casos de uso implementados</h2><span class="tiny muted">Estado para ${esc(cam.codigo)} · motor analitica-v1 + ${V.ia.estado === 'listo' ? 'COCO-SSD cargado' : 'IA no cargada'}</span></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr));margin-top:10px">${Object.entries(T).map(([k, t]) => { const [cls, txt] = estadoCaso(k, t, cam, rec); return `<div class="card" style="padding:10px;background:var(--panel2)"><div class="row"><span style="font-size:18px">${t.icono}</span><b class="grow small">${esc(t.nombre)}</b></div><div class="tiny muted" style="margin:4px 0 6px">${esc(t.desc)}</div><div class="row"><span class="badge ${cls}">${esc(txt)}</span>${t.ia ? '<span class="badge">IA</span>' : '<span class="badge">sin IA</span>'}${t.exp ? '<span class="badge warn">experimental</span>' : ''}${cls === 'warn' && t.cfg ? '<button class="btn xs right" data-cfg>configurar</button>' : ''}</div></div>`; }).join('')}
      <div class="card" style="padding:10px;background:var(--panel2)"><div class="row"><span style="font-size:18px">🎨</span><b class="grow small">Búsqueda por color de prenda</b></div><div class="tiny muted" style="margin:4px 0 6px">«persona con camisa roja», «pantalón negro», «vestida de naranja». Color dominante aproximado sin piel.</div><div class="row"><span class="badge ${V.ia.estado === 'listo' || (rec && (rec.motores || []).some(x => x.startsWith('coco'))) ? 'ok' : 'warn'}">${V.ia.estado === 'listo' || (rec && (rec.motores || []).some(x => x.startsWith('coco'))) ? 'Activo' : 'Requiere motor IA local'}</span><span class="badge">IA</span></div></div>
      <div class="card" style="padding:10px;background:var(--panel2)"><div class="row"><span style="font-size:18px">🔥</span><b class="grow small">Mapa de calor de ocupación</b></div><div class="tiny muted" style="margin:4px 0 6px">Dónde permanecen y transitan las personas (posición de los pies).</div><div class="row"><span class="badge ok">Activo</span><span class="badge">IA</span></div></div></div>
      <details style="margin-top:12px"><summary class="small" style="cursor:pointer"><b>Casos de uso del mercado en fase posterior</b> (${FASE_POSTERIOR.length}) — por qué no están activos</summary><table class="table small" style="margin-top:6px">${FASE_POSTERIOR.map(([n, w]) => `<tr><td style="width:34%"><b>${esc(n)}</b></td><td class="tx2">${esc(w)}</td></tr>`).join('')}</table></details></div>`;
  }

  async function resultados(cam, recs, rec) {
    const el = V.$('#vres'), ev = V.$('#vev');
    if (!rec) { el.innerHTML = '<div class="empty">La cámara no tiene grabaciones. Importe un video o use la demostración.</div>'; ev.innerHTML = ''; return; }
    const an = await A.api.getAnalysis(A.token, rec.id);
    const finds = (await A.api.listFindings(A.token, { recordingId: rec.id })).filter(f => f.categoria === 'analitica' || f.trackId != null);
    const evs = finds.filter(f => f.categoria === 'analitica');
    const porTipo = {}; evs.forEach(f => porTipo[f.clase] = (porTipo[f.clase] || 0) + 1);
    const R = an && an.resultado;
    const E = R ? R.conteos.reduce((a, c) => a + c.entradas, 0) : 0, S = R ? R.conteos.reduce((a, c) => a + c.salidas, 0) : 0;
    const occ = R ? R.ocupacion.reduce((m, o) => Math.max(m, o.max), 0) : 0;
    const personas = finds.filter(f => f.trackId != null && f.clase === 'person').length;
    el.innerHTML = `<div class="card"><div class="row"><h2 class="h2 grow">Resultados</h2><select id="vrec" aria-label="Grabación">${recs.map(r => `<option value="${r.id}" ${r.id === rec.id ? 'selected' : ''}>${esc(r.nombreArchivo)} · ${V.fmtDur(r.duracion)}</option>`).join('')}</select>
        ${A.api.can(A.token, 'grabaciones.cargar') ? `<button class="btn sm" id="vrea">${I.cpu} Reanalizar con la configuración actual</button>` : ''}</div>
      ${!an ? `<div class="alert-box" style="margin-top:10px">Esta grabación aún no tiene análisis de casos de uso${rec.indexado ? ' (se indexó antes de configurar la analítica). Pulse «Reanalizar».' : ' (indexación pendiente).'}</div>` : `
      <p class="tiny muted" style="margin:6px 0 10px">${rec.horaInicio ? esc(V.fmtDateTime(rec.horaInicio, cam.tz)) + ' → ' + esc(V.fmtTime(rec.horaInicio + rec.duracion * 1000, cam.tz)) : 'sin hora de captura'} · ${R.muestras} muestras · motores ${esc((rec.motores || []).join(', '))}${R.ia ? '' : ' · <b>sin IA: conteos, merodeo, intrusión y estacionamiento no disponibles</b>'}</p>
      <div class="kpis">${[['Ingresos', E, R.conteos.map(c => c.linea).join(', ') || 'sin línea'], ['Salidas', S, 'neto ' + (E - S >= 0 ? '+' : '') + (E - S)], ['Ocupación máxima', occ, R.ocupacion.map(o => o.zona).join(', ') || 'sin zona de ocupación'], ['Personas distintas (pistas)', personas, 'seguimiento en esta cámara'], ['Eventos de analítica', evs.length, Object.keys(porTipo).length + ' tipos'], ['Revisados', evs.filter(f => f.estado !== 'sugerido').length, 'de ' + evs.length]].map(([l, v, s]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join('')}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-top:12px">
        <div class="card"><h2 class="h2">Eventos por tipo</h2><div class="bars" style="margin-top:10px">${Object.keys(AN().TIPOS).filter(k => porTipo[k]).map(k => { const mx = Math.max(...Object.values(porTipo)); return `<div class="b" title="${esc(AN().TIPOS[k].nombre)}: ${porTipo[k]}"><span>${AN().TIPOS[k].icono} ${esc(AN().TIPOS[k].nombre.replace(/ \(.*/, ''))}</span><span class="t"><i style="width:${porTipo[k] / mx * 100}%;background:${A.claseColor(k)}"></i></span><b style="text-align:right">${porTipo[k]}</b></div>`; }).join('') || '<div class="empty">Sin eventos</div>'}</div></div>
        <div class="card"><h2 class="h2">Mapa de calor y configuración</h2><p class="tiny muted">Intensidad = muestras con personas (pies) en cada celda. Rectángulos: zonas; línea: acceso (flecha = sentido de entrada).</p><div style="position:relative;max-width:520px"><img id="vref" alt="Escena de referencia" style="width:100%;display:block;border-radius:6px"><canvas id="vheat" style="position:absolute;inset:0;width:100%;height:100%;border-radius:6px"></canvas><svg id="vsvg" viewBox="0 0 100 56.25" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%"></svg></div></div>
        <div class="card"><h2 class="h2">Línea de tiempo de la escena</h2><div id="vtl" style="margin-top:8px"></div></div>
      </div>`}</div>`;
    const vrec = V.$('#vrec'); if (vrec) vrec.onchange = e => { view.recId = e.target.value; view.render(V.$('#main')); };
    const vrea = V.$('#vrea'); if (vrea) vrea.onclick = async () => { try { await A.api.requeueAnalysis(A.token, rec.id, { ia: V.ia.estado === 'listo', analitica: true }); V.toast('Reanálisis encolado. Vea el progreso en Centro de operaciones.'); } catch (e) { V.fail(e); } };
    if (an) {
      const fr = await A.api.listFrames(A.token, rec.id, 0, 3);
      if (fr[0]) V.$('#vref').src = await A.mediaURL('fotograma', fr[0].id);
      V.$('#vref').onload = () => pintarCalor(R.calor);
      V.$('#vsvg').innerHTML = svgConfig(an.configuracion || cam.analitica);
      V.$('#vtl').innerHTML = lineaTiempo(rec, R, evs);
      V.$('#vtl').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { A.seleccion.cameraIds = [cam.id]; A.go('chat'); setTimeout(() => A.views.chat.openPlayer(rec.id, +b.dataset.t), 300); } };
    }
    const cards = await Promise.all(evs.slice().sort((a, b) => a.inicio - b.inicio).filter(f => f.clase !== 'cruce_linea').slice(0, 30).map(f => A.views.chat.findingCard(f)));
    ev.innerHTML = evs.length ? `<div class="card"><div class="row"><h2 class="h2 grow">Eventos detectados</h2><span class="tiny muted">Los cruces de línea individuales se ven en la línea de tiempo y en «¿cuántas personas ingresaron…?» del chat</span></div><div class="thumbs" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-top:10px">${cards.join('')}</div></div>` : '';
    A.hydrate(ev);
    ev.onclick = async e => { const b = e.target.closest('[data-act]'); if (!b) return; await A.views.hallazgos.onClick(e); if (b.dataset.act === 'rev') view.render(V.$('#main')); };
  }
  function pintarCalor(c) {
    const cv = V.$('#vheat'); if (!cv || !c) return; cv.width = c.w; cv.height = c.h; const g = cv.getContext('2d'); const mx = Math.max(1, ...c.grid);
    c.grid.forEach((v, i) => { if (!v) return; const a = Math.min(0.85, 0.15 + 0.7 * v / mx); g.fillStyle = `rgba(${Math.round(255 * Math.min(1, 2 * v / mx))},${Math.round(200 * (1 - v / mx))},40,${a})`; g.fillRect(i % c.w, Math.floor(i / c.w), 1, 1); });
    cv.style.imageRendering = 'auto'; cv.style.filter = 'blur(3px)'; cv.style.opacity = '0.8';
  }
  function svgConfig(a) {
    if (!a) return '';
    const H = 56.25, col = { restringida: '#ef5b5b', no_parqueo: '#e8a317', ocupacion: '#19c2ad', general: '#5b9df0' };
    const r = (x, c, lbl) => `<rect x="${x.x * 100}" y="${x.y * H}" width="${x.w * 100}" height="${x.h * H}" fill="${c}22" stroke="${c}" stroke-width=".4"/><text x="${x.x * 100 + 1}" y="${x.y * H + 3}" font-size="1.7" fill="${c}">${esc(lbl)}</text>`;
    return a.zonas.map(z => r(z.rect, col[z.uso], z.nombre)).join('') + a.puertas.map(p => r(p.rect, '#b98cf0', p.nombre)).join('') + a.lineas.map(l => {
      const mx = (l.a.x + l.b.x) / 2 * 100, my = (l.a.y + l.b.y) / 2 * H; const dx = (l.b.x - l.a.x) * 100, dy = (l.b.y - l.a.y) * H; const n = Math.hypot(dx, dy) || 1; const s = -(l.sentidoEntrada || 1); const nx = s * dy / n * 5, ny = -s * dx / n * 5;
      return `<line x1="${l.a.x * 100}" y1="${l.a.y * H}" x2="${l.b.x * 100}" y2="${l.b.y * H}" stroke="#ffd166" stroke-width=".6"/><line x1="${mx}" y1="${my}" x2="${mx + nx}" y2="${my + ny}" stroke="#ffd166" stroke-width=".6" marker-end="url(#ar)"/><text x="${mx + nx + 1}" y="${my + ny}" font-size="1.7" fill="#ffd166">entrada</text>`;
    }).join('') + '<defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#ffd166"/></marker></defs>';
  }
  function lineaTiempo(rec, R, evs) {
    const D = rec.duracion || 1; const filas = {};
    evs.forEach(f => (filas[f.clase] = filas[f.clase] || []).push(f));
    const pct = t => (t / D * 100).toFixed(2) + '%';
    const rows = Object.entries(filas).map(([k, fs]) => `<div class="row" style="gap:6px;margin:3px 0;flex-wrap:nowrap"><span class="tiny" style="width:150px;flex:none">${AN().TIPOS[k] ? AN().TIPOS[k].icono + ' ' + esc(AN().TIPOS[k].nombre.replace(/ \(.*/, '')) : esc(k)}</span><div class="tl" style="height:14px;margin:0;flex:1">${fs.map(f => `<div class="mk" data-t="${f.tMejor}" title="${esc(f.etiqueta)} ${V.fmtDur(f.inicio)}–${V.fmtDur(f.fin)}" style="top:2px;height:10px;cursor:pointer;left:${pct(f.inicio)};width:${Math.max(0.8, (f.fin - f.inicio + 1) / D * 100)}%;background:${A.claseColor(k)}"></div>`).join('')}</div></div>`).join('');
    const pu = (R.puertas || []).map(p => `<div class="row" style="gap:6px;margin:3px 0;flex-wrap:nowrap"><span class="tiny" style="width:150px;flex:none">🚪 ${esc(p.puerta)}</span><div class="tl" style="height:14px;margin:0;flex:1">${p.serie.filter(x => x.abierta).map(x => `<div class="mk" style="top:2px;height:10px;left:${pct(x.t)};width:${100 / D}%;background:var(--c-evento)"></div>`).join('')}</div></div>`).join('');
    return (rows + pu || '<div class="empty">Sin eventos</div>') + `<div class="row tiny muted" style="justify-content:space-between;margin-left:156px"><span>${V.fmtDur(0)}</span><span>${V.fmtDur(D / 2)}</span><span>${V.fmtDur(D)}</span></div><p class="tiny muted">Clic en un evento para verlo en el reproductor.</p>`;
  }

  // ---------------- editor de analítica ----------------
  A.analyticsEditor = async function (cam) {
    const cfg = JSON.parse(JSON.stringify(cam.analitica || AN().configVacia()));
    const recs = await A.api.listRecordings(A.token, cam.id); let img = '';
    if (recs[0]) { const fr = await A.api.listFrames(A.token, recs[0].id, 0, 3); if (fr[0]) img = await A.mediaURL('fotograma', fr[0].id); }
    let modo = 'ocupacion';
    const USOS = [['ocupacion', 'Zona de ocupación / aforo'], ['restringida', 'Zona restringida (intrusión, merodeo)'], ['no_parqueo', 'Zona de no estacionar'], ['linea', 'Línea de conteo (entrada/salida)'], ['puerta', 'Puerta (abierta/cerrada)']];
    const col = { restringida: '#ef5b5b', no_parqueo: '#e8a317', ocupacion: '#19c2ad', general: '#5b9df0' };
    const html = `<div class="row" style="margin-bottom:8px"><label class="f">Herramienta<select id="aem">${USOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><span class="tiny muted grow">Arrastre sobre la imagen para dibujar. Las líneas se dibujan del punto A al B; «invertir» cambia el sentido de entrada.</span></div>
      <div id="aebox" class="maskedit" style="width:100%;${img ? '' : 'aspect-ratio:16/9;background:#05070a'}">${img ? `<img src="${img}" alt="Referencia" draggable="false" style="width:100%">` : ''}<svg id="aesvg" viewBox="0 0 100 56.25" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%"></svg></div>
      <div id="aelist" class="small" style="margin-top:8px"></div>
      <details style="margin-top:8px"><summary class="small" style="cursor:pointer">Parámetros</summary><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));margin-top:6px">${[['merodeoS', 'Merodeo (s)'], ['parqueoS', 'Estacionamiento indebido (s)'], ['puertaS', 'Puerta abierta (s)'], ['abandonoS', 'Objeto abandonado (s)'], ['umbralAglomeracion', 'Aglomeración (personas)'], ['tailgatingS', 'Ingreso en grupo (s)'], ['umbralPuerta', 'Puerta: fracción cambiada']].map(([k, l]) => `<label class="f">${l}<input type="number" step="any" data-par="${k}" value="${cfg.parametros[k]}"></label>`).join('')}</div></details>`;
    const draw = bg => {
      const svg = bg.querySelector('#aesvg'); const H = 56.25;
      svg.innerHTML = cfg.zonas.map(z => `<rect x="${z.rect.x * 100}" y="${z.rect.y * H}" width="${z.rect.w * 100}" height="${z.rect.h * H}" fill="${col[z.uso]}33" stroke="${col[z.uso]}" stroke-width=".4"/><text x="${z.rect.x * 100 + 1}" y="${z.rect.y * H + 3}" font-size="1.8" fill="#fff">${esc(z.nombre)}</text>`).join('') +
        cfg.puertas.map(p => `<rect x="${p.rect.x * 100}" y="${p.rect.y * H}" width="${p.rect.w * 100}" height="${p.rect.h * H}" fill="#b98cf033" stroke="#b98cf0" stroke-width=".4"/><text x="${p.rect.x * 100 + 1}" y="${p.rect.y * H + 3}" font-size="1.8" fill="#fff">${esc(p.nombre)}</text>`).join('') +
        cfg.lineas.map(l => { const mx = (l.a.x + l.b.x) / 2 * 100, my = (l.a.y + l.b.y) / 2 * H, dx = (l.b.x - l.a.x) * 100, dy = (l.b.y - l.a.y) * H, n = Math.hypot(dx, dy) || 1, s = -(l.sentidoEntrada || 1); return `<line x1="${l.a.x * 100}" y1="${l.a.y * H}" x2="${l.b.x * 100}" y2="${l.b.y * H}" stroke="#ffd166" stroke-width=".7"/><line x1="${mx}" y1="${my}" x2="${mx + s * dy / n * 6}" y2="${my - s * dx / n * 6}" stroke="#ffd166" stroke-width=".7"/><circle cx="${mx + s * dy / n * 6}" cy="${my - s * dx / n * 6}" r=".9" fill="#ffd166"/><text x="${l.a.x * 100 + 1}" y="${l.a.y * H - 1}" font-size="1.8" fill="#ffd166">${esc(l.nombre)}</text>`; }).join('');
      const item = (tipo, x, i, extra) => `<div class="row" style="padding:3px 0;border-bottom:1px solid var(--line)"><span class="badge">${tipo}</span><input type="text" value="${esc(x.nombre)}" data-ren="${tipo}:${i}" style="padding:3px 6px;width:200px">${extra || ''}<button class="btn xs danger right" data-del="${tipo}:${i}">quitar</button></div>`;
      bg.querySelector('#aelist').innerHTML = (cfg.zonas.map((z, i) => item('zona', z, i, ' <span class="tiny muted">' + esc(USOS.find(u => u[0] === z.uso)[1]) + '</span>')).join('') + cfg.lineas.map((l, i) => item('linea', l, i, ' <button class="btn xs" data-inv="' + i + '">invertir sentido</button>')).join('') + cfg.puertas.map((p, i) => item('puerta', p, i)).join('')) || '<span class="muted">Sin elementos. Dibuje sobre la imagen.</span>';
    };
    const r = await V.modal('Analítica · ' + cam.codigo + ' ' + cam.nombre, html, [{ label: 'Cancelar', value: null }, { label: 'Guardar configuración', cls: 'pri', value: true }], {
      wide: true, onOpen: bg => {
        const box = bg.querySelector('#aebox'); let st = null, cur = null; draw(bg);
        bg.querySelector('#aem').onchange = e => modo = e.target.value;
        const pos = e => { const rc = box.getBoundingClientRect(); return { x: V.clamp((e.clientX - rc.left) / rc.width, 0, 1), y: V.clamp((e.clientY - rc.top) / rc.height, 0, 1) }; };
        box.onmousedown = e => {
          st = pos(e); const n = { ocupacion: 'Aforo', restringida: 'Zona restringida', no_parqueo: 'No estacionar', linea: 'Acceso', puerta: 'Puerta' }[modo] + ' ' + ((modo === 'linea' ? cfg.lineas : modo === 'puerta' ? cfg.puertas : cfg.zonas).length + 1);
          if (modo === 'linea') { cur = { id: V.id('l'), nombre: n, a: st, b: st, sentidoEntrada: 1 }; cfg.lineas.push(cur); }
          else if (modo === 'puerta') { cur = { id: V.id('p'), nombre: n, rect: { x: st.x, y: st.y, w: 0, h: 0 } }; cfg.puertas.push(cur); }
          else { cur = { id: V.id('z'), nombre: n, uso: modo, rect: { x: st.x, y: st.y, w: 0, h: 0 } }; cfg.zonas.push(cur); }
          e.preventDefault();
        };
        box.onmousemove = e => { if (!st) return; const p = pos(e); if (cur.a) cur.b = p; else cur.rect = { x: Math.min(st.x, p.x), y: Math.min(st.y, p.y), w: Math.abs(p.x - st.x), h: Math.abs(p.y - st.y) }; draw(bg); };
        const up = () => { if (!st) return; const tiny = cur.a ? Math.hypot(cur.b.x - cur.a.x, cur.b.y - cur.a.y) < 0.03 : (cur.rect.w < 0.02 || cur.rect.h < 0.02); if (tiny) [cfg.lineas, cfg.puertas, cfg.zonas].forEach(arr => { const i = arr.indexOf(cur); if (i >= 0) arr.splice(i, 1); }); st = null; cur = null; draw(bg); };
        window.addEventListener('mouseup', up);
        bg.querySelector('#aelist').onclick = e => {
          const d = e.target.closest('[data-del]'), inv = e.target.closest('[data-inv]');
          if (d) { const [t, i] = d.dataset.del.split(':'); ({ zona: cfg.zonas, linea: cfg.lineas, puerta: cfg.puertas })[t].splice(+i, 1); draw(bg); }
          if (inv) { const l = cfg.lineas[+inv.dataset.inv]; l.sentidoEntrada = -(l.sentidoEntrada || 1); draw(bg); }
        };
        bg.querySelector('#aelist').oninput = e => { const x = e.target.closest('[data-ren]'); if (x) { const [t, i] = x.dataset.ren.split(':'); ({ zona: cfg.zonas, linea: cfg.lineas, puerta: cfg.puertas })[t][+i].nombre = x.value; } };
        V.$$('[data-par]', bg).forEach(inp => inp.oninput = () => cfg.parametros[inp.dataset.par] = +inp.value);
      }
    });
    if (!r) return false;
    try {
      const full = (await A.api.listCameras(A.token)).find(c => c.id === cam.id);
      await A.api.saveCamera(A.token, Object.assign({}, full, { analitica: cfg }));
      V.toast('Configuración de analítica guardada');
      const indexadas = recs.filter(x => x.indexado);
      if (indexadas.length && await V.confirmar('Reanalizar grabaciones', '¿Aplicar la nueva configuración a las ' + indexadas.length + ' grabación(es) de esta cámara? Se reemplazan los eventos sugeridos no revisados.', 'Reanalizar')) {
        for (const x of indexadas) { try { await A.api.requeueAnalysis(A.token, x.id, { ia: V.ia.estado === 'listo', analitica: true }); } catch (e) { V.toast(V.errMsg(e), 'warn'); } }
        V.toast('Reanálisis encolado');
      }
      return true;
    } catch (e) { V.fail(e); return false; }
  };

  /** Crea la cámara de demostración con la configuración de casos de uso e importa el video correspondiente. */
  A.cargarDemoCasos = async function () {
    try {
      let cams = await A.api.listCameras(A.token);
      let cam = cams.find(c => c.nombre === 'Salón principal (demo analítica)');
      if (!cam) {
        if (!A.api.can(A.token, 'camaras.gestionar')) return V.toast('Su rol no puede crear cámaras.', 'warn');
        cam = await A.api.saveCamera(A.token, { nombre: 'Salón principal (demo analítica)', tipo: 'archivo', tz: 'America/Bogota', sede: 'Sede demo', zona: 'Salón y acceso', ubicacion: 'Video sintético con eventos conocidos (tools/gen_casos.py)', mascaras: [{ x: 0, y: 0, w: 0.53, h: 0.08, nombre: 'Sello de tiempo' }], analitica: AN().configDemo() });
      }
      V.toast('Cargando video de demostración de casos de uso…');
      const f = await V.media.cargarMuestra('casos');
      if (V.ia.estado !== 'listo') { V.toast('Cargando motor IA local (necesario para conteo, merodeo, intrusión y estacionamiento)…', '', 8000); try { await V.ia.cargar(); } catch (e) { V.toast('Motor IA no disponible: ' + e.message, 'warn', 9000); } }
      await A.importDialog(cam.id, f);
      view.camId = cam.id; view.recId = null;
    } catch (e) { V.fail(e); }
  };
})();
