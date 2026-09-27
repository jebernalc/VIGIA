# VIGÍA local · versión 0.2

Aplicación experimental de investigación de video histórico en español. Requiere Python 3.11+, FFmpeg y FFprobe. El servidor sirve el frontend y la API desde el mismo origen.

```bash
cd VIGIA
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export VIGIA_PASSWORD_A="$(python -c 'import secrets;print(secrets.token_urlsafe(18))')"
export VIGIA_PASSWORD_B="$(python -c 'import secrets;print(secrets.token_urlsafe(18))')"
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Abre http://127.0.0.1:8000. En el primer inicio, las credenciales generadas se imprimen una vez en consola si no se configuran variables. Usuarios: `operador-a` y `operador-b`, en organizaciones independientes. Para mantener acceso tras reiniciar, configura las variables **antes del primer inicio**; si las omites, conserva la clave impresa en consola. No publiques el puerto en Internet: los tokens residen en memoria y no hay TLS, cuotas por usuario ni gestión de usuarios en el MVP.

En **Centro de operaciones**, crea una cámara, elige el archivo MP4 e impórtalo. Espera a que aparezca «Listo para consultar»; abre el archivo en **Chat**. Usa los accesos rápidos, introduce un intervalo personalizado o pregunta «muéstrame fotogramas en los últimos 5 minutos». «Encuentra personas entre 00:00:01 y 00:00:03» responde de forma transparente que no hay detector instalado. Selecciona un fotograma, extrae un clip y abre un expediente. El informe HTML tiene botón de imprimir/guardar como PDF. Consulta `CAPACIDADES.md` para distinguir lo probado de lo pendiente.

Video sintético de prueba, sin datos personales:

```bash
ffmpeg -f lavfi -i testsrc=size=640x360:rate=10 -t 20 -pix_fmt yuv420p sample.mp4
```

Los originales reciben hash SHA-256 y se guardan aparte de fotogramas y clips. Los segundos representan posición dentro del archivo; **no hay hora de captura inferida**. Cada consulta por objetos responde honestamente que falta detector. No existen RTSP, reglas, alertas ni procesamiento de flujos en vivo todavía. El tamaño máximo de carga es 250 MB, duración máxima de 2 horas y la extracción máxima de clip 5 minutos.

Mejoras prioritarias: sesiones persistentes y revocables; cuotas por cliente; validación rigurosa del contenedor/códecs y aislamiento del proceso FFmpeg; trabajos persistentes con reintentos; detector CPU optativo y su evaluación; permisos por rol y cámara; conservación probatoria y retención configurables; RTSP/ONVIF y búfer de eventos en un agente de borde. Consulte `ARCHITECTURE.md`.

## Publicación de demostración

El repositorio incluye `Dockerfile` y `render.yaml` para crear un servicio web en Render mediante su opción de Blueprint. El servicio instala FFmpeg y publica la API y la interfaz en un mismo origen. Las variables `VIGIA_PASSWORD_A` y `VIGIA_PASSWORD_B` se generan en el panel de alojamiento; obtén allí sus valores para entrar con `operador-a` y `operador-b`. No coloques contraseñas en GitHub.

La modalidad gratuita puede suspenderse cuando no se usa y su disco local es temporal: los videos, expedientes y bases de datos pueden perderse durante reinicios o redespliegues. Esta publicación sirve **solo para ensayos con video sintético**. Una operación institucional necesita disco persistente u objetos privados, base de datos gestionada, gestión robusta de usuarios y endurecimiento de la API antes de cargar imágenes sensibles.
