"""Genera un video sintético de prueba (no sensible) para VIGÍA.
Escena estática tipo parqueadero + sello de tiempo + eventos:
  00:20-00:35 caja gris en movimiento (movimiento sin persona)
  01:20-01:50 persona (fotografía de dominio público NASA 'astronaut', skimage) cruzando
  02:30-02:45 gato (skimage 'chelsea') cruzando
Uso: python3 gen_muestra.py salida_raw.yuv  (luego ffmpeg codifica)"""
import sys, numpy as np, cv2, datetime as dt
from skimage import data
W,H,FPS,DUR=640,360,15,200
bg=np.full((H,W,3),(92,98,104),np.uint8)
# asfalto + lineas de estacionamiento + muro
cv2.rectangle(bg,(0,0),(W,110),(150,145,138),-1)
for x in range(40,W,110): cv2.line(bg,(x,150),(x+30,H),(220,220,220),3)
cv2.rectangle(bg,(470,40),(600,105),(60,70,90),-1)  # puerta
noise=np.random.default_rng(1).integers(-6,6,(H,W,3))
bg=cv2.GaussianBlur(np.clip(bg.astype(int)+noise,0,255).astype(np.uint8),(5,5),0)
astro=cv2.cvtColor(data.astronaut(),cv2.COLOR_RGB2BGR); astro=cv2.resize(astro,(200,200))
cat=cv2.cvtColor(data.chelsea(),cv2.COLOR_RGB2BGR); cat=cv2.resize(cat,(170,113))
t0=dt.datetime(2026,9,20,14,0,0)
out=open(sys.argv[1],'wb')
def paste(fr,img,x,y):
    h,w=img.shape[:2]; x0=max(0,x); x1=min(W,x+w)
    if x1<=x0: return
    fr[y:y+h,x0:x1]=img[:,x0-x:x1-x]
for i in range(DUR*FPS):
    t=i/FPS; fr=bg.copy()
    if 20<=t<35:
        x=int(-80+(t-20)/15*(W+80)); cv2.rectangle(fr,(x,230),(x+80,290),(70,70,70),-1)
    if 80<=t<110:
        x=int(-200+(t-80)/30*(W+200)); paste(fr,astro,x,140)
    if 150<=t<165:
        x=int(W-(t-150)/15*(W+170)); paste(fr,cat,x,230)
    ts=(t0+dt.timedelta(seconds=int(t))).strftime('CAM-01  %Y-%m-%d %H:%M:%S')
    cv2.rectangle(fr,(0,0),(330,26),(0,0,0),-1)
    cv2.putText(fr,ts,(6,18),cv2.FONT_HERSHEY_SIMPLEX,0.5,(255,255,255),1,cv2.LINE_AA)
    out.write(cv2.cvtColor(fr,cv2.COLOR_BGR2YUV_I420).tobytes())
out.close()
