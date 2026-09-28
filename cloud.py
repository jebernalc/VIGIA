"""Acceso a PostgREST y Storage con el JWT del usuario; RLS decide el alcance."""
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from fastapi import HTTPException

TABLES = {'camera':'vigia_camaras','recording':'vigia_grabaciones','frame':'vigia_fotogramas','round':'vigia_rondas',
          'clip':'vigia_clips','cases':'vigia_expedientes','evidence':'vigia_evidencias','audit':'vigia_auditoria'}
BUCKET='vigia-evidencias'

class Cloud:
    def __init__(self,url,key,token):
        self.url=url.rstrip('/')
        self.key=key
        self.token=token

    def request(self,method,path,payload=None,content_type='application/json',count=False):
        headers={'apikey':self.key,'Authorization':'Bearer '+self.token,'Content-Type':content_type}
        if method in ('POST','PATCH'):headers['Prefer']='return=minimal'
        if count:headers['Prefer']='count=exact'
        body=(json.dumps(payload).encode() if content_type=='application/json' else payload) if payload is not None else None
        request=urllib.request.Request(self.url+path,method=method,headers=headers,data=body)
        try:
            with urllib.request.urlopen(request,timeout=90) as response:
                raw=response.read()
                if count:
                    value=response.headers.get('Content-Range','0-0/0').split('/')[-1]
                    return int(value) if value.isdigit() else 0
                if content_type!='application/json' or path.startswith('/storage/v1/object/authenticated/'):
                    return raw
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            if error.code in (401,403):raise HTTPException(403,'Acceso denegado a la organización o al archivo')
            if error.code==404:raise HTTPException(404,'Evidencia no disponible')
            if error.code==413:raise HTTPException(413,'El archivo supera el límite de almacenamiento')
            raise HTTPException(502,'No se pudo completar la operación en Supabase')
        except (urllib.error.URLError,TimeoutError):
            raise HTTPException(503,'Supabase no responde en este momento')

    def list(self,kind,org,filters='',select='*',limit=100,order=None):
        params=f'select={select}&organizacion_id=eq.{urllib.parse.quote(org)}'
        if filters:params+='&'+filters
        if order:params+='&order='+order
        params+='&limit='+str(min(limit,1000))
        return self.request('GET','/rest/v1/'+TABLES[kind]+'?'+params)

    def get(self,kind,oid,org):
        rows=self.list(kind,org,'id=eq.'+urllib.parse.quote(oid),limit=1)
        if not rows:raise HTTPException(404,'Elemento no disponible')
        return rows[0]

    def insert(self,kind,data):
        self.request('POST','/rest/v1/'+TABLES[kind],data)

    def update(self,kind,oid,org,data):
        self.request('PATCH','/rest/v1/'+TABLES[kind]+'?id=eq.'+urllib.parse.quote(oid)+'&organizacion_id=eq.'+urllib.parse.quote(org),data)

    def delete(self,kind,oid,org):
        self.request('DELETE','/rest/v1/'+TABLES[kind]+'?id=eq.'+urllib.parse.quote(oid)+'&organizacion_id=eq.'+urllib.parse.quote(org))

    def count(self,kind,org,filters=''):
        params='select=id&organizacion_id=eq.'+urllib.parse.quote(org)+'&limit=1'
        if filters:params+='&'+filters
        return self.request('GET','/rest/v1/'+TABLES[kind]+'?'+params,count=True)

    def upload(self,key,path,mime):
        data=Path(path).read_bytes()
        endpoint='/storage/v1/object/'+BUCKET+'/'+urllib.parse.quote(key,safe='/')
        self.request('POST',endpoint,data,mime)

    def download(self,key,dest,sha):
        endpoint='/storage/v1/object/authenticated/'+BUCKET+'/'+urllib.parse.quote(key,safe='/')
        data=self.request('GET',endpoint,content_type='application/octet-stream')
        if hashlib.sha256(data).hexdigest()!=sha:
            raise HTTPException(502,'La evidencia no coincide con el hash registrado')
        path=Path(dest);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        return path
