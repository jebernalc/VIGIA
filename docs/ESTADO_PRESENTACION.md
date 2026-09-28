# VIGÍA · ¿Listos para la alta dirección?

## Veredicto

**Sí para una demostración funcional; todavía no para un piloto operativo.** Hoy se puede mostrar en vivo, en un navegador, cada caso de uso que pidió la dirección, con evidencia trazable y sin datos inventados. Lo que falta para operar con las cámaras reales está identificado y es alcanzable: el agente RTSP de borde y la validación de precisión con video propio.

| Pedido de la dirección | Qué se puede mostrar hoy |
|---|---|
| Contar cuántas personas han ingresado a un salón en un grupo de cámaras | Conteo por línea virtual con sentido: 4 ingresos y 1 salida en la demostración, exactamente el guion. Preguntando en el chat o en el tablero. |
| Vehículo mal estacionado | Evento con duración y fotograma; clip de 30 s listo para el expediente. |
| Persona con características específicas por una cámara | Búsqueda por color de prenda superior e inferior («camisa roja, pantalón negro»). |
| Puerta abierta | Evento de apertura y duración; alerta en vivo configurable. |
| Detección de humo | Disponible como **experimental**, con advertencia visible. |
| Funciones de plataformas líderes (BriefCam, Avigilon, Genetec, Milestone) | **Sinopsis de video**, **búsqueda por apariencia** entre cámaras, **central de alarmas** con SOP y SLA, **plano del sitio**, **privacidad** (pixelado de personas) y **paquete de evidencia verificable**. Ver `FUNCIONES_AVANZADAS.md`. |
| «Tantos casos de uso de un sistema a gran escala» | 12 casos activos: intrusión, merodeo, aglomeración, ingreso en grupo, objeto abandonado, manipulación de cámara, mapa de calor, etc. Además, 6 casos del mercado presentados con su motivo de fase posterior. |

## Guion sugerido (20 minutos)

1. **Problema (1 min).** Horas de video que nadie revisa; los incidentes se reconstruyen tarde y sin cadena de custodia.
2. **Tablero de casos de uso (3 min).** Analítica y casos de uso: 12 casos activos, resultados de la cámara de salón (ingresos, salidas, ocupación máxima, eventos por tipo, mapa de calor, línea de tiempo).
3. **Preguntas en lenguaje natural (5 min).** En el chat:
   - «¿Cuántas personas han ingresado al salón?»
   - «Vehículos mal parqueados» → ver el clip
   - «Persona vestida de naranja»
   - «¿La puerta quedó abierta?»
   - «¿Hubo humo en alguna cámara?»
4. **Funciones de nivel empresarial (4 min).** «Sinopsis del salón» → 3 minutos de actividad en un vistazo, clic en una persona para ir al original. «Parecidos» en una persona → aparece en todas sus pasadas. «Escalar» → Central de alarmas: SLA en cuenta regresiva, procedimiento paso a paso, cierre con MTTA y cumplimiento de SLA. Plano del sitio con el estado de cada cámara.
5. **Del hallazgo al expediente (3 min).** Extraer clip sin recodificar, abrir caso, añadir hipótesis, informe PDF con hashes y limitaciones.
6. **En vivo (2 min).** Emular en vivo, crear la regla «avísame si la puerta queda abierta» y mostrar la alerta.
7. **Gobierno y seguridad (1 min).** Paquete de evidencia ZIP con SHA256SUMS verificable fuera de la plataforma; versión con privacidad para compartir. Roles, auditoría encadenada, aislamiento por organización (local y en Supabase con RLS), y la decisión explícita de no activar reconocimiento facial.

## Qué decir con honestidad (y cómo)

- «La demostración usa un video sintético con eventos conocidos para probar que cada caso funciona y que no inventa resultados. El siguiente paso es medir la precisión con nuestras cámaras.»
- «El humo es experimental: sirve como alerta temprana, no reemplaza los detectores del edificio.»
- «Los videos no salen del equipo; en la nube sólo viajan metadatos y la cadena de custodia.»

## Para pasar a piloto (propuesta de 4–6 semanas)

1. **Agente de borde RTSP/ONVIF** (Node o Python) en un equipo del sitio, que alimente a VIGÍA con 4–8 cámaras reales.
2. **Validación de precisión** con 20–40 horas de video propio etiquetado por escenario (día/noche, acceso, parqueadero), reportando aciertos, falsos avisos y omisiones por caso de uso.
3. **Calibración por cámara** de zonas, líneas, puertas y umbrales, con zonas de exclusión.
4. **Despliegue web** en GitHub Pages o en el dominio institucional, con el Site URL configurado en Supabase.
5. **Tablero directivo** alimentado por las vistas de Supabase (`vigia_v_conteo_por_hora`, `vigia_v_eventos_por_tipo`).

## Riesgos a mencionar

- Precisión variable según cámara, lente e iluminación; se mitiga con la validación del piloto y umbrales por cámara.
- Procesamiento en el navegador: adecuado para decenas de cámaras por puesto; la escala a cientos o miles requiere el servidor descrito en `ARCHITECTURE.md`.
- Tratamiento de datos personales (Ley 1581 de 2012): avisos de videovigilancia, retención y finalidad definidas antes del piloto.
