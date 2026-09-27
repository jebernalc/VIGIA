# VIGÍA · Matriz de capacidades

Estados: **Implementado y verificado** (prueba automática) · **Implementado, verificación parcial** · **Fase posterior** (diseñado, no implementado).

| Capacidad | Estado | Notas |
|---|---|---|
| Inicio de sesión local, contraseñas aleatorias PBKDF2, selección de organización | Implementado y verificado | Prueba «Autenticación». Bloqueo tras 5 intentos fallidos (60 s). |
| Aislamiento multicliente en cada operación de la API interna | Implementado y verificado | Prueba «Aislamiento»: 20+ accesos cruzados denegados. Aislamiento lógico: los datos viven en el navegador del equipo. |
| Permisos por rol (5 roles, 20 permisos) aplicados en la API | Implementado y verificado | Prueba «Permisos por rol». |
| Cámaras, sedes, zonas, grupos, zona horaria IANA, zonas de exclusión | Implementado, verificación parcial | CRUD verificado en pruebas; editor de zonas probado manualmente. |
| Importación MP4/MOV/WebM con validación de bytes, límite de tamaño y SHA-256 | Implementado y verificado | Original inmutable (no se puede sobrescribir) y verificable. |
| Metadatos: duración, códec, resolución, fps, audio, hora del contenedor | Implementado y verificado | Hora de captura: declarada > contenedor > desconocida. Nunca se deduce de la carga. |
| Indexación asíncrona con progreso real, cola persistente y reanudación | Implementado y verificado | Trabajador en el hilo principal con cesión cooperativa; un trabajo a la vez. |
| Detector de movimiento determinista (movimiento-v1) | Implementado y verificado | No clasifica objetos; así se declara en cada respuesta. |
| Detector de objetos local COCO-SSD (TensorFlow.js), opcional y explícito | Implementado, verificación parcial | Verificado con persona real (foto NASA de dominio público) en el video sintético. Precisión en cámaras reales no medida. |
| Fotograma auténtico a resolución nativa con hash | Implementado y verificado | PNG sin pérdida desde la decodificación del navegador. |
| Clip MP4 sin recodificar (copia de flujo) con límites reales y hash | Implementado y verificado | Verificado también con ffprobe/ffmpeg en Node (H.264/AAC y VP9/Opus). |
| Clip de WebM / MP4 fragmentado mediante MediaRecorder | Implementado, verificación parcial | Etiquetado como RECODIFICADO; tiempo real 1×. |
| Chat en español con intérprete determinista y tarjeta de interpretación editable | Implementado y verificado | 21 pruebas unitarias del intérprete + recorrido principal. |
| Consultas de seguimiento («amplía cinco minutos antes», «ahora solo vehículos») | Implementado y verificado |  |
| Cobertura, índice pendiente y respuestas honestas sin evidencia | Implementado y verificado | Prueba «Respuestas honestas». |
| Cámara web en vivo (getUserMedia) con edad del cuadro y búfer de 5 min | Implementado y verificado | Probado con el dispositivo simulado de Chromium (primer cuadro ≈1,2 s). Con cámara física: requiere permiso del navegador. |
| Emulación en vivo desde archivo (reloj simulado, etiquetada) | Implementado y verificado | Prueba de interfaz: «ahora» devuelve cuadro, edad y etiqueta EMULACIÓN. |
| Reglas temporales desde chat con confirmación, alertas en la aplicación | Implementado y verificado | Prueba de interfaz: vista previa → confirmación → alerta por movimiento real. Sin notificaciones externas (por diseño). |
| Expedientes: hipótesis / sugerido IA / revisado / confirmado, notas, aprobación | Implementado y verificado |  |
| Informe preliminar HTML y PDF con fuentes, hashes, método, lagunas | Implementado y verificado | No afirma admisibilidad legal. |
| Tablero de indicadores con totales reales | Implementado y verificado |  |
| Auditoría encadenada por hash y detección de alteraciones | Implementado y verificado |  |
| Retención configurable y protección de evidencia en expedientes | Implementado, verificación parcial | Borrado manual respeta protección; borrado programado: fase posterior. |
| Conexión RTSP | Fase posterior | Un navegador no abre RTSP: requiere agente de borde (ARCHITECTURE.md). |
| Servidor multiusuario (FastAPI + PostgreSQL + cola distribuida) | Fase posterior | Diseñado en ARCHITECTURE.md / API.md; esta entrega es la edición local. |
| Búsqueda semántica con embeddings visuales | Fase posterior | No implementada: no se ofrece en la interfaz. |
| Reconocimiento facial, biometría, lectura de placas | Fase posterior | Excluidos por defecto; sujetos a evaluación legal y de precisión. |
| Escala a 5.000 cámaras | Fase posterior | Objetivo de diseño; no validado. Ver ARCHITECTURE.md. |
