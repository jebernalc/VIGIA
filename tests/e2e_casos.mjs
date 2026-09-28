// Recorrido de CASOS DE USO por la interfaz con IA real (Chromium sin interfaz). Capturas en tests/capturas/casos_*.png
import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const shots = path.resolve('tests/capturas'); fs.mkdirSync(shots, { recursive: true });
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); const errs = []; let n = 0;
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const ok = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('OK  ' + m); };
const shot = async name => { await p.waitForTimeout(500); await p.screenshot({ path: path.join(shots, 'casos_' + String(++n).padStart(2, '0') + '_' + name + '.png') }); };
const ask = async (t) => { const k = await p.locator('.msg.v .txt').count(); await p.fill('#ci', t); await p.press('#ci', 'Enter'); await p.waitForFunction(k => document.querySelectorAll('.msg.v .txt').length > k && !document.querySelector('.msg.v .spin'), k, { timeout: 90000 }); await p.waitForTimeout(900); return p.locator('.msg.v .txt').last().innerText(); };
try {
  await p.goto('file://' + path.resolve('app/VIGIA.html'));
  await p.click('#boot'); await p.waitForSelector('.creds');
  const creds = await p.$$eval('.creds tr', rows => rows.slice(1).map(r => Array.from(r.cells).map(c => c.textContent)));
  await p.click('text=Ya las guardé'); await p.fill('#le', 'admin@norte.demo'); await p.fill('#lp', creds.find(c => c[0] === 'admin@norte.demo')[2]); await p.click('#lf button.pri'); await p.waitForSelector('.shell');
  await p.click('[data-nav=analitica]'); await p.waitForSelector('#vdemo');
  // el Chromium de pruebas no decodifica H.264: se sustituye la muestra embebida por la versión VP9 idéntica
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__t'; i.style.display = 'none'; document.body.appendChild(i); });
  await p.setInputFiles('#__t', path.resolve('tests/muestra_casos_vp9.mp4'));
  await p.evaluate(() => { V.media.cargarMuestra = async () => document.getElementById('__t').files[0]; });
  await p.click('#vdemo'); await p.waitForSelector('#ifu', { timeout: 60000 }); await p.waitForTimeout(300);
  ok(await p.isChecked('#iia'), 'motor IA cargado y marcado para el análisis');
  await p.fill('#ifu', 'Demostración de casos de uso'); await p.click('.modal .btn.pri');
  await p.click('[data-nav=ops]'); await p.waitForSelector('text=completado', { timeout: 600000 }); await shot('operaciones');
  await p.click('[data-nav=analitica]'); await p.waitForSelector('text=Eventos por tipo', { timeout: 30000 }); await p.waitForTimeout(1500); await shot('tablero');
  const kp = await p.$$eval('.kpi', els => els.map(e => e.innerText.replace(/\n/g, ' ')));
  console.log('   KPIs:', kp.slice(0, 6).join(' | '));
  ok(kp[0].includes('Ingresos 4') && kp[1].includes('Salidas 1'), 'tablero: 4 ingresos y 1 salida (guion: 4 y 1)');
  await p.locator('h2:has-text("Eventos detectados")').scrollIntoViewIfNeeded(); await shot('eventos');
  // chat de casos de uso
  await p.click('[data-nav=chat]'); await p.waitForSelector('#ci');
  let t = await ask('¿Cuántas personas han ingresado al salón?'); console.log('   ', t.slice(0, 160));
  ok(/4 ingreso/.test(t) && /1 salida/.test(t), 'conteo de ingresos al salón desde el chat'); await shot('chat_conteo');
  t = await ask('vehículos mal parqueados'); ok(/Encontré 1 evento/.test(t), 'vehículo mal estacionado'); await shot('chat_malparqueado');
  t = await ask('persona vestida de naranja'); ok(/Encontré [1-9]/.test(t) && /naranja/.test(t), 'búsqueda por color de prenda'); await shot('chat_color');
  t = await ask('¿la puerta quedó abierta?'); ok(/Encontré 1 evento/.test(t), 'puerta abierta');
  t = await ask('¿Hubo humo en alguna cámara?'); ok(/Encontré 1 evento/.test(t) && /EXPERIMENTAL/.test(t), 'humo (experimental, advertido)'); await shot('chat_humo');
  t = await ask('objetos abandonados'); ok(/Encontré 1 evento/.test(t), 'objeto abandonado (sin falsos positivos)');
  t = await ask('¿alguien tapó la cámara?'); ok(/Encontré 1 evento/.test(t), 'manipulación de cámara');
  t = await ask('merodeo en la zona restringida'); ok(/Encontré 2 evento/.test(t), 'merodeo + intrusión');
  t = await ask('¿entraron en grupo al salón?'); ok(/Encontré 1 evento/.test(t), 'ingreso en grupo (tailgating)');
  t = await ask('aglomeraciones en el salón'); ok(/Encontré 1 evento/.test(t), 'aglomeración (umbral 2)');
  // editor
  await p.click('[data-nav=analitica]'); await p.waitForSelector('#vcfg'); await p.click('#vcfg'); await p.waitForSelector('#aebox'); await p.waitForTimeout(800); await shot('editor');
  ok(await p.locator('#aelist .badge').count() === 5, 'editor muestra 3 zonas, 1 línea y 1 puerta');
  await p.click('.modal [data-x]');
  console.log('\nCasos de uso verificados por la interfaz.');
} catch (e) { console.error(e.message); await shot('error'); process.exitCode = 1; }
const reales = errs.filter(e => !/ERR_FILE_NOT_FOUND/.test(e)); if (reales.length) { console.log('Errores:\n' + reales.join('\n')); process.exitCode = 1; }
await b.close();
