# VIGÍA · Arquitectura

## 1. Decisión de esta entrega

El pedido exigía un producto **que se abra desde cualquier navegador y funcione en local**. Por eso la fase 1 es una **edición 100% navegador**: un único `VIGIA.html` sin servidor, sin instalación y sin Internet. La arquitectura interna reproduce las fronteras del sistema servidor (API versionada, trabajador, almacenamiento de objetos, motores de visión intercambiables) para que la fase 2 sustituya capas sin rehacer el producto.

| Capa | Fase 1 (entregada) | Fase 2 (servidor) |
|---|---|---|
| Interfaz | HTML + JS sin framework, CSS propio, accesible, oscuro/claro, escritorio/tablet | La misma, servida por CDN; o React/TypeScript si el equipo lo prefiere |
| API | `api.js`: «API v1» en proceso; token de sesión → organización y rol; errores estructurados `{codigo, mensaje, detalle}` | FastAPI `/api/v1/...` con el mismo contrato (`API.md`) y OpenAPI |
| Datos | IndexedDB, esquema versionado con migraciones (`db.js`, v1) | PostgreSQL + migraciones Alembic; filas con `org_id` + RLS |
| Objetos | Almacén tipo objeto en IndexedDB: `originales/<org>/…` (inmutables), `derivados/`, `miniaturas/`, `alertas/` | S3/MinIO con buckets separados, Object Lock para originales, URLs firmadas |
| Trabajos | Cola persistente local (tabla `jobs`), un trabajador, reanudación tras recarga | Colas separadas tiempo real / indexación (Redis Streams, NATS o SQS) |
| Video | Decodificación del navegador; corte MP4 sin recodificar propio (`mp4cut.js`, mp4box.js) | FFmpeg/FFprobe en trabajadores; mismo comando equivalente registrado |
| Visión | `movimiento-v1` (determinista) + COCO-SSD local opcional (TF.js) | Detectores ONNX/TensorRT en GPU; perfiles continuo/muestreo/bajo demanda |
| Tiempo real | Cámara web (getUserMedia) y emulación desde archivo; búfer 5 min; reglas | Agentes de borde RTSP/ONVIF → WebRTC/LL-HLS; búfer en borde |
| Chat | Intérprete determinista en español + planificador con herramientas acotadas | Igual + adaptador opcional a LLM local; nunca obligatorio |

### Analítica (analitica-v1)

Pipeline por muestra (1 fps): detector IA (opcional) → seguimiento multiobjeto (predicción de velocidad + asignación óptima) → reglas geométricas por zona y línea → análisis de píxeles en rejilla 32×18 (puerta, objeto abandonado, manipulación, humo) → eventos con fotograma, recuadro, parámetros y motivo. El mismo motor corre en la indexación y en vivo (alertas inmediatas por regla). En producción, el agente de borde ejecutará este mismo motor, o su equivalente con modelos en GPU, y enviará sólo eventos y metadatos al plano de control. Ver `CASOS_DE_USO.md`.

### Funciones avanzadas (v1.1)

`api-pro.js` extiende la API v1 con la central de alarmas (máquina de estados nueva → reconocida → en atención → cerrada, SLA por prioridad, SOP e historial), el plano del sitio (almacén `plans`, migración IndexedDB v3), la búsqueda por apariencia y la recopilación del paquete de evidencia. `pro.js` ejecuta en el navegador la sinopsis (fondo por mediana, planificación sin colisiones, recortes del original), la redacción de privacidad (pixelado irreversible por detecciones) y el empaquetado ZIP con SHA256SUMS. En la fase servidor, la sinopsis y la redacción pasan a trabajadores GPU y la central de alarmas a un servicio con notificaciones (correo, SMS, webhook) y escalamiento por turnos. Ver `FUNCIONES_AVANZADAS.md`.

### Flujo del chat

`interpretar (nlp.js) → normalizar zona horaria (chat.js) → autorizar y comprobar cobertura (api.js) → planificar → ejecutar herramientas limitadas (búsqueda, fotogramas, clip, expediente, informe, indicadores, regla) → ensamblar hallazgos → citar evidencia → responder breve + tarjetas`.

El intérprete sólo extrae entidades (cámaras, ventana, clases, márgenes, títulos). No existe entidad «organización» ni «rol»: el alcance viene siempre de la sesión. Notas, nombres de archivo y texto de OCR nunca pasan por el intérprete como instrucción.

### Tiempo y zonas horarias

- Cada cámara tiene zona IANA. Cada grabación guarda `horaInicio` y su **fuente**: `declarada_por_usuario`, `metadatos_contenedor` (mvhd `creation_time`, que puede ser la hora de codificación) o `desconocida`.
- «Últimos N disponibles» en un archivo = final de la grabación, nunca el reloj actual.
- `HH:MM:SS` se interpreta como hora de reloj si coincide con el horario de la grabación; si no, como posición en el archivo. La interpretación se muestra y se puede editar.

### Preservación forense

- Original: SHA-256 al importar, bytes guardados sin alterar; el almacén rechaza sobrescribir `originales/`.
- Derivado (clip, fotograma, captura en vivo): ID del original y su hash, intervalo solicitado y real, método, comando FFmpeg equivalente, transformación, creador, fecha, hash propio.
- Accesos y descargas de medios pasan por `api.mediaURL` (permiso + organización), generan URL de objeto que caduca a los 10 min y quedan en auditoría.
- Auditoría encadenada por hash por organización; `verifyAudit` detecta alteraciones.
- Expedientes distinguen hipótesis / sugerido por IA / revisado / confirmado; su evidencia queda protegida ante borrado.

### Seguridad de la edición local

- Contraseñas aleatorias por instalación, PBKDF2-SHA-256 (150 000 iteraciones), bloqueo tras 5 fallos, sesión en memoria (8 h).
- CSP restrictiva sin conexiones externas (`connect-src` sólo `blob:`/`data:`), `referrer no-referrer`.
- Validación de formato por bytes mágicos, límite de tamaño, nombres saneados, sin rutas de sistema de archivos (no hay traversal posible).
- **Límite honesto**: el aislamiento multicliente es lógico. Todo reside en el perfil del navegador; quien controle el equipo puede leer IndexedDB. Aislamiento fuerte = fase 2.

## 2. Camino a 5.000 cámaras (diseño, no validado)

### Cifras de partida

- 5.000 cámaras × 2 Mb/s = **10 Gb/s** de entrada sostenida.
- 10 Gb/s × 86.400 s ÷ 8 = **108 TB/día** antes de replicación (≈3,2 PB/mes). Con replicación ×2–3 o codificación de borrado 1,4× se multiplica.
- Decodificar e inferir **todos** los cuadros de todos los flujos (5.000 × 15 fps = 75.000 cuadros/s) exige dimensionamiento dedicado de GPU; por eso se proponen perfiles.

### Plano de control y plano de datos

```
                 ┌───────────── PLANO DE CONTROL (regional, HA) ─────────────┐
 Usuarios ──►  API v1 · Auth/OIDC · Chat/planificador · Expedientes · Informes │
                 │  PostgreSQL (org_id + RLS) · Auditoría encadenada · Métricas │
                 └───────────────┬───────────────────────────────┬────────────┘
                                 │ órdenes/configuración          │ consultas
 ┌──────────── PLANO DE DATOS (celdas por cliente/sede) ─────────┴────────────┐
 │ Agentes de borde (RTSP/ONVIF) ──► ingesta ──► almacén de objetos (originales│
 │  búfer local 24–72 h              │            inmutables + índices)        │
 │                                   ├─► cola TIEMPO REAL ─► detectores GPU ─► alertas
 │                                   └─► cola INDEXACIÓN ─► miniaturas, detecciones, embeddings
 └───────────────────────────────────────────────────────────────────────────┘
```

- **Celdas de capacidad**: cada celda atiende ~250–500 cámaras (1–5 Gb/s), con su almacenamiento, colas y GPUs. Un cliente grande ocupa varias celdas; uno pequeño comparte celda con cuotas.
- **Agentes de borde**: conectan RTSP/ONVIF, sincronizan reloj (NTP/PTP), mantienen búfer local, suben segmentos (fMP4 de 2–10 s) con hash por segmento, aplican muestreo en origen.
- **Colas diferenciadas**: tiempo real (latencia, descarta si se satura) e indexación (rendimiento, reintenta). Límites por cliente para evitar vecinos ruidosos.
- **Perfiles de análisis**: *continuo* (todos los cuadros, cámaras críticas), *muestreo* (1–2 fps, por defecto), *bajo demanda* (sólo al consultar un intervalo). Presupuesto de GPU por cliente.
- **Almacenamiento**: originales en objeto con bloqueo WORM; índices (tiempo/cámara/clase) en PostgreSQL particionado por día; embeddings en índice vectorial separado por organización.
- **Alta disponibilidad**: plano de control multi-AZ; celdas independientes (fallo contenido); reintentos idempotentes; RPO/RTO por componente.
- **Telemetría**: métricas por cámara (edad de cuadro, pérdidas, fps), por cola (profundidad, latencia), por modelo (tiempo de inferencia), trazas distribuidas.
- **Residencia de datos**: región por organización; los originales nunca salen de su región; el plano de control regional.

### Objetivos preliminares (a medir, no garantías)

| Métrica | Objetivo inicial | Cómo medir |
|---|---|---|
| Primer fotograma al abrir una cámara | < 2 s | agente → navegador, p95 |
| Edad del cuadro en vivo | < 2 s | captura vs. visualización |
| Primera página de resultados indexados | < 1 s | API, p95, ventana ≤ 24 h |
| Latencia de alerta | < 5 s | evento → notificación en app |
| Extracción de clip | < 3 s por 30 s (copia de flujo) | por origen y duración |
| Tasa de falsos avisos | por escenario, reportada | hallazgos descartados / revisados |
| Disponibilidad | 99,9% control; 99,5% por celda | sondas sintéticas |
| Costo | por cámara-mes y por consulta | facturación de nube / etiquetas |

La edición local ya mide: edad del cuadro, factor de tiempo real de indexación, duración de extracción de clips y tasa de descarte (Indicadores).

### Generador de carga sintética (fase 2)

Simulará N agentes publicando metadatos de segmentos y detecciones sintéticas, M usuarios consultando la API y el chat, y medirá colas y latencias. **Un ensayo sintético de API/colas no valida 5.000 flujos de video reales**; la validación requiere piloto con video real por celda.

### Matriz de integración (inicial)

| Fuente | Protocolo | Estado |
|---|---|---|
| Archivos MP4/MOV/WebM | ISO-BMFF / Matroska | Implementado (fase 1) |
| Cámara web | getUserMedia | Implementado (fase 1) |
| Cámaras IP genéricas | RTSP (H.264/H.265) | Fase 2, agente de borde |
| ONVIF Perfil S/T | descubrimiento + RTSP | Fase 2 |
| Exportaciones DVR/NVR por fabricante | formatos propietarios | Evaluar por fabricante/versión y licencia |

Interfaz de conector propuesta: `listarFuentes()`, `abrirFlujo(fuente) → segmentos`, `hora(fuente)`, `estado(fuente)`, `exportar(intervalo)`.

## 3. Riesgos y supuestos

- Precisión de COCO-SSD en CCTV real (cenital, nocturna, IR) desconocida → evaluación por escenario antes de uso operativo; nunca afirmar ausencia de sesgos.
- Almacenamiento del navegador puede ser desalojado si no se concede persistencia.
- `creation_time` del contenedor puede no ser la hora de captura → se etiqueta.
- Extensiones de biometría/placas quedan fuera por defecto; requieren evaluación legal, de privacidad y de precisión por jurisdicción.
