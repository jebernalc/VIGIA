// Ejecuta la suite interna de VIGÍA en Chromium sin interfaz (file://) con el video VP9 de prueba.
import { chromium } from 'playwright'; import path from 'path';
const IA = process.argv.includes('--ia');
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto('file://' + path.resolve('app/VIGIA.html'));
await p.waitForFunction(() => window.V && V.app && V.app.api, null, { timeout: 30000 });
await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__t'; document.body.appendChild(i); });
await p.setInputFiles('#__t', path.resolve('tests/muestra_cam01_vp9.mp4'));
const r = await p.evaluate(async (ia) => { const f = document.getElementById('__t').files[0]; const r = await V.tests.run({ file: f, ia }); return r; }, IA);
for (const c of r.casos) console.log((c.ok ? 'OK    ' : 'FALLO ') + c.nombre + ' (' + c.ms + ' ms)\n       ' + c.detalle);
console.log(`\n${r.ok} correctas, ${r.fallos} fallidas, ${(r.msTotal / 1000).toFixed(1)} s`);
if (errs.length) console.log('Errores de consola:\n' + errs.slice(0, 20).join('\n'));
await b.close(); process.exit(r.fallos ? 1 : 0);
