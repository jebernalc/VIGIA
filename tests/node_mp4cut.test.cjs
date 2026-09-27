// Prueba Node: corte sin recodificar sobre H.264/AAC y VP9/Opus, validado con ffprobe y hash.
const fs=require('fs'),crypto=require('crypto'),{execSync}=require('child_process');
const {cutMP4,parseMovie}=require('../src/js/mp4cut.js');
const assert=(c,m)=>{if(!c){console.error('FALLO: '+m);process.exitCode=1}else console.log('OK  '+m)};
(async()=>{
 for(const f of ['app/muestras/muestra_cam01_h264.mp4','tests/muestra_cam01_vp9.mp4']){
  const buf=fs.readFileSync(f); const reader={size:buf.length,read:async(o,l)=>new Uint8Array(buf.buffer,buf.byteOffset+o,l).slice()};
  const mv=await parseMovie(reader); assert(Math.abs(mv.duration-200)<0.2,f+' duración 200s ('+mv.duration+')');
  const r=await cutMP4(reader,85,115);
  const out=Buffer.concat(r.parts.map(p=>Buffer.from(p))); const o='/tmp/claude-0/clip_'+f.split('/').pop(); fs.writeFileSync(o,out);
  assert(r.real.inicio<=85 && r.real.inicio>83,'inicio alineado a clave '+r.real.inicio);
  assert(r.real.fin>=114.9,'fin real '+r.real.fin);
  const pr=JSON.parse(execSync(`ffprobe -v error -show_entries format=duration:stream=codec_name,nb_frames,duration -of json ${o}`));
  const d=+pr.format.duration; assert(Math.abs(d-(r.real.fin-r.real.inicio))<0.2,'ffprobe duración '+d+' vs '+(r.real.fin-r.real.inicio));
  assert(pr.streams.length===2,'2 pistas '+pr.streams.map(s=>s.codec_name));
  const dec=execSync(`ffmpeg -v error -i ${o} -f null - 2>&1`).toString(); assert(dec.trim()==='','decodifica sin errores '+dec.slice(0,200));
  // el primer fotograma del clip = fotograma del original en real.inicio
  const h1=execSync(`ffmpeg -v error -i ${o} -frames:v 1 -f rawvideo -pix_fmt gray - | sha256sum`).toString().slice(0,16);
  const h2=execSync(`ffmpeg -v error -ss ${r.real.inicio} -i ${f} -frames:v 1 -f rawvideo -pix_fmt gray - | sha256sum`).toString().slice(0,16);
  assert(h1===h2,'primer fotograma idéntico al original ('+h1+')');
  console.log('   hash clip', crypto.createHash('sha256').update(out).digest('hex').slice(0,16), r.comandoEquivalente);
 }
})();
