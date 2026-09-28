// Prueba de la sincronización con Supabase usando un cliente simulado (sin red) y exporta las filas
// generadas para validarlas contra el esquema real con SQL.
import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('app/VIGIA.html')); await p.waitForFunction(() => window.V && V.app.api);
await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__t'; document.body.appendChild(i); });
await p.setInputFiles('#__t', path.resolve('tests/muestra_cam01_vp9.mp4'));
const r = await p.evaluate(async () => {
  const log = []; const calls = { upsert: {}, insert: [] };
  window.supabase = { createClient: (url, key) => { log.push(['createClient', url, key.slice(0, 16)]); return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'demo@vigia' } } } }) },
    from: t => ({ upsert: async (rows, opt) => { (calls.upsert[t] = calls.upsert[t] || []).push(...rows); log.push(['upsert', t, rows.length, JSON.stringify(opt)]); return { data: null, error: null }; },
                  insert: async row => { calls.insert.push([t, row]); return { data: null, error: null }; } }),
    rpc: async () => ({ data: null, error: null }) }; } };
  V.cloud.client = null;
  const api = V.app.api; const { creds } = await api.bootstrapDemo(); const t = (await api.login(creds[0].email, creds[0].password)).token;
  const cam = await api.saveCamera(t, { nombre: 'Portería', tipo: 'archivo', tz: 'America/Bogota' });
  await api.importRecording(t, cam.id, document.getElementById('__t').files[0], {});
  while (!(await api.listRecordings(t))[0].indexado) await V.sleep(300);
  const rec = (await api.listRecordings(t))[0]; const h = (await api.listFindings(t))[0];
  const clip = await V.media.makeClip(api, t, rec.id, 10, 30, {});
  const c = await api.createCase(t, { titulo: 'Caso nube' }); await api.addEvidence(t, c.id, { tipo: 'hallazgo', refId: h.id }); await api.addEvidence(t, c.id, { tipo: 'clip', refId: clip.id });
  const al = await api.alarmFromFinding(t, h.id); await api.updateAlert(t, al.id, { accion: 'reconocer' }); await api.savePlan(t, { camaras: { [cam.id]: { x: 0.4, y: 0.5, ang: 30 } } });
  await V.cloud.sesion();
  const org = '00000000-0000-0000-0000-00000000000a';
  const res = await V.cloud.sincronizar(api, t, org);
  const aud = (await api.auditLog(t)).items.some(a => a.accion === 'nube.sincronizar');
  return { configurada: V.cloud.configurada(), log, res, aud, filas: calls.upsert, sinc: calls.insert };
});
const f = r.filas;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FALLO ') + m); if (!c) process.exitCode = 1; };
ok(r.configurada, 'Supabase configurado desde vigia.config.js (clave publicable)');
ok(r.log[0][1] === 'https://vxolklytmkenflxevlwq.supabase.co' && r.log[0][2].startsWith('sb_publishable'), 'cliente creado con URL y clave publicable');
ok(f.vigia_camaras.length === 1 && f.vigia_grabaciones.length === 1 && f.vigia_hallazgos.length >= 1 && f.vigia_derivados.length === 1 && f.vigia_expedientes.length === 1 && f.vigia_evidencias.length === 2, 'filas generadas: ' + JSON.stringify(r.res));
ok(/^[0-9a-f]{64}$/.test(f.vigia_grabaciones[0].sha256) && f.vigia_derivados[0].origen_sha256 === f.vigia_grabaciones[0].sha256, 'hash del original y del derivado enlazados');
ok(!JSON.stringify(f).includes('blobKey') && !JSON.stringify(f).includes('"blob"'), 'no se envían videos ni referencias a blobs');
ok(r.log.find(x => x[1] === 'vigia_auditoria')[3].includes('"ignoreDuplicates":true'), 'auditoría sólo inserta (ignoreDuplicates)');
ok(r.sinc.length === 1 && r.sinc[0][0] === 'vigia_sincronizaciones', 'sincronización registrada en la nube');
ok(r.aud, 'sincronización registrada en la auditoría local');
ok(f.vigia_alarmas && f.vigia_alarmas.length === 1 && f.vigia_alarmas[0].estado === 'reconocida' && f.vigia_alarmas[0].sla_s > 0 && f.vigia_alarmas[0].dentro_sla === true, 'alarma con prioridad, SLA y estado sincronizada');
ok(f.vigia_planos && f.vigia_planos.length === 1 && Object.keys(f.vigia_planos[0].camaras).length === 1, 'plano del sitio sincronizado');
fs.writeFileSync('/tmp/claude-0/filas_nube.json', JSON.stringify(f));
if (errs.length) { console.log(errs); process.exitCode = 1; }
await b.close();
