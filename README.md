# VIGÍA · Edición local (navegador)

Plataforma de monitoreo y análisis de video con chat en español, preservación de evidencia (SHA-256, cadena de custodia), expedientes, informes e indicadores. **Se abre con doble clic en cualquier navegador moderno y funciona sin Internet, sin servidor y sin claves de IA.**

## Requisitos

| Requisito | Detalle |
|---|---|
| Navegador | Chrome o Edge 110+ (recomendado), Firefox 115+ o Safari 16.4+ |
| Video | MP4/MOV (H.264, H.265 si el equipo lo decodifica, VP9, AV1) o WebM |
| Instalación | Ninguna. No requiere Python, Docker ni permisos de administrador |
| Motor IA (opcional) | Carpeta `motor-ia/` junto a `VIGIA.html` (≈25 MB, incluida) |

## Acceso de prueba en línea

https://jebernalc2036-ai.github.io/vigia/ (GitHub Pages; los datos se guardan sólo en su navegador)

## Inicio local (comando exacto)

1. Descomprima `VIGIA.zip` en una carpeta, por ejemplo `Documentos\VIGIA`.
2. Doble clic en **`VIGIA.html`** (o arrástrelo a Chrome/Edge). URL local: `file:///…/VIGIA/VIGIA.html`.
3. Pulse **Crear entorno de demostración**. Se generan 2 organizaciones y 8 usuarios con **contraseñas aleatorias que se muestran una sola vez** (descárguelas en .txt). Sólo se guardan como hash PBKDF2-SHA-256.

Alternativa con servidor local (opcional, misma funcionalidad):

```bash
cd VIGIA
python -m http.server 8080      # luego abra http://localhost:8080/VIGIA.html
```

> Los datos de `file://` y de `http://localhost` se guardan en almacenamientos distintos del navegador.

## Usuarios de demostración

| Usuario | Organización → rol |
|---|---|
| admin@norte.demo | Norte → Administrador institucional |
| supervisor@norte.demo | Norte → Supervisor |
| operador@norte.demo | Norte → Operador de monitoreo |
| investigador@norte.demo | Norte → Investigador |
| directivo@norte.demo | Norte → Directivo (sólo indicadores y expedientes) |
| admin@sur.demo, operador@sur.demo | Sur → Administrador / Operador |
| consultor@demo | Norte (investigador) **y** Sur (operador): elige organización al entrar |

Las contraseñas se pueden fijar para demostraciones copiando `vigia.config.example.js` como `vigia.config.js` (equivalente a `.env.example`). No use contraseñas de producción.

## Recorrido en 3 minutos

1. **Centro de operaciones → Cargar video de demostración.** Crea la cámara «Parqueadero norte (demo)» y abre la importación con el video sintético de 3 min 20 s (marque «Analizar con motor IA» para detectar personas). Verá el SHA-256 y el progreso real de la indexación.
2. **Chat** (vista principal). Pruebe:
   - `muéstrame fotogramas de cámara 1 en los últimos 5 minutos disponibles`
   - `encuentra personas o vehículos entre 00:01:00 y 00:03:00`
   - `extrae un clip desde 10 segundos antes hasta 20 segundos después de este hallazgo`
   - `amplía cinco minutos antes` · `ahora solo vehículos`
   - `abre un caso "Ingreso por rampa" con este hallazgo` · `genera el informe del caso`
   - `indicadores`
3. **Centro de operaciones → Emular en vivo** y luego `¿qué sucede ahora en la cámara 1?`. Con una cámara web, cree una cámara de tipo «Cámara web local».
4. `avísame si hay movimiento en la cámara 1 durante 10 minutos` → confirme → alerta en la aplicación.
5. **Expedientes**: notas, hipótesis, aprobación, informe HTML y PDF. **Indicadores**: totales reales. **Administración → Auditoría**: verificar cadena de hashes.

## Cómo cargar su propio video

Centro de operaciones → **Importar video** (o arrastre el archivo). Indique fuente declarada y, si la conoce, la hora de inicio en la zona horaria de la cámara. Si no la indica se usa la hora del contenedor (`creation_time`) y, si no existe, se marca como **desconocida**: VIGÍA nunca deduce la hora de captura de la hora de carga.

Para generar un video de prueba propio con FFmpeg:

```bash
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=15 -t 180 -c:v libx264 -pix_fmt yuv420p \
  -metadata creation_time=2026-09-20T19:00:00Z prueba.mp4
```

El video de demostración se generó con `codigo-fuente/tools/gen_muestra.py` (escena sintética; la «persona» es la fotografía de dominio público de la NASA incluida en scikit-image).

## Qué hace (y qué no)

- **Movimiento** (siempre activo): detecta cambios; **no** distingue personas de vehículos, y el chat lo declara.
- **Motor IA local** (opcional, Administración → Motor de visión): COCO-SSD sobre TensorFlow.js, 80 clases, en su equipo. Nunca se descarga nada; se carga sólo cuando usted lo pide. Precisión en sus cámaras **no medida**: marque falsos positivos como «descartado» para medir.
- **Clips MP4** sin recodificar (copia de flujo, como `ffmpeg -c copy`), con inicio alineado al fotograma clave anterior y límites reales registrados. WebM/MP4 fragmentado: recodificación en tiempo real, etiquetada como transformación.
- **RTSP**: se puede registrar, pero un navegador no puede abrir RTSP. Requiere el agente de borde descrito en `ARCHITECTURE.md`.
- **Sin** reconocimiento facial, biometría ni lectura de placas.
- **Aislamiento**: la API interna aplica organización y rol en cada operación (probado). Como todo reside en este navegador, quien controle el equipo y sus herramientas de desarrollo puede leer los datos locales. Para aislamiento fuerte entre clientes se necesita el servidor (fase 2).
- El informe es **preliminar** y no afirma admisibilidad legal.

## Estructura

```
vigia/
├── app/                       ← lo que se publica y se abre en el navegador
│   ├── VIGIA.html             ← aplicación completa (un solo archivo, 0,9 MB)
│   ├── motor-ia/              ← TensorFlow.js + COCO-SSD + pesos (opcional, Apache-2.0)
│   ├── muestras/              ← video de demostración
│   └── vigia.config.js        ← configuración (sin secretos)
├── src/                       ← código fuente (JS/CSS)
├── tests/                     ← pruebas (Node, navegador, e2e) y capturas
├── tools/                     ← compilación y generador de video sintético
├── docs/                      ← ARCHITECTURE · API · TESTING · CAPACIDADES · PROMPT_MEJORADO
└── .github/workflows/pages.yml ← publicación automática en GitHub Pages
```

Compilar: `npm install && npm run build` (regenera `app/VIGIA.html`). Pruebas: `npm test`.

## Limitaciones reales

- Un trabajo de indexación a la vez, en el hilo principal (cede el control; la interfaz sigue respondiendo). Factor medido: ×18 tiempo real sólo movimiento; con IA depende de la GPU (≈×1 en CPU sin GPU).
- El almacenamiento es el cupo del navegador (normalmente decenas de GB). Administración → Datos muestra el uso y permite pedir almacenamiento persistente.
- El borrado programado por retención no se ejecuta (vista previa sí). Borrado manual respeta expedientes protegidos.
- La emulación en vivo reproduce un archivo con el reloj actual y así se etiqueta en cada tarjeta.

## Próximos hitos

1. Servidor FastAPI + PostgreSQL con la misma API v1 (`API.md`) y cola distribuida.
2. Agente de borde con RTSP/ONVIF, búfer local y subida de segmentos.
3. Evaluación de precisión por escenario con conjunto etiquetado propio; umbrales por cámara.
4. Búsqueda semántica con embeddings visuales locales por organización.
