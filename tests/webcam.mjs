// Verifica el adaptador de cámara web con el dispositivo simulado de Chromium.
import { chromium } from 'playwright'; import path from 'path';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); await p.goto('file://' + path.resolve('app/VIGIA.html')); await p.waitForFunction(() => window.V && V.app.api);
const r = await p.evaluate(async () => {
  const api = V.app.api; const { creds } = await api.bootstrapDemo(); const t = (await api.login(creds[0].email, creds[0].password)).token;
  const cam = await api.saveCamera(t, { nombre: 'Webcam recepción', tipo: 'webcam', tz: 'America/Bogota' });
  const t0 = performance.now(); await V.live.start(t, cam);
  while (!V.live.get(cam.id).last) await V.sleep(100); const first = performance.now() - t0;
  await V.sleep(11500);
  const n = V.live.now(cam); const clip = await V.live.contextClip(t, cam);
  const ans = await V.chat.ejecutar(api, '¿qué sucede ahora en la cámara 1?', { token: t, estado: {} });
  return { primerCuadroMs: Math.round(first), estado: n.estado, edadS: n.edadS.toFixed(2), buffer: V.live.get(cam.id).ring.length, clip: clip.nombre + ' ' + clip.size + 'B', respuesta: ans.texto };
});
console.log(JSON.stringify(r, null, 1)); await b.close();
