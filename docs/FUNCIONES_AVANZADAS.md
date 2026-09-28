# VIGÍA · Funciones avanzadas (v1.1) y comparación con el mercado

Esta versión incorpora las funciones que diferencian a las plataformas líderes de videovigilancia empresarial (VMS/PSIM y analítica forense). Cada una está implementada, conectada a la API con permisos y aislamiento por organización, auditada y cubierta por pruebas automáticas. Donde hay límites, se declaran.

| Función | Referencia de mercado | Qué hace en VIGÍA | Verificación |
|---|---|---|---|
| **Sinopsis de video** | BriefCam Video Synopsis | Condensa horas de actividad: muestra a la vez objetos de distintos momentos sobre un fondo calculado por mediana, cada uno con su **hora real**. Filtros por clase y color de prenda. Clic en un objeto → abre el momento original. Exporta imagen estroboscópica (PNG) o video (WebM) como **derivado sintético con hash**. | Prueba de planificación (300 s → 20 s) y recorrido con IA real (2:49 → 1:33, 6 objetos) |
| **Búsqueda por apariencia** | Avigilon Appearance Search, Verkada People Search | Firma de 30 valores (histograma HSV de torso y piernas, sin píxeles de piel) por persona seguida; búsqueda en todas las cámaras con umbral ajustable (coeficiente de Bhattacharyya). **No es reconocimiento facial ni biometría.** | Unitaria (misma ropa > 90 %, distinta < 50 %) y con IA real: la misma persona en 3 pistas distintas → 100 % |
| **Central de alarmas** | Genetec Security Center, Milestone XProtect Alarm Manager | Cola priorizada (crítica/alta/media/baja), **SLA de reconocimiento** con cuenta regresiva, **procedimiento (SOP)** paso a paso por tipo, asignación, notas, cierre con resolución (real, falsa, prueba, duplicada) e historial. Indicadores **MTTA, MTTR, cumplimiento de SLA y tasa de falsas alarmas**. Cualquier hallazgo se puede **escalar** a la central. | Prueba de API (permisos, aislamiento, conflictos, métricas, auditoría) y recorrido por interfaz |
| **Plano del sitio** | Genetec Plan Manager, Milestone Smart Map | Plano de la sede (imagen propia) con cámaras ubicadas por arrastre, **orientación y campo de visión**; color por estado: en vivo, sin señal, alarma abierta (parpadea si es crítica/alta). Acceso directo a operaciones, alarmas y analítica de cada cámara. | Prueba de permisos y aislamiento; recorrido por interfaz |
| **Redacción de privacidad** | Axis Live Privacy Shield, Genetec KiwiVision Privacy Protector | Genera una **versión del clip con personas pixeladas** (cuerpo completo o sólo cabeza) a partir de las detecciones IA; la original no se toca y la nueva queda con su propio hash, origen y transformación. En el paquete de evidencia, las imágenes se pixelan y los videos sin redactar se omiten. | Recorrido por interfaz; prueba del paquete en modo privacidad |
| **Paquete de evidencia verificable** | Genetec Clearance, Axon Evidence | ZIP con binarios, `manifiesto.json` (origen, intervalo, método, transformaciones, hash registrado vs. calculado), `SHA256SUMS.txt` verificable con `sha256sum -c`, cadena de custodia en CSV, auditoría encadenada e informe HTML. El hash del ZIP queda en la auditoría. | Todos los SHA-256 del paquete verificados **fuera del navegador** con Python |
| **Horarios de vigilancia** | Programación de eventos en VMS | Reglas y zonas con días y franja horaria (admite cruzar medianoche) en la zona horaria de la cámara. Desde el chat: «avísame si hay intrusión en la cámara 2 de 22:00 a 06:00 de lunes a viernes». | Prueba de horarios y 2 pruebas del intérprete |

## Revisión de rigor aplicada al código existente

Una revisión independiente de todo el código encontró 18 defectos reales, que quedaron corregidos:

- **Alta**:
  - las reglas de analítica en vivo no se disparaban (firma de la retrollamada);
  - un WebM sin duración podía generar un trabajo infinito;
  - una sesión de nube podía sobrevivir al cierre de sesión local y la sincronización no exigía rol de administrador;
  - `saveDerivative` permitía al llamador sobrescribir organización, hash y autor;
  - el reanálisis con IA duplicaba detecciones (y conteos).
- **Media**:
  - borrar una grabación durante su indexación la «resucitaba»;
  - un operador podía revertir aprobaciones y confirmaciones;
  - la verificación de auditoría podía dar falso «roto» con registros del mismo milisegundo (ahora recorre la cadena por enlaces y detecta registros eliminados al final);
  - cola de trabajos que podía quedar detenida;
  - la cámara quedaba encendida si fallaba el arranque en vivo;
  - había ticks en vivo solapados y la memoria crecía sin límite en sesiones largas.
- **Baja**:
  - faltaban controles de rol en lecturas de reglas, alertas y trabajos;
  - había fugas de URL de objeto y de oyentes de eventos;
  - la recodificación de respaldo podía colgarse en pestañas ocultas;
  - el audio de los clips se adelantaba unos 70 ms con fotogramas B;
  - el inicio de la manipulación de cámara estaba mal calculado con muestreo de 2 s;
  - se aceptaba un `offset` negativo.
- **Análisis estático**: ESLint 9 sin errores ni advertencias (`npm run lint`).

## Límites honestos

- La sinopsis, la búsqueda por apariencia y la privacidad dependen del **motor IA** (personas y vehículos con seguimiento, muestreo 1 s). Sin IA se ofrecen mensajes claros, no resultados inventados.
- La apariencia describe **ropa**: dos personas vestidas igual coinciden; la iluminación y el ángulo la afectan. Siempre se pide verificación visual.
- La redacción usa detecciones cada 1 s con margen de ±1 s: en movimientos muy rápidos o personas no detectadas puede quedar algo sin pixelar. Revise antes de publicar.
- La sinopsis es un **derivado sintético** para revisión rápida; nunca sustituye a la evidencia original (así se etiqueta).
