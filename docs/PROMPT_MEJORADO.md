# Prompt mejorado para VIGÍA

## Qué se corrigió del prompt original

| Problema del original | Mejora |
|---|---|
| Pedía «abrir desde cualquier navegador» pero imponía FastAPI + React + PostgreSQL + FFmpeg, que exigen instalar un servidor | Se divide en **fase 1: edición 100% navegador** (doble clic, sin instalación) y **fase 2: servidor**, con la misma API v1 |
| «Usar FFmpeg para clips» es imposible en un navegador sin servidor | Se exige **copia de flujo equivalente** a `ffmpeg -c copy` y registrar el comando equivalente; FFmpeg real en fase 2 |
| Ambigüedad de «entre 00:01:00 y 00:03:00» (¿hora de reloj o posición?) | Regla explícita: reloj si coincide con el horario de la grabación; si no, posición; mostrar y permitir editar |
| «Últimos 5 minutos» en un archivo histórico | Definido: final de la grabación disponible, nunca el reloj actual |
| No definía datos de prueba ni cómo verificar la IA sin inventar | Video sintético reproducible con evento de persona conocido (01:20–01:50) y aserción de ausencia (0–60 s) |
| Criterios de aceptación cualitativos | Lista de pruebas automatizadas obligatorias con resultado esperado |
| Aislamiento multicliente sin distinguir lógico vs. físico | Exigir declarar el límite: en navegador es lógico; fuerte sólo con servidor |

## Prompt (versión 2)

> Actúa como equipo senior (arquitectura, video, visión, búsqueda, UX, seguridad, evidencia digital, QA). Construye **VIGÍA**, plataforma multicliente de monitoreo y análisis de video, en español, en **dos fases con la misma API v1**.
>
> **Fase 1 — Edición local (obligatoria en esta entrega).** Un `VIGIA.html` que se abra con doble clic (`file://`) en Chrome/Edge/Firefox/Safari recientes, sin servidor, sin instalación, sin Internet y sin claves de IA. Persistencia en IndexedDB con esquema versionado. Dependencias sólo locales y con licencia verificable. Motor IA opcional en carpeta aparte, cargado únicamente por acción explícita del usuario.
>
> **Recorrido que debe funcionar y probarse automáticamente:**
> 1. Crear entorno demo: 2 organizaciones, usuarios por rol con contraseñas **aleatorias mostradas una sola vez**, hash PBKDF2; login con selección de organización.
> 2. Crear cámara (nombre, sede, zona, ubicación, zona horaria IANA, tipo archivo/cámara web/RTSP; RTSP se registra pero se declara no conectable desde navegador).
> 3. Importar MP4/MOV/WebM: validar bytes mágicos y tamaño; SHA-256; original inmutable; metadatos (duración, códec, resolución, fps, audio); hora de captura = declarada > contenedor > **desconocida** (nunca la de carga). Indexación asíncrona con progreso real persistente: miniaturas 1/s, detección de movimiento determinista con zonas de exclusión, detector de objetos local opcional.
> 4. Chat con intérprete determinista: fotogramas, búsqueda por clase y ventana, «¿qué sucede ahora?», clip alrededor de hallazgo, abrir/resumir caso, informe, indicadores, reglas; seguimientos («amplía cinco minutos antes», «ahora solo vehículos»). Mostrar interpretación editable, supuestos y faltantes; pedir aclaración si falta cámara.
> 5. Semántica temporal: «últimos N disponibles» en archivo = final de la grabación; `HH:MM:SS` = reloj si coincide con el horario de la grabación, si no posición; siempre mostrar la interpretación y la cobertura (recortada, índice pendiente, motor que no soporta la clase).
> 6. Clip MP4 **sin recodificar** alineado al fotograma clave anterior, con límites solicitados y reales, comando FFmpeg equivalente, hash y referencia al original; WebM: recodificación etiquetada.
> 7. Expediente (hipótesis / sugerido por IA / revisado / confirmado), notas, aprobación por rol, protección ante borrado; informe HTML + PDF con resumen, cronología, cámaras, hashes, método, lagunas, incertidumbres y advertencia de no admisibilidad universal.
> 8. En vivo: cámara web y emulación desde archivo etiquetada; último cuadro con hora de captura, edad y conexión; búfer de 5 min; clip de contexto; regla temporal con vista previa, confirmación, auditoría y alertas internas.
> 9. Tablero con totales reales y objetivos medidos (edad de cuadro, factor de indexación, tiempo de clip, tasa de descarte).
> 10. Auditoría encadenada por hash con verificación.
>
> **Reglas de honestidad:** nunca atribuir detecciones que el motor no produjo; si el análisis no soporta la clase, decirlo y ofrecer sólo lo implementado; sin evidencia, decir «Sin evidencia»; no presentar archivos como vivo; declarar el límite del aislamiento en navegador; no afirmar escala ni precisión no medidas; sin reconocimiento facial, biometría ni placas por defecto.
>
> **Pruebas obligatorias (automatizadas, con resultado reportado):** aislamiento entre organizaciones en cada recurso; permisos de descarga y de confirmación; intérprete y ventanas; búsqueda limitada a cámara y periodo; carga y hash; fotograma auténtico; clip (duración, límites, referencia, hash, validado con ffprobe); informe con fuentes; respuestas honestas (cámara desconectada, sin detecciones, cámara inexistente); auditoría alterada detectada; inyección de instrucciones; IA sobre video sintético con persona conocida en 01:20–01:50 y ninguna en 0–60 s; recorrido completo por la interfaz con capturas.
>
> **Fase 2 (diseñar, no implementar ahora):** FastAPI + PostgreSQL (RLS por organización) + almacenamiento de objetos con WORM + colas tiempo real/indexación + agentes de borde RTSP/ONVIF + FFmpeg + detectores GPU + búsqueda semántica por organización; `ARCHITECTURE.md` con plano de control/datos, celdas, 10 Gb/s y 108 TB/día para 5.000 cámaras a 2 Mb/s, perfiles continuo/muestreo/bajo demanda, objetivos medibles y generador de carga (aclarando que no valida video real).
>
> **Entregables:** `VIGIA.html`, carpeta `motor-ia/`, `muestras/`, `vigia.config.example.js`, código fuente con script de compilación y pruebas, `README.md`, `ARCHITECTURE.md`, `API.md`, `TESTING.md` (comandos, resultados, qué no se verificó), `CAPACIDADES.md` (verificado / parcial / fase posterior).
