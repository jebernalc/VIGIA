# Arquitectura y propuesta de evolución

## Implementado

FastAPI, SQLite y almacenamiento local segregado por organización. Un pool de dos trabajadores extrae con FFmpeg fotogramas auténticos de MP4 cada ~5 segundos. El parser de chat limita cámara y tiempo; el recorte transcodifica con FFmpeg. Todas las consultas a objetos se filtran por organización en API. No se asignan detectores inexistentes.

## Próxima célula de producción

Separar plano de control (identidad, tenants, API, políticas) y plano de datos (agentes de borde, ingestión, metadatos, índices, búsqueda, medios). Sustituir SQLite por PostgreSQL con aislamiento y pruebas de políticas de fila; objetos por almacén cifrado y claves gestionadas; colas separadas para análisis interactivo y masivo con prioridades y cuotas. Crear agentes por sede que se conecten a los NVR por adaptadores versionados y reporten salud y edad de cuadro. Mantener originales en su región y hacer búsquedas por índices derivados. Medir uso por cliente, errores, latencia, disponibilidad y costos. Añadir réplica y recuperación, restauración ensayada y políticas de retención bloqueadas por expediente.

5.000 cámaras a 2 Mb/s producen aproximadamente 10 Gb/s y 108 TB/día antes de replicación. Analizar todos los cuadros multiplica el cómputo: dimensionar por perfiles continuo, muestreado y bajo demanda. Ninguna prueba de esta entrega valida esa escala.

Objetivos propuestos para medir: primer fotograma <2 s desde NVR local, edad de cuadro <3 s, primera página indexada <2 s, alerta <10 s, clip de 30 s <15 s, falsos avisos por clase y escenario, disponibilidad por componente y costo por cámara/consulta. No son garantías. Matriz de integración inicial: MP4/H.264 verificado con FFmpeg local; RTSP, ONVIF y NVR propietarios pendientes de prueba por fabricante, firmware y licencia. Un generador sintético de consultas podrá medir API/cola, pero no equivaldrá a 5.000 flujos reales.

## Mejoras al prompt original

1. Exigir antes de escalar un presupuesto cuantificado de retención, tasa de cuadros, resolución, concurrencia y latencia por cliente.
2. Definir un conjunto etiquetado y revisión humana para precisión, falsos avisos, deriva e incertidumbre por escenario.
3. Separar explícitamente evidencia de archivo, observación de flujo en vivo, resultado inferido y conclusión confirmada.
4. Exigir pruebas de red y almacenamiento con NVR reales, pérdida de paquetes, cortes, reloj desajustado y reconexión.
5. Añadir un plan de seguridad de producción: SSO, RBAC fino, auditoría inalterable, cifrado, borrado, gestión de claves y revisión de licencias de modelos.
