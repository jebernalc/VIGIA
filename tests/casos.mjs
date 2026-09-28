// Verifica los casos de uso de analítica sobre el video sintético con eventos conocidos (tools/gen_casos.py).
// Uso: node tests/casos.mjs [--ia]
import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const IA = process.argv.includes('--ia');
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('file://' + path.resolve('app/VIGIA.html')); await p.waitForFunction(() => window.V && V.app.api);
await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__t'; document.body.appendChild(i); });
await p.setInputFiles('#__t', path.resolve('tests/muestra_casos_vp9.mp4'));
const r = await p.evaluate(async (ia) => {
  const api = V.app.api; const { creds } = await api.bootstrapDemo(); const t = (await api.login(creds[0].email, creds[0].password)).token;
  window.__tok = t;
  const cam = await api.saveCamera(t, { nombre: 'Salón principal', tipo: 'archivo', tz: 'America/Bogota', mascaras: [{ x: 0, y: 0, w: 0.53, h: 0.08 }], analitica: V.analitica.configDemo() });
  if (ia) await V.ia.cargar();
  await api.importRecording(t, cam.id, document.getElementById('__t').files[0], { ia });
  const t0 = Date.now(); while (!(await api.listRecordings(t))[0].indexado) { const j = (await api.listJobs(t))[0]; if (j.estado === 'fallido') return { error: j.error }; await V.sleep(1000); }
  const rec = (await api.listRecordings(t))[0];
  const fs = (await api.listFindings(t, { recordingId: rec.id })).sort((a, b) => a.inicio - b.inicio);
  const an = await api.getAnalysis(t, rec.id);
  return { ms: Date.now() - t0, motores: rec.motores, hallazgos: fs.map(f => ({ clase: f.clase, etiqueta: f.etiqueta, inicio: f.inicio, fin: f.fin, score: f.score, atributos: f.atributos || null, detalle: f.detalle || null })), conteos: an && an.resultado.conteos.map(c => ({ linea: c.linea, entradas: c.entradas, salidas: c.salidas, cruces: c.cruces })), ocupacion: an && an.resultado.ocupacion.map(o => ({ zona: o.zona, max: o.max })) };
}, IA);
fs.writeFileSync('/tmp/claude-0/casos_' + (IA ? 'ia' : 'sin') + '.json', JSON.stringify(r, null, 1));
if (r.error) { console.log('ERROR', r.error); process.exit(1); }
console.log('tiempo', (r.ms / 1000).toFixed(0) + ' s', r.motores.join(','));
for (const f of r.hallazgos) console.log(String(f.inicio).padStart(4), '-', String(f.fin).padEnd(4), f.clase.padEnd(18), f.etiqueta, f.atributos ? JSON.stringify([f.atributos.superior, f.atributos.inferior]) : '');
console.log('conteos', JSON.stringify(r.conteos && r.conteos.map(c => [c.linea, c.entradas, c.salidas, c.cruces.map(x => x.t + x.sentido[0])])), 'ocupación', JSON.stringify(r.ocupacion));
if (errs.length) console.log('ERRORES', errs.slice(0, 5));
await b.close();
