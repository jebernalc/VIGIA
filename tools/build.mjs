// Construye app/VIGIA.html (un único archivo autocontenido) + recursos opcionales.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const R = p => path.resolve(process.cwd(), p);
const JS = [
  'src/js/util.js', 'src/js/db.js', 'src/js/api.js',
  'node_modules/mp4box/dist/mp4box.all.min.js', 'src/js/mp4cut.js',
  'src/js/media.js', 'src/js/analytics.js', 'src/js/live.js', 'src/js/nlp.js', 'src/js/chat.js', 'src/js/reports.js',
  'node_modules/jspdf/dist/jspdf.umd.min.js', 'node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'src/js/cloud.js',
  'src/js/ui-core.js', 'src/js/ui-chat.js', 'src/js/ui-views.js', 'src/js/ui-analytics.js', 'src/js/caps.js', 'src/js/tests.js'
];
const safe = s => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
let html = fs.readFileSync(R('src/index.html'), 'utf8');
const css = fs.readFileSync(R('src/css/app.css'), 'utf8'); html = html.replace('<!--CSS-->', () => '<style>\n' + css + '\n</style>');
const pkg = JSON.parse(fs.readFileSync(R('package.json'), 'utf8'));
const banner = `/* VIGÍA edición local ${pkg.version} · construido ${new Date().toISOString()} · licencias de terceros: mp4box.js (BSD-3), jsPDF (MIT), supabase-js (MIT), TensorFlow.js y COCO-SSD (Apache-2.0) */`;
// mp4box.js declara variables globales sueltas (p. ej. «V»): se encapsula para no pisar el espacio de nombres de la app
const wrap = (f, code) => f.includes('mp4box') ? `(function(){var exports=undefined;\n${code}\n;window.MP4Box=MP4Box;})();` : code;
html = html.replace('<!--JS-->', () => '<script>' + banner + '</script>\n' + JS.map(f => `<script>/* ${f} */\n${safe(wrap(f, fs.readFileSync(R(f), 'utf8')))}\n</script>`).join('\n'));
fs.writeFileSync(R('app/VIGIA.html'), html);
// muestra embebida como script (file:// no permite fetch de archivos locales)
const mp4 = fs.readFileSync(R('app/muestras/muestra_cam01_h264.mp4'));
fs.writeFileSync(R('app/muestras/muestra_cam01_h264.js'), '/* Video sintético de demostración (sin personas reales salvo fotografía NASA de dominio público). SHA-256 ' + crypto.createHash('sha256').update(mp4).digest('hex') + ' */\nwindow.VIGIA_MUESTRA={nombre:"muestra_cam01_h264.mp4",b64:"' + mp4.toString('base64') + '"};\n');
const mp4c = fs.readFileSync(R('app/muestras/muestra_casos_h264.mp4'));
fs.writeFileSync(R('app/muestras/muestra_casos_h264.js'), '/* Video sintético de casos de uso (tools/gen_casos.py). SHA-256 ' + crypto.createHash('sha256').update(mp4c).digest('hex') + ' */\nwindow.VIGIA_MUESTRA_CASOS={nombre:"muestra_casos_h264.mp4",b64:"' + mp4c.toString('base64') + '"};\n');
console.log('VIGIA.html', (html.length / 1024).toFixed(0) + ' KB', '· muestra', (mp4.length / 1024).toFixed(0) + ' KB');
