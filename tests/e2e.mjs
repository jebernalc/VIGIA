// Prueba de humo del recorrido principal A TRAVÉS DE LA INTERFAZ (Chromium sin interfaz, file://).
import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const shots = path.resolve('tests/capturas'); fs.mkdirSync(shots, { recursive: true });
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage(); const errs = []; let n = 0;
p.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('OK  ' + m); };
const shot = async name => { await p.waitForTimeout(400); await p.screenshot({ path: path.join(shots, String(++n).padStart(2, '0') + '_' + name + '.png') }); };
const ask = async (t, wait) => {
  const before = await p.locator('.msg.v').count();
  await p.fill('#ci', t); await p.press('#ci', 'Enter');
  await p.waitForFunction(k => document.querySelectorAll('.msg.v .txt').length > k && !document.querySelector('.msg.v .spin'), before, { timeout: wait || 60000 });
  await p.waitForTimeout(700);
  return (await p.locator('.msg.v .txt').last().innerText());
};
try {
  await p.goto('file://' + path.resolve('app/VIGIA.html'));
  await p.click('details summary'); await p.click('#tlocal'); await p.click('#boot'); await p.waitForSelector('.creds');
  const creds = await p.$$eval('.creds tr', rows => rows.slice(1).map(r => Array.from(r.cells).map(c => c.textContent)));
  ok(creds.length === 8 && creds.every(c => c[2].length === 12), '8 credenciales aleatorias generadas');
  await shot('credenciales'); await p.click('text=Ya las guardé');
  const pw = e => creds.find(c => c[0] === e)[2];
  const login = async (e, org) => { await p.fill('#le', e); await p.fill('#lp', pw(e)); await p.click('#lf button.pri'); if (org) { await p.waitForSelector('input[name=org]'); await p.locator('#orgpick label', { hasText: org }).locator('input').check(); await p.click('#lf button.pri'); } await p.waitForSelector('.shell'); };
  await shot('login'); await login('admin@norte.demo');
  await p.waitForSelector('text=Pregúntele a VIGÍA'); ok(true, 'sesión iniciada, chat como vista principal');
  // cámara
  await p.click('[data-nav=ops]'); await p.click('#onew');
  await p.fill('#cn', 'Parqueadero norte'); await p.fill('#cs', 'Sede Norte'); await p.fill('#czn', 'Parqueadero'); await p.fill('#cu', 'Poste 3, vista a la rampa');
  await p.click('.modal .btn.pri'); await p.waitForSelector('.tile');
  ok(await p.isVisible('text=CAM-01') && (await p.locator('.tile .hd').first().innerText()).includes('Parqueadero norte') && !(await p.locator('.tile .hd').first().innerText()).includes('norteParq'), 'cámara creada con nombre, ubicación y zona horaria');
  // importar
  await p.click('#oimp'); await p.waitForTimeout(200); await p.setInputFiles('#ifile', path.resolve('tests/muestra_cam01_vp9.mp4'));
  await p.fill('#ifu', 'Exportación sintética de prueba'); await p.click('.modal .btn.pri');
  await p.waitForSelector('text=completado', { timeout: 120000 }); await p.waitForTimeout(800);
  await shot('operaciones_indexado');
  ok(await p.isVisible('text=indexado'), 'video importado e indexado asíncronamente con progreso real');
  // chat
  await p.click('[data-nav=chat]'); await p.waitForSelector('#ci');
  let t = await ask('muéstrame fotogramas de cámara 1 en los últimos 5 minutos disponibles');
  ok(/HISTÓRICA/.test(t) && await p.locator('.msg.v').last().locator('.fcard img').count() > 0, 'fotogramas reales con cámara y marca temporal (histórico)');
  await shot('chat_fotogramas');
  t = await ask('encuentra personas o vehículos entre 00:01:00 y 00:03:00');
  ok(/no distingue|No puedo afirmar/.test(t), 'sin IA: declara la limitación sin inventar detecciones');
  await shot('chat_busqueda_sin_ia');
  t = await ask('busca movimiento entre 00:01:00 y 00:03:00');
  ok(/Encontré \d+ hallazgo/.test(t), 'movimiento encontrado en la ventana');
  await p.locator('.msg.v').last().locator('[data-act=sel-h]').first().click();
  t = await ask('extrae un clip desde 10 segundos antes hasta 20 segundos después de este hallazgo');
  ok(/Clip listo/.test(t) && /sin recodificar/.test(t), 'clip MP4 sin recodificar con hash');
  await p.waitForSelector('.msg.v >> nth=-1 >> video');
  await shot('chat_clip');
  const dl = p.waitForEvent('download'); await p.locator('.msg.v').last().locator('[data-act=dl]').click(); const d = await dl;
  ok((await d.suggestedFilename()).endsWith('.mp4'), 'clip descargable (' + await d.suggestedFilename() + ')');
  t = await ask('amplía cinco minutos antes');
  ok(/hallazgo|Sin evidencia/.test(t), 'consulta de seguimiento');
  t = await ask('abre un caso "Movimiento en rampa" con este hallazgo');
  ok(/EXP-\d{4}-0001/.test(t), 'expediente abierto desde el chat');
  // expediente
  await p.locator('.msg.v').last().locator('[data-act=open-case]').click(); await p.waitForSelector('#xn');
  await p.fill('#xn', 'Posible ingreso por la rampa; verificar con portería.'); await p.click('#xah'); await p.waitForTimeout(500);
  const popup = ctx.waitForEvent('page'); await p.click('#xrh'); const rep = await popup; await rep.waitForLoadState();
  const rtxt = await rep.content(); ok(/Lagunas de cobertura/.test(rtxt) && /SHA-256/.test(rtxt), 'informe HTML con fuentes y limitaciones');
  await rep.screenshot({ path: path.join(shots, String(++n).padStart(2, '0') + '_informe.png'), fullPage: false }); await rep.close();
  const dl2 = p.waitForEvent('download'); await p.click('#xrp'); const d2 = await dl2; ok((await d2.suggestedFilename()).endsWith('.pdf'), 'informe PDF descargable');
  await shot('expediente');
  // en vivo (emulación) y regla
  await p.click('[data-nav=ops]'); await p.click('[data-o=start]'); await p.waitForSelector('text=conectada', { timeout: 20000 }); await p.waitForTimeout(3500);
  await shot('vivo_emulacion');
  await p.click('[data-nav=chat]'); await p.waitForSelector('#ci');
  t = await ask('¿qué sucede ahora en la cámara 1?');
  ok(/EMULACIÓN/.test(t) && /edad/.test(t), '«ahora» devuelve el último cuadro con edad y etiqueta de emulación');
  await shot('chat_ahora');
  t = await ask('avísame si hay movimiento en la cámara 1 durante 5 minutos');
  ok(/NO activa/.test(t), 'regla con vista previa sin activarse');
  await p.locator('.msg.v').last().locator('[data-act=regla-ok]').click(); await p.click('.modal .btn.pri');
  await p.waitForFunction(() => document.body.innerText.includes('ALERTA'), null, { timeout: 150000 });
  ok(true, 'alerta disparada por movimiento real en la transmisión emulada');
  // indicadores
  await p.click('[data-nav=indicadores]'); await p.waitForSelector('.kpi'); await shot('indicadores');
  const kp = await p.locator('.kpi').first().innerText(); ok(/1/.test(kp), 'tablero con totales reales');
  await p.click('[data-nav=admin]'); await p.click('[data-t=auditoria]'); await p.click('#av'); await p.waitForSelector('text=Cadena íntegra'); ok(true, 'auditoría verificada desde la interfaz');
  await shot('auditoria');
  await p.click('[data-t=nube]'); await p.waitForSelector('text=Iniciar sesión en la nube'); ok(await p.isVisible('text=vxolklytmkenflxevlwq'), 'pestaña Nube (Supabase) configurada'); await shot('nube');
  // otra organización
  await p.click('#lo'); await p.waitForSelector('#lf'); await login('admin@sur.demo');
  await p.click('[data-nav=ops]'); await p.waitForSelector('text=No hay cámaras');
  ok(true, 'la organización Sur no ve cámaras de Norte');
  await p.click('[data-nav=hallazgos]'); await p.waitForSelector('text=Sin hallazgos'); ok(true, 'ni sus hallazgos');
  await p.click('#lo'); await p.waitForSelector('#lf'); await login('consultor@demo', 'Sur');
  await p.waitForSelector('text=Organización Demo Sur'); ok(true, 'selección de organización al iniciar sesión');
  // tablet
  await p.setViewportSize({ width: 820, height: 1100 }); await p.click('#lo'); await p.waitForSelector('#lf'); await login('operador@norte.demo'); await p.waitForTimeout(800); await shot('tablet_chat');
  await p.setViewportSize({ width: 1440, height: 900 });
  console.log('\nRecorrido completo sin errores. Capturas en tests/capturas/');
} catch (e) { console.error(e.message); await shot('error'); process.exitCode = 1; }
if (errs.length) { console.log('Errores de consola:\n' + errs.join('\n')); process.exitCode = 1; }
await b.close();
