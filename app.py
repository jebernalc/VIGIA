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
import urllib.request
import urllib.error
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, HTMLResponse
from cloud import Cloud

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv('VIGIA_DATA', str(ROOT / 'data'))).resolve()
DATA.mkdir(parents=True, exist_ok=True)
POOL = ThreadPoolExecutor(max_workers=2)
app = FastAPI(title='VIGÍA', version='0.1.0')
TOKENS = {}
REVOKED = set()
BOOTSTRAP_LOCK = threading.Lock()
SUPABASE_URL = os.getenv('VIGIA_SUPABASE_URL','').rstrip('/')
SUPABASE_KEY = os.getenv('VIGIA_SUPABASE_PUBLISHABLE_KEY','')
if bool(SUPABASE_URL) != bool(SUPABASE_KEY):
    raise RuntimeError('Configura juntas VIGIA_SUPABASE_URL y VIGIA_SUPABASE_PUBLISHABLE_KEY')
SUPABASE_MODE = bool(SUPABASE_URL and SUPABASE_KEY)

def supabase_request(method,path,token=None,payload=None):
    headers={'apikey':SUPABASE_KEY,'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    if method in ('POST','PATCH'): headers['Prefer']='return=minimal'
    req=urllib.request.Request(SUPABASE_URL+path,method=method,headers=headers,
        data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urllib.request.urlopen(req,timeout=12) as response:
            raw=response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        if e.code in (401,403): raise HTTPException(401,'Sesión inválida o sin autorización')
        if e.code==409: raise HTTPException(409,'El registro ya existe')
        raise HTTPException(502,'Supabase no pudo completar la solicitud')
    except (urllib.error.URLError,TimeoutError):
        raise HTTPException(503,'No se pudo conectar con el servicio de usuarios')

def membership(token,user_id):
    from urllib.parse import quote
    rows=supabase_request('GET','/rest/v1/vigia_miembros?select=organizacion_id,rol&usuario_id=eq.'+quote(user_id,safe='')+'&limit=1',token)
    return rows[0] if rows else None

def bootstrap(token,user):
    uid=user['id']; existing=membership(token,uid)
    if existing:return existing
    with BOOTSTRAP_LOCK:
        existing=membership(token,uid)
        if existing:return existing
        from urllib.parse import quote
        previous=supabase_request('GET','/rest/v1/vigia_organizaciones?select=id&creado_por=eq.'+quote(uid,safe='')+'&order=creado_en.asc&limit=1',token)
        oid=previous[0]['id'] if previous else str(uuid.uuid4())
        if not previous:
            name=str(user.get('user_metadata',{}).get('organizacion') or 'Mi organización VIGÍA').strip()[:120]
            supabase_request('POST','/rest/v1/vigia_organizaciones',token,{'id':oid,'nombre':name,'creado_por':uid})
        try:
            supabase_request('POST','/rest/v1/vigia_miembros',token,{'organizacion_id':oid,'usuario_id':uid,'rol':'maestro'})
        except HTTPException as e:
            if e.status_code!=409:raise
        result=membership(token,uid)
        if not result:raise HTTPException(503,'No se pudo establecer la organización')
        return result

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
        for oid,username,key in ([] if SUPABASE_MODE else [('demo-a','operador-a','VIGIA_PASSWORD_A'),('demo-b','operador-b','VIGIA_PASSWORD_B')]):
            if not c.execute('SELECT 1 FROM users WHERE username=?',(username,)).fetchone():
                password=os.getenv(key) or secrets.token_urlsafe(15)
                salt=secrets.token_hex(16)
                digest=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),240000).hex()
                c.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',(str(uuid.uuid4()),oid,username,salt,digest,'administrator'))
                print(f'DEMO LOGIN {username}: {password}',flush=True)

init()

def auth(req):
    token=req.headers.get('Authorization','').removeprefix('Bearer ').strip()
    if token in REVOKED:raise HTTPException(401,'Sesión cerrada')
    if SUPABASE_MODE:
        if not token:raise HTTPException(401,'Inicia sesión para continuar')
        user=supabase_request('GET','/auth/v1/user',token)
        member=membership(token,user['id'])
        if not member:raise HTTPException(403,'No tienes una organización VIGÍA')
        return {'org':member['organizacion_id'],'username':user.get('email','Usuario'),'user_id':user['id'],
                'role':member['rol'],'expires':time.time()+120}
    info=TOKENS.get(token)
    if not info or info['expires'] < time.time():
        raise HTTPException(401,'Inicia sesión para continuar')
    return info

def require_role(user,*roles):
    if user['role'] not in roles:raise HTTPException(403,'Tu perfil no permite realizar esta acción')

def cloud(req):
    return Cloud(SUPABASE_URL,SUPABASE_KEY,req.headers.get('Authorization','').removeprefix('Bearer ').strip())

def cloud_audit(client,user,action,oid):
    client.insert('audit',{'id':str(uuid.uuid4()),'organizacion_id':user['org'],
        'actor':user['user_id'],'accion':action,'objeto_id':oid})

def cloud_recording(r):
    return {'id':r['id'],'camera':r['camara_id'],'name':r['nombre'],'sha256':r['sha256'],
        'size':r['tamano'],'duration':r['duracion'],'status':r['estado'],
        'uploaded':r['cargado_en'],'error':r['error'],'path':None}

def cloud_frame(f):
    return {'id':f['id'],'second':f['segundo'],'sha256':f['sha256'],
        'url':'/api/v1/media/frame/'+f['id']}

def cached_media(client,key,sha,org,oid,extension):
    dest=DATA/org/'cache'/f'{oid}.{extension}'
    if not dest.exists() or digest(dest)!=sha:
        client.download(key,dest,sha)
    return dest

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
    if SUPABASE_MODE:
        email=str(v.get('username','')).strip().lower()
        password=str(v.get('password',''))
        if not email or not password:raise HTTPException(422,'Escribe tu correo y contraseña')
        from urllib.parse import quote
        try:
            session=supabase_request('POST','/auth/v1/token?grant_type=password',payload={'email':email,'password':password})
        except HTTPException as e:
            if e.status_code==502:raise HTTPException(401,'Revisa tus credenciales o confirma tu correo electrónico')
            raise
        token=session['access_token']
        member=bootstrap(token,session['user'])
        return {'token':token,'org':member['organizacion_id'],'role':member['rol']}
    with db() as c:
        user=c.execute('SELECT * FROM users WHERE username=?',(v.get('username'),)).fetchone()
    if not user: raise HTTPException(401,'Credenciales incorrectas')
    candidate=hashlib.pbkdf2_hmac('sha256',str(v.get('password','')).encode(),bytes.fromhex(user['salt']),240000).hex()
    if not hmac.compare_digest(candidate,user['passhash']): raise HTTPException(401,'Credenciales incorrectas')
    token=secrets.token_urlsafe(32)
    TOKENS[token]={'org':user['org'],'username':user['username'],'role':user['role'],'expires':time.time()+8*3600}
    return {'token':token,'org':user['org'],'role':user['role']}

@app.get('/api/v1/config')
def config():
    return {'registro_disponible':SUPABASE_MODE,'modo':'supabase' if SUPABASE_MODE else 'local'}

@app.post('/api/v1/register')
async def register(req:Request):
    if not SUPABASE_MODE:raise HTTPException(404,'El registro requiere configurar Supabase')
    v=await req.json()
    email=str(v.get('email','')).strip().lower()
    password=str(v.get('password',''))
    org_name=str(v.get('organizacion','')).strip()
    if '@' not in email or len(email)>254 or len(password)<12 or len(org_name)<3 or len(org_name)>120:
        raise HTTPException(422,'Indica correo válido, organización y contraseña de 12 caracteres o más')
    try:
        supabase_request('POST','/auth/v1/signup',payload={'email':email,'password':password,'data':{'organizacion':org_name}})
    except HTTPException as e:
        if e.status_code==502:raise HTTPException(422,'No se pudo crear la cuenta. Revisa el correo y la contraseña')
        raise
    return {'message':'Cuenta solicitada. Revisa tu correo para confirmar el registro y después inicia sesión.'}

@app.post('/api/v1/logout')
def logout(req:Request):
    token=req.headers.get('Authorization','').removeprefix('Bearer ').strip()
    if SUPABASE_MODE and token:
        try:supabase_request('POST','/auth/v1/logout',token)
        except HTTPException:pass
        REVOKED.add(token)
    TOKENS.pop(token,None)
    return {'message':'Sesión cerrada'}

@app.get('/api/v1/cameras')
def cameras(req:Request):
    u=auth(req)
    if SUPABASE_MODE:
        return [{'id':r['id'],'name':r['nombre'],'timezone':r['zona_horaria'],
                 'location':r['ubicacion'],'source':r['fuente']} for r in cloud(req).list('camera',u['org'],order='creado_en.desc')]
    with db() as c: return [dict(r) for r in c.execute('SELECT * FROM camera WHERE org=?',(u['org'],))]

@app.post('/api/v1/cameras')
async def camera(req:Request):
    u=auth(req); v=await req.json()
    require_role(u,'maestro','administrator')
    name=str(v.get('name','')).strip()[:100]
    if not name: raise HTTPException(422,'Indica el nombre')
    oid=str(uuid.uuid4())
    if SUPABASE_MODE:
        client=cloud(req)
        client.insert('camera',{'id':oid,'organizacion_id':u['org'],'nombre':name,
            'zona_horaria':str(v.get('timezone','America/Bogota'))[:60],
            'ubicacion':str(v.get('location',''))[:150],'fuente':'archivo'})
        cloud_audit(client,u,'camera.create',oid)
        return {'id':oid,'name':name}
    with db() as c:
        c.execute('INSERT INTO camera VALUES (?,?,?,?,?,?)',(oid,u['org'],name,str(v.get('timezone','America/Bogota'))[:60],str(v.get('location',''))[:150],'archivo'))
        audit(c,u,'camera.create',oid)
    return {'id':oid,'name':name}

def process(rec_id,path,org,token=None):
    try:
        meta=json.loads(run('ffprobe','-v','error','-show_format','-of','json',str(path)))
        duration=float(meta['format']['duration'])
        if duration <= 0 or duration > (300 if token else 7200):
            raise ValueError('Duración fuera del límite: cinco minutos en modo nube')
        times=sorted(set(round(i*min(5,duration)/5,2) for i in range(6)) | set(range(0,int(duration)+1,5)))[:1500]
        client=Cloud(SUPABASE_URL,SUPABASE_KEY,token) if token else None
        for sec in times:
            fid=str(uuid.uuid4()); dest=DATA / org / 'frames' / f'{fid}.jpg'
            dest.parent.mkdir(parents=True,exist_ok=True)
            run('ffmpeg','-nostdin','-v','error','-ss',str(sec),'-i',str(path),'-frames:v','1','-q:v','4','-y',str(dest))
            if dest.exists() and dest.stat().st_size:
                if client:
                    key=f'{org}/{rec_id}/fotogramas/{fid}.jpg'
                    client.upload(key,dest,'image/jpeg')
                    client.insert('frame',{'id':fid,'organizacion_id':org,'grabacion_id':rec_id,
                        'segundo':sec,'objeto':key,'sha256':digest(dest)})
                else:
                    with db() as c: c.execute('INSERT INTO frame VALUES (?,?,?,?,?,?)',(fid,org,rec_id,sec,str(dest),digest(dest)))
        if client:client.update('recording',rec_id,org,{'duracion':duration,'estado':'ready'})
        else:
            with db() as c:c.execute('UPDATE recording SET duration=?,status=? WHERE id=? AND org=?',(duration,'ready',rec_id,org))
    except Exception as e:
        if token:
            try:Cloud(SUPABASE_URL,SUPABASE_KEY,token).update('recording',rec_id,org,{'estado':'failed','error':str(e)[:300]})
            except Exception:pass
        else:
            with db() as c:c.execute('UPDATE recording SET status=?,error=? WHERE id=? AND org=?',('failed',str(e)[:400],rec_id,org))

@app.post('/api/v1/recordings')
async def upload(req:Request,camera_id:str=Form(...),file:UploadFile=File(...)):
    u=auth(req)
    require_role(u,*(['maestro'] if SUPABASE_MODE else ['maestro','administrator','supervisor','operador']))
    if not file.filename.lower().endswith('.mp4'): raise HTTPException(415,'Solo MP4')
    client=cloud(req) if SUPABASE_MODE else None
    if client:client.get('camera',camera_id,u['org'])
    else:
        with db() as c: row(c,'camera',camera_id,u['org'])
    rid=str(uuid.uuid4()); dest=DATA / u['org'] / 'originals' / f'{rid}.mp4';dest.parent.mkdir(parents=True,exist_ok=True)
    size=0
    try:
        with dest.open('xb') as f:
            while part:=await file.read(1024*1024):
                size+=len(part)
                if size>(50 if client else 250)*1024*1024: raise HTTPException(413,'Máximo 50 MB en modo nube')
                f.write(part)
        if not size:raise HTTPException(422,'El archivo está vacío')
        run('ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','default=noprint_wrappers=1',str(dest))
        if client:
            duration=float(json.loads(run('ffprobe','-v','error','-show_format','-of','json',str(dest)))['format']['duration'])
            if duration<=0 or duration>300:raise HTTPException(422,'Máximo cinco minutos por grabación en modo nube')
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    checksum=digest(dest)
    if client:
        key=f'{u["org"]}/{rid}/original.mp4'
        client.upload(key,dest,'video/mp4')
        client.insert('recording',{'id':rid,'organizacion_id':u['org'],'camara_id':camera_id,
            'nombre':Path(file.filename).name[:150],'objeto_original':key,'sha256':checksum,
            'tamano':size,'duracion':duration,'estado':'processing'})
        cloud_audit(client,u,'recording.upload',rid)
        POOL.submit(process,rid,dest,u['org'],client.token)
    else:
        with db() as c:
            c.execute('INSERT INTO recording VALUES (?,?,?,?,?,?,?,?,?,?,?)',(rid,u['org'],camera_id,Path(file.filename).name[:150],str(dest),checksum,size,0,'processing',time.time(),None))
            audit(c,u,'recording.upload',rid)
        POOL.submit(process,rid,dest,u['org'])
    return {'id':rid,'status':'processing','sha256':digest(dest)}

@app.get('/api/v1/recordings')
def recordings(req:Request):
    u=auth(req)
    if SUPABASE_MODE:return [cloud_recording(r) for r in cloud(req).list('recording',u['org'],order='cargado_en.desc')]
    with db() as c: return [dict(r) | {'path':None} for r in c.execute('SELECT * FROM recording WHERE org=? ORDER BY uploaded DESC LIMIT 100',(u['org'],))]

@app.get('/api/v1/recordings/{rid}')
def recording(req:Request,rid:str):
    u=auth(req)
    if SUPABASE_MODE:return cloud_recording(cloud(req).get('recording',rid,u['org']))
    with db() as c: return dict(row(c,'recording',rid,u['org'])) | {'path':None}

@app.get('/api/v1/recordings/{rid}/frames')
def frames(req:Request,rid:str,start:float=0,end:float=7200):
    u=auth(req)
    if start<0 or end<start or end-start>7200: raise HTTPException(422,'Ventana inválida')
    if SUPABASE_MODE:
        client=cloud(req);client.get('recording',rid,u['org'])
        from urllib.parse import quote
        fs=client.list('frame',u['org'],filters=f'grabacion_id=eq.{quote(rid)}&segundo=gte.{start}&segundo=lte.{end}',limit=60,order='segundo.desc')
        return [cloud_frame(f) for f in fs]
    with db() as c:
        row(c,'recording',rid,u['org'])
        return [{'id':r['id'],'second':r['second'],'sha256':r['sha256'],'url':f'/api/v1/media/frame/{r["id"]}'} for r in c.execute('SELECT * FROM frame WHERE org=? AND recording=? AND second BETWEEN ? AND ? ORDER BY second DESC LIMIT 60',(u['org'],rid,start,end))]

@app.get('/api/v1/media/{kind}/{oid}')
def media(req:Request,kind:str,oid:str):
    u=auth(req)
    if kind not in ('frame','clip','recording'): raise HTTPException(404)
    table={'frame':'frame','clip':'clip','recording':'recording'}[kind]
    if SUPABASE_MODE:
        client=cloud(req);r=client.get(table,oid,u['org'])
        key=r['objeto_original'] if kind=='recording' else r['objeto']
        expected=f'{u["org"]}/'
        if not key.startswith(expected):raise HTTPException(403,'Ruta de evidencia inválida')
        path=cached_media(client,key,r['sha256'],u['org'],oid,'jpg' if kind=='frame' else 'mp4')
        cloud_audit(client,u,kind+'.read',oid)
        return FileResponse(path,media_type='image/jpeg' if kind=='frame' else 'video/mp4',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
    with db() as c:
        r=row(c,table,oid,u['org']); audit(c,u,kind+'.read',oid)
    return FileResponse(r['path'],media_type='image/jpeg' if kind=='frame' else 'video/mp4',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@app.post('/api/v1/clips')
async def clip(req:Request):
    u=auth(req);v=await req.json();rid=str(v.get('recording_id',''))
    require_role(u,*(['maestro'] if SUPABASE_MODE else ['maestro','administrator','supervisor','investigador']))
    client=cloud(req) if SUPABASE_MODE else None
    if client:rec=cloud_recording(client.get('recording',rid,u['org']))
    else:
        with db() as c: rec=row(c,'recording',rid,u['org'])
    start=float(v.get('start',0));end=float(v.get('end',0))
    if rec['status']!='ready' or not (0<=start<end<=rec['duration'] and end-start<=300): raise HTTPException(422,'Intervalo fuera de la grabación o superior a 5 minutos')
    oid=str(uuid.uuid4());dest=DATA/u['org']/'clips'/f'{oid}.mp4';dest.parent.mkdir(parents=True,exist_ok=True)
    original=rec['path']
    if client:
        remote=client.get('recording',rid,u['org'])
        original=cached_media(client,remote['objeto_original'],remote['sha256'],u['org'],rid,'mp4')
    run('ffmpeg','-nostdin','-v','error','-ss',str(start),'-i',str(original),'-t',str(end-start),'-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',str(dest))
    if client:
        key=f'{u["org"]}/{rid}/clips/{oid}.mp4'
        client.upload(key,dest,'video/mp4')
        client.insert('clip',{'id':oid,'organizacion_id':u['org'],'grabacion_id':rid,'inicio':start,
            'fin':end,'objeto':key,'sha256':digest(dest)})
        cloud_audit(client,u,'clip.create',oid)
    else:
        with db() as c:
            c.execute('INSERT INTO clip VALUES (?,?,?,?,?,?,?,?)',(oid,u['org'],rid,start,end,str(dest),digest(dest),time.time()))
            audit(c,u,'clip.create',oid)
    return {'id':oid,'recording_id':rid,'start':start,'end':end,'sha256':digest(dest),'url':f'/api/v1/media/clip/{oid}'}

@app.post('/api/v1/chat')
async def chat(req:Request):
    u=auth(req);v=await req.json();message=str(v.get('message',''))[:1000].lower();rid=str(v.get('recording_id',''))
    if SUPABASE_MODE:rec=cloud_recording(cloud(req).get('recording',rid,u['org']))
    else:
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
    if SUPABASE_MODE:
        from urllib.parse import quote
        fs=[cloud_frame(f) for f in cloud(req).list('frame',u['org'],filters=f'grabacion_id=eq.{quote(rid)}&segundo=gte.{start}&segundo=lte.{end}',limit=30,order='segundo.desc')]
    else:
        with db() as c:
            fs=[{'id':r['id'],'second':r['second'],'sha256':r['sha256'],'url':f'/api/v1/media/frame/{r["id"]}'} for r in c.execute('SELECT * FROM frame WHERE org=? AND recording=? AND second BETWEEN ? AND ? ORDER BY second DESC LIMIT 30',(u['org'],rid,start,end))]
    return {'intent':'frames','window':[start,end],'answer':f'{len(fs)} fotogramas auténticos del archivo histórico, entre {start:.1f} y {end:.1f} s. No hay hora de captura conocida ni transmisión en vivo.','items':fs,'coverage':'Muestreo aproximado cada 5 segundos.'}

@app.post('/api/v1/cases')
async def create_case(req:Request):
    u=auth(req);v=await req.json();rid=str(v.get('recording_id',''))
    require_role(u,*(['maestro'] if SUPABASE_MODE else ['maestro','administrator','supervisor','investigador']))
    if SUPABASE_MODE:
        client=cloud(req);client.get('recording',rid,u['org']);oid=str(uuid.uuid4());eid=str(uuid.uuid4())
        client.insert('cases',{'id':oid,'organizacion_id':u['org'],'titulo':str(v.get('title','Investigación'))[:120],
            'nota':str(v.get('note',''))[:3000],'estado':'hipótesis'})
        client.insert('evidence',{'id':eid,'organizacion_id':u['org'],'expediente_id':oid,'grabacion_id':rid})
        cloud_audit(client,u,'case.create',oid)
        return {'id':oid,'status':'hipótesis'}
    with db() as c:
        row(c,'recording',rid,u['org']);oid=str(uuid.uuid4());eid=str(uuid.uuid4())
        c.execute('INSERT INTO cases VALUES (?,?,?,?,?,?)',(oid,u['org'],str(v.get('title','Investigación'))[:120],str(v.get('note',''))[:3000],'hipótesis',time.time()))
        c.execute('INSERT INTO evidence VALUES (?,?,?,?,?,?)',(eid,u['org'],oid,rid,None,None));audit(c,u,'case.create',oid)
    return {'id':oid,'status':'hipótesis'}

@app.get('/api/v1/cases')
def cases(req:Request):
    u=auth(req)
    if SUPABASE_MODE:
        return [{'id':r['id'],'title':r['titulo'],'note':r['nota'],'status':r['estado'],'created':r['creado_en']}
                for r in cloud(req).list('cases',u['org'],order='creado_en.desc')]
    with db() as c: return [dict(r) for r in c.execute('SELECT * FROM cases WHERE org=? ORDER BY created DESC',(u['org'],))]

@app.get('/api/v1/cases/{oid}/report')
def report(req:Request,oid:str):
    u=auth(req)
    from html import escape
    if SUPABASE_MODE:
        client=cloud(req);item=client.get('cases',oid,u['org'])
        case={'title':item['titulo'],'note':item['nota'],'status':item['estado']}
        from urllib.parse import quote
        evidence=client.list('evidence',u['org'],filters='expediente_id=eq.'+quote(oid))
        sources=[cloud_recording(client.get('recording',e['grabacion_id'],u['org'])) for e in evidence]
        cloud_audit(client,u,'report.read',oid)
    else:
        with db() as c:
            case=row(c,'cases',oid,u['org'])
            sources=[dict(r) for r in c.execute('SELECT recording.id,recording.name,recording.sha256,recording.duration FROM evidence JOIN recording ON evidence.recording=recording.id AND evidence.org=recording.org WHERE evidence.case_id=? AND evidence.org=?',(oid,u['org']))]
            audit(c,u,'report.read',oid)
    lines=''.join(f'<li>{escape(s["name"])} — SHA-256: {escape(s["sha256"])}; duración {s["duration"]} s</li>' for s in sources)
    return HTMLResponse(f'<html lang="es"><meta charset="utf-8"><title>Informe VIGÍA</title><style>body{{font:17px system-ui;max-width:760px;margin:50px auto;line-height:1.6}}@media print{{body{{margin:15mm}}}}</style><h1>Informe preliminar</h1><p>Expediente: {escape(case["title"])} · Estado: {escape(case["status"])}</p><h2>Notas</h2><p>{escape(case["note"])}</p><h2>Fuentes</h2><ul>{lines}</ul><h2>Método y límites</h2><p>Fotogramas extraídos con FFmpeg cada ~5 segundos. Sin detector de objetos; sin verificación humana de incidentes. Se desconoce la hora de captura original. Este informe no acredita admisibilidad legal.</p><p>Autor de consulta: {escape(u["username"])}</p><button onclick="window.print()">Imprimir o guardar PDF</button></html>')

@app.get('/api/v1/metrics')
def metrics(req:Request):
    u=auth(req)
    if SUPABASE_MODE:
        client=cloud(req)
        return {'cameras':client.count('camera',u['org']),'recordings':client.count('recording',u['org'],'estado=eq.ready'),
            'pending':client.count('recording',u['org'],'estado=eq.processing'),'frames':client.count('frame',u['org']),
            'clips':client.count('clip',u['org']),'cases':client.count('cases',u['org'])}
    with db() as c:
        return {name:c.execute(f'SELECT COUNT(*) FROM {table} WHERE org=?'+condition,(u['org'],)).fetchone()[0] for name,table,condition in [('cameras','camera',''),('recordings','recording'," AND status='ready'"),('pending','recording'," AND status='processing'"),('frames','frame',''),('clips','clip',''),('cases','cases','')]}

@app.get('/api/v1/master')
def master(req:Request):
    u=auth(req);require_role(u,'maestro','administrator')
    if SUPABASE_MODE:
        token=req.headers.get('Authorization','').removeprefix('Bearer ').strip()
        rows=supabase_request('GET','/rest/v1/vigia_organizaciones?select=id,nombre&id=eq.'+u['org']+'&limit=1',token)
        if not rows:raise HTTPException(404,'Organización no disponible')
        name=rows[0]['nombre']
    else:
        with db() as c:name=c.execute('SELECT name FROM org WHERE id=?',(u['org'],)).fetchone()['name']
    return {'organizacion_id':u['org'],'organizacion':name,'usuario':u['username'],'rol':u['role']}

@app.patch('/api/v1/master/organization')
async def rename_organization(req:Request):
    u=auth(req);require_role(u,'maestro','administrator');v=await req.json()
    name=str(v.get('nombre','')).strip()
    if len(name)<3 or len(name)>120:raise HTTPException(422,'El nombre debe tener entre 3 y 120 caracteres')
    if SUPABASE_MODE:
        token=req.headers.get('Authorization','').removeprefix('Bearer ').strip()
        supabase_request('PATCH','/rest/v1/vigia_organizaciones?id=eq.'+u['org'],token,{'nombre':name})
    else:
        with db() as c:c.execute('UPDATE org SET name=? WHERE id=?',(name,u['org']))
    if SUPABASE_MODE:cloud_audit(cloud(req),u,'org.rename',u['org'])
    else:
        with db() as c:audit(c,u,'org.rename',u['org'])
    return {'organizacion':name}

@app.get('/')
def home(): return FileResponse(ROOT/'static'/'index.html')
