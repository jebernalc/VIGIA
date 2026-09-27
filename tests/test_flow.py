import importlib
import os
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

def test_real_video_and_tenant_isolation():
    with tempfile.TemporaryDirectory() as tmp:
        os.environ.update(VIGIA_DATA=tmp,VIGIA_PASSWORD_A='test-only-secret-a',VIGIA_PASSWORD_B='test-only-secret-b')
        import app
        importlib.reload(app)
        client=TestClient(app.app)
        def login(user,password):
            r=client.post('/api/v1/login',json={'username':user,'password':password});assert r.status_code==200
            return {'Authorization':'Bearer '+r.json()['token']}
        a=login('operador-a','test-only-secret-a');b=login('operador-b','test-only-secret-b')
        cam=client.post('/api/v1/cameras',headers=a,json={'name':'Cámara 1','timezone':'America/Bogota'}).json()['id']
        video=Path(tmp)/'synthetic.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc=size=320x180:rate=10','-t','4','-pix_fmt','yuv420p','-y',str(video)],check=True)
        with video.open('rb') as f:
            result=client.post('/api/v1/recordings',headers=a,data={'camera_id':cam},files={'file':('synthetic.mp4',f,'video/mp4')})
        assert result.status_code==200,result.text
        rid=result.json()['id']
        for _ in range(80):
            rec=client.get(f'/api/v1/recordings/{rid}',headers=a).json()
            if rec['status']!='processing':break
            time.sleep(.1)
        assert rec['status']=='ready',rec
        assert rec['sha256']==app.digest(video)
        assert client.get(f'/api/v1/recordings/{rid}',headers=b).status_code==404
        assert client.get('/api/v1/cameras',headers=b).json()==[]
        found=client.post('/api/v1/chat',headers=a,json={'recording_id':rid,'message':'muéstrame fotogramas en los últimos 5 minutos'}).json()
        assert found['items']
        frame=found['items'][0]
        assert client.get(frame['url'],headers=a).content[:3]==b'\xff\xd8\xff'
        assert client.get(frame['url'],headers=b).status_code==404
        obj=client.post('/api/v1/chat',headers=a,json={'recording_id':rid,'message':'encuentra personas entre 00:00:01 y 00:00:03'}).json()
        assert obj['items']==[] and 'No hay detector' in obj['answer']
        clip=client.post('/api/v1/clips',headers=a,json={'recording_id':rid,'start':0,'end':2}).json()
        assert client.get(clip['url'],headers=b).status_code==404
        assert app.digest(Path(tmp)/'demo-a'/'clips'/f'{clip["id"]}.mp4')==clip['sha256']
        case=client.post('/api/v1/cases',headers=a,json={'recording_id':rid,'title':'Prueba'}).json()
        assert client.get(f'/api/v1/cases/{case["id"]}/report',headers=b).status_code==404
        assert rec['sha256'] in client.get(f'/api/v1/cases/{case["id"]}/report',headers=a).text
        assert client.get('/api/v1/cases',headers=b).json()==[]
        assert 'Acceso institucional' in client.get('/').text
        assert client.post('/api/v1/logout',headers=a).status_code==200
        assert client.get('/api/v1/cameras',headers=a).status_code==401
