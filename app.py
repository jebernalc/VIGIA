import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import subprocess
import time
import uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, HTMLResponse

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv('VIGIA_DATA', str(ROOT / 'data'))).resolve()
DATA.mkdir(parents=True, exist_ok=True)
POOL = ThreadPoolExecutor(max_workers=2)
app = FastAPI(title='VIGÍA', version='0.1.0')
TOKENS = {}

def db():
    c = sqlite3.connect(DATA / 'vigia.db', timeout=30)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c

def init():
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS org(id TEXT PRIMARY KEY,name TEXT);
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,org TEXT,username TEXT UNIQUE,salt TEXT,passhash TEXT,role TEXT);
        CREATE TABLE IF NOT EXISTS camera(id TEXT PRIMARY KEY,org TEXT,name TEXT,timezone TEXT,location TEXT,source TEXT);
        CREATE TABLE IF NOT EXISTS recording(id TEXT PRIMARY KEY,org TEXT,camera TEXT,name TEXT,path TEXT,sha256 TEXT,size INTEGER,duration REAL,status TEXT,uploaded REAL,error TEXT);
        CREATE TABLE IF NOT EXISTS frame(id TEXT PRIMARY KEY,org TEXT,recording TEXT,second REAL,path TEXT,sha256 TEXT);
        CREATE TABLE IF NOT EXISTS clip(id TEXT PRIMARY KEY,org TEXT,recording TEXT,start REAL,end REAL,path TEXT,sha256 TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,org TEXT,title TEXT,note TEXT,status TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,org TEXT,case_id TEXT,recording TEXT,frame TEXT,clip TEXT);
        CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,org TEXT,actor TEXT,action TEXT,object TEXT,created REAL);
        CREATE INDEX IF NOT EXISTS ix_frame_window ON frame(org,recording,second);
        ''')
        for oid,name in [('demo-a','Institución Andina'),('demo-b','Institución Norte')]:
            c.execute('INSERT OR IGNORE INTO org VALUES (?,?)',(oid,name))
        for oid,username,key in [('demo-a','operador-a','VIGIA_PASSWORD_A'),('demo-b','operador-b','VIGIA_PASSWORD_B')]:
            if not c.execute('SELECT 1 FROM users WHERE username=?',(username,)).fetchone():
                password=os.getenv(key) or secrets.token_urlsafe(15)
                salt=secrets.token_hex(16)
                digest=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),240000).hex()
                c.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',(str(uuid.uuid4()),oid,username,salt,digest,'administrator'))
                print(f'DEMO LOGIN {username}: {password}',flush=True)

init()

def auth(req):
    token=req.headers.get('Authorization','').removeprefix('Bearer ').strip()
    info=TOKENS.get(token)
    if not info or info['expires'] < time.time():
        raise HTTPException(401,'Inicia sesión para continuar')
    return info

def row(c,table,oid,org):
    # All object lookup paths are tenant scoped.
    r=c.execute(f'SELECT * FROM {table} WHERE id=? AND org=?',(oid,org)).fetchone()
    if not r: raise HTTPException(404,'Elemento no disponible')
    return r

def audit(c,u,action,oid):
    c.execute('INSERT INTO audit VALUES (?,?,?,?,?,?)',(str(uuid.uuid4()),u['org'],u['username'],action,oid,time.time()))

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def run(*args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=120)
    if p.returncode: raise RuntimeError(p.stderr[-1200:])
    return p.stdout

@app.post('/api/v1/login')
async def login(req:Request):
    v=await req.json()
    with db() as c:
        user=c.execute('SELECT * FROM users WHERE username=?',(v.get('username'),)).fetchone()
    if not user: raise HTTPException(401,'Credenciales incorrectas')
    candidate=hashlib.pbkdf2_hmac('sha256',str(v.get('password','')).encode(),bytes.fromhex(user['salt']),240000).hex()
    if not hmac.compare_digest(candidate,user['passhash']): raise HTTPException(401,'Credenciales incorrectas')
    token=secrets.token_urlsafe(32)
    TOKENS[token]={'org':user['org'],'username':user['username'],'role':user['role'],'expires':time.time()+8*3600}
    return {'token':token,'org':user['org'],'role':user['role']}

@app.post('/api/v1/logout')
def logout(req:Request):
    token=req.headers.get('Authorization','').removeprefix('Bearer ').strip()
    TOKENS.pop(token,None)
    return {'message':'Sesión cerrada'}

@app.get('/api/v1/cameras')
def cameras(req:Request):
    u=auth(req)
    with db() as c: return [dict(r) for r in c.execute('SELECT * FROM camera WHERE org=?',(u['org'],))]

@app.post('/api/v1/cameras')
async def camera(req:Request):
    u=auth(req); v=await req.json()
    name=str(v.get('name','')).strip()[:100]
    if not name: raise HTTPException(422,'Indica el nombre')
    oid=str(uuid.uuid4())
    with db() as c:
        c.execute('INSERT INTO camera VALUES (?,?,?,?,?,?)',(oid,u['org'],name,str(v.get('timezone','America/Bogota'))[:60],str(v.get('location',''))[:150],'archivo'))
        audit(c,u,'camera.create',oid)
    return {'id':oid,'name':name}

def process(rec_id,path,org):
    try:
        meta=json.loads(run('ffprobe','-v','error','-show_format','-of','json',str(path)))
        duration=float(meta['format']['duration'])
        if duration <= 0 or duration > 7200: raise ValueError('Duración fuera del límite de dos horas')
        times=sorted(set(round(i*min(5,duration)/5,2) for i in range(6)) | set(range(0,int(duration)+1,5)))[:1500]
        for sec in times:
            fid=str(uuid.uuid4()); dest=DATA / org / 'frames' / f'{fid}.jpg'
            dest.parent.mkdir(parents=True,exist_ok=True)
            run('ffmpeg','-nostdin','-v','error','-ss',str(sec),'-i',str(path),'-frames:v','1','-q:v','4','-y',str(dest))
            if dest.exists() and dest.stat().st_size:
                with db() as c: c.execute('INSERT INTO frame VALUES (?,?,?,?,?,?)',(fid,org,rec_id,sec,str(dest),digest(dest)))
        with db() as c: c.execute('UPDATE recording SET duration=?,status=? WHERE id=? AND org=?',(duration,'ready',rec_id,org))
    except Exception as e:
        with db() as c: c.execute('UPDATE recording SET status=?,error=? WHERE id=? AND org=?',('failed',str(e)[:400],rec_id,org))

@app.post('/api/v1/recordings')
async def upload(req:Request,camera_id:str=Form(...),file:UploadFile=File(...)):
    u=auth(req)
    if not file.filename.lower().endswith('.mp4'): raise HTTPException(415,'Solo MP4')
    with db() as c: row(c,'camera',camera_id,u['org'])
    rid=str(uuid.uuid4()); dest=DATA / u['org'] / 'originals' / f'{rid}.mp4';dest.parent.mkdir(parents=True,exist_ok=True)
    size=0
    try:
        with dest.open('xb') as f:
            while part:=await file.read(1024*1024):
                size+=len(part)
                if size>250*1024*1024: raise HTTPException(413,'Máximo 250 MB')
                f.write(part)
        run('ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','default=noprint_wrappers=1',str(dest))
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    with db() as c:
        c.execute('INSERT INTO recording VALUES (?,?,?,?,?,?,?,?,?,?,?)',(rid,u['org'],camera_id,Path(file.filename).name[:150],str(dest),digest(dest),size,0,'processing',time.time(),None))
        audit(c,u,'recording.upload',rid)
    POOL.submit(process,rid,dest,u['org'])
    return {'id':rid,'status':'processing','sha256':digest(dest)}

@app.get('/api/v1/recordings')
def recordings(req:Request):
    u=auth(req)
    with db() as c: return [dict(r) | {'path':None} for r in c.execute('SELECT * FROM recording WHERE org=? ORDER BY uploaded DESC LIMIT 100',(u['org'],))]

@app.get('/api/v1/recordings/{rid}')
def recording(req:Request,rid:str):
    u=auth(req)
    with db() as c: return dict(row(c,'recording',rid,u['org'])) | {'path':None}

@app.get('/api/v1/recordings/{rid}/frames')
def frames(req:Request,rid:str,start:float=0,end:float=7200):
    u=auth(req)
    if start<0 or end<start or end-start>7200: raise HTTPException(422,'Ventana inválida')
    with db() as c:
        row(c,'recording',rid,u['org'])
        return [{'id':r['id'],'second':r['second'],'sha256':r['sha256'],'url':f'/api/v1/media/frame/{r["id"]}'} for r in c.execute('SELECT * FROM frame WHERE org=? AND recording=? AND second BETWEEN ? AND ? ORDER BY second DESC LIMIT 60',(u['org'],rid,start,end))]

@app.get('/api/v1/media/{kind}/{oid}')
def media(req:Request,kind:str,oid:str):
    u=auth(req)
    if kind not in ('frame','clip','recording'): raise HTTPException(404)
    table={'frame':'frame','clip':'clip','recording':'recording'}[kind]
    with db() as c:
        r=row(c,table,oid,u['org']); audit(c,u,kind+'.read',oid)
    return FileResponse(r['path'],media_type='image/jpeg' if kind=='frame' else 'video/mp4',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@app.post('/api/v1/clips')
async def clip(req:Request):
    u=auth(req);v=await req.json();rid=str(v.get('recording_id',''))
    with db() as c: rec=row(c,'recording',rid,u['org'])
    start=float(v.get('start',0));end=float(v.get('end',0))
    if rec['status']!='ready' or not (0<=start<end<=rec['duration'] and end-start<=300): raise HTTPException(422,'Intervalo fuera de la grabación o superior a 5 minutos')
    oid=str(uuid.uuid4());dest=DATA/u['org']/'clips'/f'{oid}.mp4';dest.parent.mkdir(parents=True,exist_ok=True)
    run('ffmpeg','-nostdin','-v','error','-ss',str(start),'-i',rec['path'],'-t',str(end-start),'-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',str(dest))
    with db() as c:
        c.execute('INSERT INTO clip VALUES (?,?,?,?,?,?,?,?)',(oid,u['org'],rid,start,end,str(dest),digest(dest),time.time()))
        audit(c,u,'clip.create',oid)
    return {'id':oid,'recording_id':rid,'start':start,'end':end,'sha256':digest(dest),'url':f'/api/v1/media/clip/{oid}'}

@app.post('/api/v1/chat')
async def chat(req:Request):
    u=auth(req);v=await req.json();message=str(v.get('message',''))[:1000].lower();rid=str(v.get('recording_id',''))
    with db() as c: rec=row(c,'recording',rid,u['org'])
    if rec['status']!='ready': return {'intent':'status','answer':'La grabación todavía no está indexada. Estado: '+rec['status'],'items':[]}
    times=[float(x.replace(',','.')) for x in re.findall(r'\b\d+(?:[.,]\d+)?\b',message)]
    clock=re.findall(r'(\d{1,2}):(\d{2}):(\d{2})',message)
    if len(clock)>=2:
        start,end=[int(h)*3600+int(m)*60+int(s) for h,m,s in clock[:2]]
    elif 'últimos' in message or 'ultimos' in message:
        n=times[0] if times else 5; span=n*60 if 'minut' in message else n
        end=rec['duration'];start=max(0,end-span)
    else: start,end=0,rec['duration']
    start=max(0,start);end=min(rec['duration'],end)
    if end<start: raise HTTPException(422,'Ventana fuera de la grabación')
    if 'indicador' in message: return {'intent':'metrics','answer':'Consulta los indicadores del panel.','items':[]}
    wants_objects=bool(re.search(r'persona|vehículo|vehiculo|detect|encuentra',message))
    if wants_objects: return {'intent':'objects','window':[start,end],'answer':'No hay detector de personas o vehículos instalado. No se han generado hallazgos. Puedes inspeccionar fotogramas del intervalo.','items':[],'coverage':'Fotogramas muestreados cada 5 segundos; no hay análisis de objetos.'}
    with db() as c:
        fs=[{'id':r['id'],'second':r['second'],'sha256':r['sha256'],'url':f'/api/v1/media/frame/{r["id"]}'} for r in c.execute('SELECT * FROM frame WHERE org=? AND recording=? AND second BETWEEN ? AND ? ORDER BY second DESC LIMIT 30',(u['org'],rid,start,end))]
    return {'intent':'frames','window':[start,end],'answer':f'{len(fs)} fotogramas auténticos del archivo histórico, entre {start:.1f} y {end:.1f} s. No hay hora de captura conocida ni transmisión en vivo.','items':fs,'coverage':'Muestreo aproximado cada 5 segundos.'}

@app.post('/api/v1/cases')
async def create_case(req:Request):
    u=auth(req);v=await req.json();rid=str(v.get('recording_id',''))
    with db() as c:
        row(c,'recording',rid,u['org']);oid=str(uuid.uuid4());eid=str(uuid.uuid4())
        c.execute('INSERT INTO cases VALUES (?,?,?,?,?,?)',(oid,u['org'],str(v.get('title','Investigación'))[:120],str(v.get('note',''))[:3000],'hipótesis',time.time()))
        c.execute('INSERT INTO evidence VALUES (?,?,?,?,?,?)',(eid,u['org'],oid,rid,None,None));audit(c,u,'case.create',oid)
    return {'id':oid,'status':'hipótesis'}

@app.get('/api/v1/cases')
def cases(req:Request):
    u=auth(req)
    with db() as c: return [dict(r) for r in c.execute('SELECT * FROM cases WHERE org=? ORDER BY created DESC',(u['org'],))]

@app.get('/api/v1/cases/{oid}/report')
def report(req:Request,oid:str):
    u=auth(req)
    from html import escape
    with db() as c:
        case=row(c,'cases',oid,u['org'])
        sources=[dict(r) for r in c.execute('SELECT recording.id,recording.name,recording.sha256,recording.duration FROM evidence JOIN recording ON evidence.recording=recording.id AND evidence.org=recording.org WHERE evidence.case_id=? AND evidence.org=?',(oid,u['org']))]
        audit(c,u,'report.read',oid)
    lines=''.join(f'<li>{escape(s["name"])} — SHA-256: {escape(s["sha256"])}; duración {s["duration"]} s</li>' for s in sources)
    return HTMLResponse(f'<html lang="es"><meta charset="utf-8"><title>Informe VIGÍA</title><style>body{{font:17px system-ui;max-width:760px;margin:50px auto;line-height:1.6}}@media print{{body{{margin:15mm}}}}</style><h1>Informe preliminar</h1><p>Expediente: {escape(case["title"])} · Estado: {escape(case["status"])}</p><h2>Notas</h2><p>{escape(case["note"])}</p><h2>Fuentes</h2><ul>{lines}</ul><h2>Método y límites</h2><p>Fotogramas extraídos con FFmpeg cada ~5 segundos. Sin detector de objetos; sin verificación humana de incidentes. Se desconoce la hora de captura original. Este informe no acredita admisibilidad legal.</p><p>Autor de consulta: {escape(u["username"])}</p><button onclick="window.print()">Imprimir o guardar PDF</button></html>')

@app.get('/api/v1/metrics')
def metrics(req:Request):
    u=auth(req)
    with db() as c:
        return {name:c.execute(f'SELECT COUNT(*) FROM {table} WHERE org=?'+condition,(u['org'],)).fetchone()[0] for name,table,condition in [('cameras','camera',''),('recordings','recording'," AND status='ready'"),('pending','recording'," AND status='processing'"),('frames','frame',''),('clips','clip',''),('cases','cases','')]}

@app.get('/')
def home(): return FileResponse(ROOT/'static'/'index.html')
