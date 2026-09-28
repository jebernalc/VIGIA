# VIGÍA · versión 0.4

Aplicación experimental de investigación de video histórico en español. Requiere Python 3.11+, FFmpeg y FFprobe. El servidor sirve el frontend y la API desde el mismo origen.

## Registro de personas y usuario maestro

La interfaz ofrece dos modos:

- **Con Supabase:** configura `VIGIA_SUPABASE_URL` y `VIGIA_SUPABASE_PUBLISHABLE_KEY` (la clave pública, nunca la `service_role`). Aparecen «Crear cuenta maestra» e «Iniciar sesión». La persona registra correo, organización y contraseña de al menos 12 caracteres; confirma su correo y después inicia sesión. En su primer acceso se crea su organización y la membresía `maestro` en las tablas `vigia_organizaciones` y `vigia_miembros` con RLS. Cada nuevo registro crea una organización independiente. La API valida el token contra Supabase Auth y comprueba la membresía en cada consulta. No se usan metadatos editables del usuario para otorgar roles.
- **Sin Supabase:** continúa el modo local de demostración, con los dos usuarios generados al iniciar por primera vez. Este modo no muestra registro público.

Las tres migraciones aplicadas al proyecto activo se conservan en `supabase/`. El usuario maestro puede cambiar el nombre de su propia organización desde **Administración**; la API verifica el rol y una política RLS comprueba el creador y la membresía. Cada registro crea un maestro **de su propia organización**, sin acceso global a las demás. En modo Supabase, cámaras, grabaciones, fotogramas, clips, expedientes y auditoría se guardan en tablas `vigia_*` con RLS y los MP4/JPEG en el bucket privado `vigia-evidencias`. Las descargas requieren JWT del usuario y se comprueba el SHA-256 del objeto. Los usuarios de otras aplicaciones del proyecto Supabase no obtienen automáticamente acceso a VIGÍA.

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

Los originales reciben hash SHA-256 y se guardan aparte de fotogramas y clips. Los segundos representan posición dentro del archivo; **no hay hora de captura inferida**. Cada consulta por objetos responde honestamente que falta detector. No existen RTSP, reglas, alertas ni procesamiento de flujos en vivo todavía. En modo local, el tamaño máximo es 250 MB y duración máxima de 2 horas. En modo Supabase, el máximo es 50 MB y 5 minutos; el trabajo de extracción corre en el proceso web y requiere que la sesión siga vigente. En ambos modos, la extracción máxima de clip es 5 minutos.

Mejoras prioritarias: sesiones persistentes y revocables; cuotas por cliente; validación rigurosa del contenedor/códecs y aislamiento del proceso FFmpeg; trabajos persistentes con reintentos; detector CPU optativo y su evaluación; permisos por rol y cámara; conservación probatoria y retención configurables; RTSP/ONVIF y búfer de eventos en un agente de borde. Consulte `ARCHITECTURE.md`.

## Publicación de demostración

El repositorio incluye `Dockerfile` y `render.yaml` para crear un servicio web en Render mediante su opción de Blueprint. El servicio instala FFmpeg y publica la API y la interfaz en un mismo origen. El Blueprint configura la URL y la clave **publicable** de Supabase. Nunca coloques la clave secreta o `service_role` en GitHub. El dominio final debe añadirse a los destinos permitidos de confirmación de correo en Supabase Auth si se quiere que el enlace de confirmación regrese directamente a VIGÍA.

La modalidad gratuita puede suspenderse cuando no se usa. En modo Supabase, los metadatos y los objetos quedan almacenados de forma persistente en Supabase, pero la caché local y los trabajos en curso se pierden al reiniciar el contenedor. La extracción no tiene una cola durable; un despliegue o un vencimiento de sesión puede dejar una grabación pendiente o fallida. No hay detector de objetos, transmisión en vivo ni cuotas institucionales. Prueba primero con video sintético y configura el dominio final en los destinos permitidos de Supabase Auth.

## Primera ronda y cambios visuales

La pestaña **Rondas** permite guardar un recorrido de 1 a 32 cámaras, elegir intervalos entre 5 y 120 segundos y pasar manual o automáticamente entre vistas. En modo Supabase, el plan se guarda en `vigia_rondas` con RLS y solo el maestro puede crearlo o eliminarlo; miembros autenticados de la misma organización pueden consultarlo. En modo local se guarda en SQLite.

Sin una fuente de video en vivo, cada cámara presenta el fotograma más reciente de su último MP4 procesado con la etiqueta **ARCHIVO HISTÓRICO**. Para capturas actuales, el administrador del servidor puede definir `VIGIA_LIVE_SOURCES` como JSON que asocia UUID de cámara a URL RTSP, por ejemplo `{"uuid-de-camara":"rtsp://usuario:clave@host/ruta"}`. **No incluyas estas credenciales en el repositorio ni en el navegador.** El servidor obtiene un JPEG bajo demanda con FFmpeg, limita a dos capturas simultáneas y marca la vista **CAPTURA ACTUAL**. El cambio de cámara es periódico; cada captura depende de latencia y disponibilidad de la fuente RTSP. No es un flujo continuo ni un detector de incidentes.

En **Chat**, «¿Dónde hubo movimiento en los últimos 30 segundos?» compara fotogramas históricos en escala de grises, ordena hasta ocho intervalos por cambio visual y muestra imágenes y tiempos. Cambios de luz o encuadre pueden producir puntuaciones altas. No hay reconocimiento de personas, vehículos, objetos ni comprensión semántica; para ello se requiere un modelo visual evaluado con datos adecuados. La consulta de eventos en tiempo real, alertas y soporte de miles de cámaras son objetivos de fases siguientes.
