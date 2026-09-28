"""Video sintético de CASOS DE USO para VIGÍA (sin personas reales salvo fotografías de dominio público).
Personas: astronauta (NASA, skimage) y Grace Hopper (dominio público, matplotlib). Vehículo: motocicleta (skimage).
Guion (segundos) — la configuración AN.configDemo() de analytics.js corresponde a esta escena:
  010-025  Persona A cruza la línea de acceso de izquierda a derecha           -> ENTRADA 1
  030-045  Persona B entra (ENTRADA 2) y se detiene en la zona restringida     -> INTRUSIÓN
  045-080  Persona B permanece en la zona restringida (35 s)                    -> MERODEO
  080-086  Persona B sale por la derecha
  090-105  Persona A cruza de derecha a izquierda                               -> SALIDA 1
  110-126  A y B entran juntos (2,5 s de diferencia)                            -> ENTRADAS 3 y 4, INGRESO EN GRUPO, AGLOMERACIÓN (umbral 2)
  130-135  Motocicleta entra a la zona de no estacionar; queda quieta 135-180  -> MAL ESTACIONADO (45 s)
  180-185  Motocicleta sale
  150-186  Puerta de bodega abierta (36 s)                                      -> PUERTA ABIERTA
  192-235  Pluma de humo gris creciente arriba a la izquierda                   -> HUMO (experimental)
  238-259  Caja dejada en el piso sin nadie cerca (21 s)                        -> OBJETO ABANDONADO
  259-266  Cámara cubierta (negro)                                              -> MANIPULACIÓN
Uso: python3 gen_casos.py salida.yuv   (luego ffmpeg codifica)"""
import sys, numpy as np, cv2, datetime as dt
from skimage import data
import matplotlib, os
W, H, FPS, DUR = 640, 360, 15, 266
rng = np.random.default_rng(7)
bg = np.full((H, W, 3), (92, 98, 104), np.uint8)
cv2.rectangle(bg, (0, 0), (W, 110), (150, 145, 138), -1)             # muro
for x in range(40, W, 110): cv2.line(bg, (x, 150), (x + 30, H), (220, 220, 220), 3)
cv2.rectangle(bg, (470, 40), (600, 105), (60, 70, 90), -1)            # puerta (cerrada)
cv2.line(bg, (535, 40), (535, 105), (45, 52, 68), 2); cv2.circle(bg, (585, 75), 4, (180, 180, 150), -1)
cv2.line(bg, (320, 110), (320, H), (0, 190, 255), 1)                  # marca en piso de la línea de acceso
noise = rng.integers(-6, 6, (H, W, 3))
bg = cv2.GaussianBlur(np.clip(bg.astype(int) + noise, 0, 255).astype(np.uint8), (5, 5), 0)

A = cv2.resize(cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR), (170, 170))
hop = cv2.imread(os.path.join(os.path.dirname(matplotlib.__file__), 'mpl-data', 'sample_data', 'grace_hopper.jpg'))
B = cv2.resize(hop, (150, 176)); Bs = cv2.resize(hop, (130, 152))
moto = cv2.resize(cv2.cvtColor(data.stereo_motorcycle()[0], cv2.COLOR_RGB2BGR), (240, 162))
t0 = dt.datetime(2026, 9, 20, 14, 0, 0)

def paste(fr, img, x, y):
    h, w = img.shape[:2]; x0, x1 = max(0, x), min(W, x + w); y0, y1 = max(0, y), min(H, y + h)
    if x1 <= x0 or y1 <= y0: return
    fr[y0:y1, x0:x1] = img[y0 - y:y1 - y, x0 - x:x1 - x]
lerp = lambda a, b, u: int(a + (b - a) * max(0, min(1, u)))

# pluma de humo: partículas gaussianas que crecen y derivan
parts = [(rng.uniform(60, 220), rng.uniform(70, 150), rng.uniform(0.6, 1.4), rng.uniform(0, 6.28)) for _ in range(28)]
out = open(sys.argv[1], 'wb')
for i in range(DUR * FPS):
    t = i / FPS; fr = bg.copy()
    # puerta abierta
    if 150 <= t < 186: cv2.rectangle(fr, (472, 42), (598, 103), (22, 22, 26), -1)
    # humo
    if 192 <= t < 236:
        u = min(1, (t - 192) / 30); a = np.zeros((H, W), np.float32)
        for (px, py, s, ph) in parts:
            cx = px + 12 * np.sin(t * 0.7 + ph); cy = py - 10 * u + 6 * np.cos(t * 0.5 + ph)
            cv2.circle(a, (int(cx), int(cy)), int(18 + 45 * u * s), 1.0, -1)
        a = cv2.GaussianBlur(a, (0, 0), 14) * (0.78 * u)
        a = np.clip(a, 0, 0.85)[..., None]
        fr = (fr * (1 - a) + np.array([208, 208, 206]) * a).astype(np.uint8)
    # personas
    if 10 <= t < 25: paste(fr, A, lerp(-170, 660, (t - 10) / 15), 168)
    if 30 <= t < 45: paste(fr, B, lerp(-150, 470, (t - 30) / 15), 92)
    if 45 <= t < 80: paste(fr, B, 470 + int(4 * np.sin(t)), 92)
    if 80 <= t < 86: paste(fr, B, lerp(470, 660, (t - 80) / 6), 92)
    if 90 <= t < 105: paste(fr, A, lerp(660, -170, (t - 90) / 15), 168)
    if 110 <= t < 126:
        paste(fr, A, lerp(-170, 660, (t - 110) / 16) + 140, 168)
        paste(fr, Bs, lerp(-170, 660, (t - 110) / 16), 190)
    # motocicleta
    if 130 <= t < 135: paste(fr, moto, lerp(-240, 40, (t - 130) / 5), 190)
    if 135 <= t < 180: paste(fr, moto, 40, 190)
    if 180 <= t < 185: paste(fr, moto, lerp(40, -240, (t - 180) / 5), 190)
    # objeto abandonado
    if 238 <= t < 259:
        cv2.rectangle(fr, (250, 262), (310, 305), (40, 75, 120), -1); cv2.rectangle(fr, (250, 262), (310, 305), (25, 45, 80), 2)
        cv2.line(fr, (250, 283), (310, 283), (30, 55, 95), 2)
    # cámara cubierta
    if t >= 259: fr[:] = (6, 6, 8)
    ts = (t0 + dt.timedelta(seconds=int(t))).strftime('SALON  %Y-%m-%d %H:%M:%S')
    cv2.rectangle(fr, (0, 0), (330, 26), (0, 0, 0), -1)
    cv2.putText(fr, ts, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    out.write(cv2.cvtColor(fr, cv2.COLOR_BGR2YUV_I420).tobytes())
out.close()
