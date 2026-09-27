import importlib
import uuid

from fastapi import HTTPException
from fastapi.testclient import TestClient


def test_supabase_registration_master_and_isolation(monkeypatch,tmp_path):
    monkeypatch.setenv('VIGIA_DATA',str(tmp_path))
    monkeypatch.setenv('VIGIA_SUPABASE_URL','https://example.supabase.co')
    monkeypatch.setenv('VIGIA_SUPABASE_PUBLISHABLE_KEY','test-publishable-key')
    import app
    importlib.reload(app)
    users={};orgs={};members={}

    def fake(method,path,token=None,payload=None):
        if path=='/auth/v1/signup':
            email=payload['email'];users[email]={'id':str(uuid.uuid4()),'email':email,'user_metadata':payload['data'],'password':payload['password']}
            return {'user':users[email]}
        if path.startswith('/auth/v1/token'):
            user=users.get(payload['email'])
            if not user or user['password']!=payload['password']:raise HTTPException(401)
            return {'access_token':'token-'+user['id'],'user':user}
        if path=='/auth/v1/logout':return None
        user=next((u for u in users.values() if token=='token-'+u['id']),None)
        if user is None:raise HTTPException(401)
        if path=='/auth/v1/user':return user
        if path.startswith('/rest/v1/vigia_miembros?'):return [members[user['id']]] if user['id'] in members else []
        if path.startswith('/rest/v1/vigia_organizaciones?') and method=='GET':
            return [{'id':oid,'nombre':o['nombre']} for oid,o in orgs.items() if o['creado_por']==user['id']]
        if path=='/rest/v1/vigia_organizaciones' and method=='POST':
            assert payload['creado_por']==user['id']
            orgs[payload['id']]=payload;return None
        if path=='/rest/v1/vigia_miembros' and method=='POST':
            assert payload['usuario_id']==user['id'] and payload['rol']=='maestro'
            members[user['id']]=payload;return None
        if path.startswith('/rest/v1/vigia_organizaciones?id=eq.') and method=='PATCH':
            assert path.endswith(members[user['id']]['organizacion_id'])
            orgs[members[user['id']]['organizacion_id']]['nombre']=payload['nombre'];return None
        raise AssertionError((method,path))

    monkeypatch.setattr(app,'supabase_request',fake)
    c=TestClient(app.app)
    for email,org in [('a@example.com','Empresa A'),('b@example.com','Empresa B')]:
        assert c.post('/api/v1/register',json={'email':email,'password':'twelve-character-secret','organizacion':org}).status_code==200
    a=c.post('/api/v1/login',json={'username':'a@example.com','password':'twelve-character-secret'}).json()
    b=c.post('/api/v1/login',json={'username':'b@example.com','password':'twelve-character-secret'}).json()
    assert a['role']==b['role']=='maestro' and a['org']!=b['org']
    headers_a={'Authorization':'Bearer '+a['token']};headers_b={'Authorization':'Bearer '+b['token']}
    camera=c.post('/api/v1/cameras',headers=headers_a,json={'name':'Entrada A'}).json()['id']
    assert len(c.get('/api/v1/cameras',headers=headers_a).json())==1
    assert c.get('/api/v1/cameras',headers=headers_b).json()==[]
    assert c.get('/api/v1/master',headers=headers_a).json()['organizacion']=='Empresa A'
    assert c.patch('/api/v1/master/organization',headers=headers_a,json={'nombre':'Nueva Empresa A'}).status_code==200
    assert c.get('/api/v1/master',headers=headers_a).json()['organizacion']=='Nueva Empresa A'
    assert c.get('/api/v1/master',headers=headers_b).json()['organizacion']=='Empresa B'
    assert c.post('/api/v1/recordings',headers=headers_b,data={'camera_id':camera},files={'file':('test.mp4',b'fake','video/mp4')}).status_code==404
    assert c.post('/api/v1/logout',headers=headers_a).status_code==200
    assert c.get('/api/v1/cameras',headers=headers_a).status_code==401
