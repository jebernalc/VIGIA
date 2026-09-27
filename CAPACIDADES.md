# Capacidades de VIGÍA · versión 0.3

| Función | Estado | Evidencia / límite |
|---|---|---|
| Interfaz en español y navegación adaptable | Implementada y comprobada con verificación sintáctica | Falta validación visual en navegadores reales y con usuarios. |
| Dos organizaciones y acceso aislado | Implementado y probado | Prueba automatizada de recursos y descargas entre organizaciones. |
| Registro con correo, cuenta maestra y pertenencia en Supabase | Implementado; verificación parcial | Tres migraciones aplicadas, RLS y políticas comprobadas. Flujo de Auth, edición de organización y separación probados con simulación; falta registrar un correo real y probar confirmación. |
| Importación MP4, hash original y fotogramas reales | Implementado y probado en modo local; integración nube pendiente de prueba con usuario real | Video sintético generado con FFmpeg; en Supabase el original y fotogramas se guardan en Storage privado y los metadatos en Postgres. |
| Consultas de fotogramas por intervalo y chat | Implementado y probado | Parser determinista; tiempos relativos al archivo. |
| Clips e informes preliminares | Implementado y probado | PDF mediante función de imprimir del navegador. |
| Búsqueda de personas y vehículos | Diseñada para fase posterior | No se genera ningún hallazgo sin detector. |
| Conexión RTSP y alertas en vivo | Diseñada para fase posterior | La interfaz identifica archivos históricos. |
| 5.000 cámaras y despliegue de producción | Diseñado para fase posterior | Sin pruebas de escala ni alta disponibilidad. |

La calidad visual y la eficiencia frente a productos comerciales requieren pruebas de usabilidad, carga y precisión comparables. Esta versión no hace tal afirmación.

La modalidad nube limita cada MP4 a 50 MB y cinco minutos. Su procesamiento ocurre en memoria en el servicio web, por lo que requiere una cola durable para continuidad operativa.
