// Genera artifact/index.html (página publicada como artefacto de Claude) a partir de app/VIGIA.html:
// el publicador añade su propio esqueleto (doctype, head, body), así que se quitan los del archivo y la CSP local.
import fs from 'fs';
let h = fs.readFileSync('app/VIGIA.html', 'utf8');
const ini = h.indexOf('<head>'), fin = h.indexOf('</head>');
const head = h.slice(ini + 6, fin).replace(/<meta[^>]*>\s*/g, '').replace(/<title>[\s\S]*?<\/title>\s*/, '');
let body = h.slice(h.indexOf('<body>', fin) + 6);
body = body.slice(0, body.lastIndexOf('</body>'));
fs.mkdirSync('artifact', { recursive: true });
fs.writeFileSync('artifact/index.html', '<title>VIGÍA</title>\n' + head.trim() + '\n' + body.trim() + '\n');
console.log('artifact/index.html', Math.round(fs.statSync('artifact/index.html').size / 1024) + ' KB');
