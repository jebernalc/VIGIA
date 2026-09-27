/* VIGÍA · reports.js — informe preliminar de expediente (HTML autocontenido + PDF) con fuentes y limitaciones */
(function () {
  'use strict';
  const V = window.V; const R = V.reports = {};
  const esc = V.esc;
  const CLS = { hipotesis: 'Hipótesis', sugerido_ia: 'Hallazgo sugerido por IA / motor automático', revisado: 'Hallazgo revisado por persona', confirmado: 'Incidente confirmado' };
  R.CLS = CLS;

  async function blobToDataURL(blob, maxW) {
    const bmp = await createImageBitmap(blob); const W = Math.min(maxW || 480, bmp.width), H = Math.round(W * bmp.height / bmp.width);
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(bmp, 0, 0, W, H);
    return c.toDataURL('image/jpeg', 0.8);
  }

  /** Reúne todos los datos del expediente (con autorización) en una estructura neutral. */
  R.recopilar = async function (api, token, caseId) {
    const s = api.session(token);
    const { caso, evidencias, notas } = await api.getCase(token, caseId);
    const cams = await api.listCameras(token); const camById = id => cams.find(c => c.id === id);
    const items = []; const recIds = new Set();
    for (const e of evidencias) {
      const it = { e, titulo: '', camara: null, intervalo: '', tAbs: null, t: null, sha256: null, origenSha256: null, metodo: '', motor: '', img: null, estado: '' };
      try {
        if (e.tipo === 'hallazgo') {
          const f = await api.getFinding(token, e.refId); const rec = f.recordingId ? await api.getRecording(token, f.recordingId) : null; if (rec) recIds.add(rec.id);
          it.camara = camById(f.cameraId); it.titulo = 'Hallazgo: ' + f.etiqueta + ' (confianza máx. ' + Math.round(f.score * 100) + '%)';
          it.intervalo = 'pos. ' + V.fmtDur(f.inicio) + '–' + V.fmtDur(f.fin) + (f.tAbs ? ' · ' + V.fmtDateTime(f.tAbs, it.camara && it.camara.tz) : ' · sin hora de captura');
          it.tAbs = f.tAbs; it.t = f.inicio; it.motor = f.motor; it.estado = f.estado + (f.revisadoPor ? ' por ' + f.revisadoPor : '');
          it.origenSha256 = rec ? rec.sha256 : null; it.origen = rec ? rec.nombreArchivo : '';
          try { const m = await api.mediaURL(token, 'fotograma', f.frameId, 'ver'); it.img = await blobToDataURL(m.blob, 360); URL.revokeObjectURL(m.url); it.imgNota = 'Miniatura de índice (320 px) en ' + V.fmtDur(f.tMejor); } catch (_) { }
        } else if (e.tipo === 'clip' || e.tipo === 'fotograma') {
          const d = await api.getDerivative(token, e.refId); if (d.recordingId) recIds.add(d.recordingId);
          it.camara = camById(d.cameraId); it.titulo = (d.tipo === 'clip' ? 'Clip derivado' : 'Fotograma exportado') + ': ' + d.nombre;
          it.intervalo = d.inicio != null ? 'pos. ' + V.fmtDur(d.inicio, true) + '–' + V.fmtDur(d.fin, true) + (d.solicitado ? ' (solicitado ' + V.fmtDur(d.solicitado.inicio, true) + '–' + V.fmtDur(d.solicitado.fin, true) + ')' : '') : (d.tAbs ? V.fmtDateTime(d.tAbs, it.camara && it.camara.tz) : '');
          it.tAbs = d.tAbs; it.t = d.inicio; it.sha256 = d.sha256; it.origenSha256 = d.origenSha256; it.metodo = d.metodo + ' · ' + d.transformacion; it.comando = d.comandoEquivalente; it.estado = 'creado por ' + d.creadoPor;
          if (d.tipo === 'fotograma') { try { const m = await api.mediaURL(token, 'derivado', d.id, 'ver'); it.img = await blobToDataURL(m.blob, 480); URL.revokeObjectURL(m.url); it.imgNota = 'Fotograma exportado'; } catch (_) { } }
        } else if (e.tipo === 'grabacion') {
          const r = await api.getRecording(token, e.refId); recIds.add(r.id); it.camara = camById(r.cameraId); it.titulo = 'Grabación original: ' + r.nombreArchivo;
          it.intervalo = 'duración ' + V.fmtDur(r.duracion); it.tAbs = r.horaInicio; it.sha256 = r.sha256;
        }
      } catch (err) { it.titulo = 'Referencia no accesible (' + err.message + ')'; }
      items.push(it);
    }
    const recs = []; for (const id of recIds) { try { recs.push(await api.getRecording(token, id)); } catch (_) { } }
    return { s, caso, items, notas, recs, cams: [...new Set(items.map(i => i.camara).filter(Boolean))], generado: Date.now() };
  };

  function lagunas(recs) {
    const out = [];
    for (const r of recs) {
      if (r.horaInicio == null) out.push('«' + r.nombreArchivo + '» no contiene hora de captura: los tiempos son posiciones dentro del archivo, no horas reales.');
      else if (r.horaInicioFuente === 'metadatos_contenedor') out.push('«' + r.nombreArchivo + '»: la hora de inicio proviene de los metadatos del contenedor (creation_time), que puede reflejar la codificación y no la captura.');
      else if (r.horaInicioFuente === 'declarada_por_usuario') out.push('«' + r.nombreArchivo + '»: hora de inicio declarada manualmente por quien cargó el archivo.');
      if (!(r.motores || []).some(m => m.startsWith('coco'))) out.push('«' + r.nombreArchivo + '» sólo se analizó con detección de movimiento: no se clasificaron personas ni vehículos.');
      if (r.ultimoIndice) out.push('«' + r.nombreArchivo + '»: muestreo de análisis de 1 cuadro cada ' + r.ultimoIndice.paso + ' s; eventos más breves pueden no detectarse.');
    }
    return out;
  }

  R.html = function (d) {
    const tz = (d.cams[0] && d.cams[0].tz) || V.defaultTZ();
    const orden = d.items.slice().sort((a, b) => (a.tAbs || 0) - (b.tAbs || 0) || (a.t || 0) - (b.t || 0));
    const cl = {}; d.items.forEach(i => cl[i.e.clasificacion] = (cl[i.e.clasificacion] || 0) + 1);
    const lg = lagunas(d.recs);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe ${esc(d.caso.codigo)}</title>
<style>body{font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;color:#15181d;max-width:900px;margin:24px auto;padding:0 16px;background:#fff}h1{font-size:22px;margin:0}h2{font-size:16px;border-bottom:2px solid #0b6e6e;padding-bottom:4px;margin-top:28px;color:#0b4f4f}
.meta{color:#555;font-size:12px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccd;padding:6px;vertical-align:top;text-align:left}th{background:#eef4f4}
.hash{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all}.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;background:#e7eef7}
.warn{background:#fff6e0;border-left:4px solid #e0a100;padding:8px 12px}img{max-width:100%;border:1px solid #ccd;border-radius:4px}.ev{display:grid;grid-template-columns:1fr 260px;gap:12px;border:1px solid #dde;border-radius:6px;padding:10px;margin:10px 0}
@media print{.ev{break-inside:avoid}}</style></head><body>
<p class="meta">VIGÍA · Informe PRELIMINAR · ${esc(d.s.orgNombre)}</p>
<h1>${esc(d.caso.codigo)} — ${esc(d.caso.titulo)}</h1>
<p class="meta">Estado: <b>${esc(d.caso.estado)}</b> · Aprobación: <b>${esc(d.caso.aprobacion)}</b>${d.caso.aprobadoPor ? ' por ' + esc(d.caso.aprobadoPor) : ''} · Prioridad: ${esc(d.caso.prioridad)} · Creado por ${esc(d.caso.creadoPor)} el ${esc(V.fmtDateTime(d.caso.creadoEn, tz))}<br>Informe generado por ${esc(d.s.email)} (${esc(d.s.rolNombre)}) el ${esc(V.fmtDateTime(d.generado, tz))}</p>
<div class="warn">Documento preliminar generado automáticamente a partir de evidencias registradas. Los hallazgos «sugeridos» provienen de motores automáticos y pueden contener falsos positivos o negativos. Este informe no constituye un dictamen sobre la admisibilidad legal de la evidencia, que depende de la jurisdicción y del procedimiento aplicable.</div>
<h2>1. Resumen</h2><p>${esc(d.caso.descripcion || 'Sin descripción.')}</p>
<p>${d.items.length} evidencia(s): ${Object.entries(cl).map(([k, v]) => v + ' · ' + esc(CLS[k] || k)).join('; ') || 'ninguna'}. ${d.notas.length} nota(s)/hipótesis.</p>
<h2>2. Cronología</h2><table><tr><th>Momento</th><th>Evento</th><th>Clasificación</th></tr>
${orden.map(i => `<tr><td>${esc(i.intervalo)}</td><td>${esc(i.titulo)}${i.camara ? '<br><span class="meta">' + esc(i.camara.codigo + ' · ' + i.camara.nombre) + '</span>' : ''}</td><td><span class="tag">${esc(CLS[i.e.clasificacion] || i.e.clasificacion)}</span></td></tr>`).join('') || '<tr><td colspan=3>Sin eventos.</td></tr>'}
${d.notas.map(n => `<tr><td>${esc(V.fmtDateTime(n.en, tz))}</td><td>${n.tipo === 'hipotesis' ? '<b>Hipótesis:</b> ' : 'Nota: '}${esc(n.texto)}<br><span class="meta">${esc(n.autor)}</span></td><td><span class="tag">${n.tipo === 'hipotesis' ? 'Hipótesis' : 'Nota'}</span></td></tr>`).join('')}</table>
<h2>3. Cámaras revisadas</h2><table><tr><th>Código</th><th>Nombre</th><th>Ubicación</th><th>Zona horaria</th><th>Fuente</th></tr>${d.cams.map(c => `<tr><td>${esc(c.codigo)}</td><td>${esc(c.nombre)}</td><td>${esc([c.sede, c.zona, c.ubicacion].filter(Boolean).join(' · '))}</td><td>${esc(c.tz)}</td><td>${esc(c.fuente)}</td></tr>`).join('') || '<tr><td colspan=5>—</td></tr>'}</table>
<h2>4. Evidencias y metadatos</h2>
${d.items.map((i, k) => `<div class="ev"><div><b>E${k + 1}. ${esc(i.titulo)}</b><br><span class="tag">${esc(CLS[i.e.clasificacion] || '')}</span> ${esc(i.estado)}<br>Intervalo: ${esc(i.intervalo)}${i.motor ? '<br>Motor: ' + esc(i.motor) : ''}${i.metodo ? '<br>Método: ' + esc(i.metodo) : ''}${i.comando ? '<br>Comando equivalente: <span class="hash">' + esc(i.comando) + '</span>' : ''}
${i.sha256 ? '<br>SHA-256: <span class="hash">' + esc(i.sha256) + '</span>' : ''}${i.origenSha256 ? '<br>SHA-256 del original' + (i.origen ? ' «' + esc(i.origen) + '»' : '') + ': <span class="hash">' + esc(i.origenSha256) + '</span>' : ''}
<br><span class="meta">ID evidencia ${esc(i.e.id)} · referencia ${esc(i.e.refId)} · añadida por ${esc(i.e.agregadoPor)} el ${esc(V.fmtDateTime(i.e.en, tz))}</span>${i.e.nota ? '<br>Nota: ' + esc(i.e.nota) : ''}</div>
<div>${i.img ? '<img src="' + i.img + '" alt="Imagen de evidencia E' + (k + 1) + '"><div class="meta">' + esc(i.imgNota || '') + '</div>' : '<span class="meta">Sin imagen</span>'}</div></div>`).join('') || '<p>Sin evidencias vinculadas.</p>'}
<h2>5. Archivos originales</h2><table><tr><th>Archivo</th><th>SHA-256</th><th>Tamaño / códec</th><th>Hora de inicio</th><th>Cargado por</th></tr>${d.recs.map(r => `<tr><td>${esc(r.nombreArchivo)}<br><span class="meta">${esc(r.fuenteDeclarada)}</span></td><td class="hash">${esc(r.sha256)}</td><td>${esc(V.fmtBytes(r.size))} · ${esc(r.codec || '')} ${esc(r.ancho + '×' + r.alto)} · ${esc(V.fmtDur(r.duracion))}</td><td>${r.horaInicio ? esc(V.fmtDateTime(r.horaInicio, r.tz)) + '<br><span class="meta">fuente: ' + esc(r.horaInicioFuente) + '</span>' : 'desconocida'}</td><td>${esc(r.subidoPorEmail)}<br><span class="meta">${esc(V.fmtDateTime(r.importadoEn, r.tz))}</span></td></tr>`).join('') || '<tr><td colspan=5>—</td></tr>'}</table>
<h2>6. Método</h2><ul><li>Originales conservados sin alteración, identificados por SHA-256 calculado al importar; derivados almacenados por separado con referencia al original.</li>
<li>Indexación: muestreo de 1 cuadro por segundo (2 s en archivos &gt; 1 h) decodificado por el navegador; miniaturas JPEG de 320 px.</li>
<li>Detección de movimiento «movimiento-v1»: diferencia de luminancia entre cuadros muestreados (umbral 22/255, celdas 8×8 con ≥25% de píxeles cambiados, componente ≥3 celdas), con zonas de exclusión por cámara.</li>
<li>Clasificación opcional «coco-ssd-v2»: COCO-SSD (TensorFlow.js), umbral de confianza 0,50, ejecutado localmente sin servicios externos.</li>
<li>Clips MP4: copia de flujo sin recodificar, inicio alineado al fotograma clave anterior; clips WebM: recodificación señalada como transformación.</li></ul>
<h2>7. Lagunas de cobertura e incertidumbres</h2><ul>${lg.map(x => '<li>' + esc(x) + '</li>').join('')}<li>Las detecciones automáticas no se han validado contra un conjunto de referencia para esta instalación; su precisión en condiciones reales (iluminación, ángulo, oclusión) es desconocida.</li><li>No se aplicó reconocimiento facial, biometría ni lectura de placas.</li></ul>
<h2>8. Autoría y aprobación</h2><p>Autor del informe: ${esc(d.s.nombre)} (${esc(d.s.email)}). Estado de aprobación: <b>${esc(d.caso.aprobacion)}</b>${d.caso.aprobadoPor ? ' — aprobado por ' + esc(d.caso.aprobadoPor) + ' el ' + esc(V.fmtDateTime(d.caso.aprobadoEn, tz)) : ' — pendiente de revisión por supervisor'}.</p>
<p class="meta">La integridad de este documento se registra en la auditoría de VIGÍA mediante su SHA-256.</p></body></html>`;
  };

  R.generar = async function (api, token, caseId) {
    const d = await R.recopilar(api, token, caseId);
    const html = R.html(d);
    const r = await api.saveReport(token, caseId, html, 'html');
    r._datos = d; return r;
  };

  R.pdf = async function (api, token, caseId) {
    if (!window.jspdf) throw new V.VigiaError('DEPENDENCIA', 'Generador PDF no disponible');
    const d = await R.recopilar(api, token, caseId);
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 15; let y = M; const tz = (d.cams[0] && d.cams[0].tz) || V.defaultTZ();
    const need = h => { if (y + h > 297 - M) { doc.addPage(); y = M; } };
    const txt = (s, size, style, color) => { size = size || 10; doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size || 10); doc.setTextColor(...(color || [20, 24, 29])); const lines = doc.splitTextToSize(String(s), W - 2 * M); lines.forEach(l => { need(size * 0.45); doc.text(l, M, y); y += size * 0.45; }); y += 1; };
    const h2 = s => { y += 3; need(10); doc.setDrawColor(11, 110, 110); doc.line(M, y + 1.5, W - M, y + 1.5); txt(s, 12, 'bold', [11, 79, 79]); y += 1; };
    txt('VIGÍA · Informe PRELIMINAR · ' + d.s.orgNombre, 8, 'normal', [90, 90, 90]);
    txt(d.caso.codigo + ' — ' + d.caso.titulo, 16, 'bold');
    txt('Estado: ' + d.caso.estado + ' · Aprobación: ' + d.caso.aprobacion + ' · Generado por ' + d.s.email + ' el ' + V.fmtDateTime(d.generado, tz), 8, 'normal', [90, 90, 90]);
    txt('Documento preliminar. Hallazgos «sugeridos» provienen de motores automáticos y pueden contener errores. No constituye dictamen de admisibilidad legal.', 9, 'italic', [150, 100, 0]);
    h2('1. Resumen'); txt(d.caso.descripcion || 'Sin descripción.'); txt(d.items.length + ' evidencia(s), ' + d.notas.length + ' nota(s).');
    h2('2. Cronología');
    d.items.slice().sort((a, b) => (a.tAbs || 0) - (b.tAbs || 0)).forEach(i => txt('• ' + i.intervalo + ' — ' + i.titulo + ' [' + (CLS[i.e.clasificacion] || '') + ']', 9));
    d.notas.forEach(n => txt('• ' + V.fmtDateTime(n.en, tz) + ' — ' + (n.tipo === 'hipotesis' ? 'Hipótesis: ' : 'Nota: ') + n.texto + ' (' + n.autor + ')', 9));
    h2('3. Cámaras revisadas'); d.cams.forEach(c => txt('• ' + c.codigo + ' ' + c.nombre + ' · ' + [c.sede, c.zona, c.ubicacion].filter(Boolean).join(' · ') + ' · ' + c.tz, 9));
    h2('4. Evidencias');
    for (const [k, i] of d.items.entries()) {
      txt('E' + (k + 1) + '. ' + i.titulo, 10, 'bold'); txt('Intervalo: ' + i.intervalo + (i.motor ? ' · Motor: ' + i.motor : '') + (i.metodo ? ' · Método: ' + i.metodo : ''), 8);
      if (i.sha256) txt('SHA-256: ' + i.sha256, 7, 'normal', [60, 60, 60]); if (i.origenSha256) txt('SHA-256 original: ' + i.origenSha256, 7, 'normal', [60, 60, 60]);
      if (i.img) { const ih = 45; need(ih + 3); try { doc.addImage(i.img, 'JPEG', M, y, ih * 16 / 9, ih); } catch (_) { } y += ih + 3; }
    }
    h2('5. Archivos originales'); d.recs.forEach(r => { txt('• ' + r.nombreArchivo + ' · ' + V.fmtBytes(r.size) + ' · ' + V.fmtDur(r.duracion) + ' · inicio ' + (r.horaInicio ? V.fmtDateTime(r.horaInicio, r.tz) + ' (' + r.horaInicioFuente + ')' : 'desconocido'), 9); txt('  SHA-256 ' + r.sha256, 7, 'normal', [60, 60, 60]); });
    h2('6. Lagunas e incertidumbres'); lagunas(d.recs).forEach(x => txt('• ' + x, 9)); txt('• Precisión de los motores no validada para esta instalación. Sin reconocimiento facial, biometría ni lectura de placas.', 9);
    h2('7. Autoría y aprobación'); txt('Autor: ' + d.s.nombre + ' (' + d.s.email + '). Aprobación: ' + d.caso.aprobacion + (d.caso.aprobadoPor ? ' por ' + d.caso.aprobadoPor : ' — pendiente'), 9);
    const pages = doc.getNumberOfPages(); for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(120); doc.text(d.caso.codigo + ' · página ' + p + '/' + pages, W - M, 290, { align: 'right' }); }
    const blob = doc.output('blob');
    const sha = await V.sha256Blob(blob);
    const r = await api.saveReport(token, caseId, null, 'pdf', sha);
    return { blob, nombre: d.caso.codigo + '_informe_v' + r.version + '.pdf', sha256: r.sha256 };
  };
})();
