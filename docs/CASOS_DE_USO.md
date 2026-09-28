# VIGÍA · Casos de uso de analítica

Motor `analitica-v1` (src/js/analytics.js): determinista y explicable. Combina el detector de objetos local (COCO-SSD) con seguimiento multiobjeto (predicción de velocidad y asignación óptima), geometría de zonas y líneas, y análisis de píxeles (puertas, objeto abandonado, manipulación y humo). Cada evento guarda el motivo, los parámetros, el fotograma que lo respalda y el recuadro. Se revisa como cualquier hallazgo: sugerido → revisado → incidente confirmado.

## Estado frente al mercado

Referencias de mercado: escenarios de [AXIS Object Analytics](https://www.axis.com/products/axis-object-analytics/scenarios), [búsqueda con IA de Verkada](https://www.verkada.com/blog/ai-powered-search/) y [búsqueda por apariencia de Avigilon](https://docs.avigilon.com/bundle/unity-video-client-8-4/page/using/appearance-search.htm).

| Caso de uso | Estado en VIGÍA | Requiere | Equivalente en el mercado |
|---|---|---|---|
| Conteo de entradas/salidas por línea (personas o vehículos) | **Implementado y verificado** | IA + línea | Axis crossline counting, Verkada people counting |
| Ingreso en grupo (tailgating) | **Implementado y verificado** | IA + línea | Axis tailgating detection |
| Intrusión en zona restringida | **Implementado y verificado** | IA + zona restringida | Axis object in area |
| Merodeo / tiempo en zona | **Implementado y verificado** | IA + zona restringida | Axis time in area, Avigilon loitering |
| Vehículo mal estacionado | **Implementado y verificado** | IA + zona de no estacionar | Axis time in area (vehículos) |
| Aglomeración / ocupación máxima | **Implementado y verificado** | IA + zona de ocupación | Axis occupancy in area |
| Puerta abierta (mantenida) | **Implementado y verificado** | zona de puerta (sin IA) | Integraciones de control de acceso |
| Objeto abandonado / nuevo objeto estático | **Implementado y verificado** | — (mejor con IA) | Analíticas de objeto abandonado |
| Manipulación de cámara (cubierta, desenfocada, movida) | **Implementado y verificado** (cubierta) | — | Detección de manipulación (tampering) |
| Búsqueda por color de prenda | **Implementado** (verificación parcial) | IA | Avigilon Appearance Search, Verkada |
| Mapa de calor de ocupación | **Implementado** | IA | Mapas de calor Verkada/Axis |
| Posible humo | **Experimental** | — | Detección de humo por video especializada |
| Reglas en vivo con alerta interna (cualquiera de los anteriores) | **Implementado** | transmisión activa | Reglas de alarma de VMS |
| Reconocimiento facial | Fase posterior | base legal, evaluación de impacto | Verkada, Avigilon |
| Lectura de placas (LPR) | Fase posterior | OCR y cámaras dedicadas | Axis License Plate Verifier |
| EPP (casco/chaleco), caída, armas | Fase posterior | modelos especializados | Axis hard hat detection |
| Re-identificación entre cámaras | Fase posterior | embeddings de apariencia | Avigilon Appearance Search |
| Búsqueda en lenguaje natural del contenido visual | Fase posterior | modelos visión-lenguaje | Verkada AI-Powered Search |

## Cómo se configura

Administración → Cámaras → **analítica**, o Analítica y casos de uso → **Configurar zonas, líneas y puertas**:

- **Zona de ocupación / aforo**: cuenta cuántas personas hay dentro; genera un evento de aglomeración al llegar al umbral.
- **Zona restringida**: genera eventos de intrusión y de merodeo (tiempo máximo en la zona).
- **Zona de no estacionar**: genera un evento de vehículo mal estacionado (tiempo máximo).
- **Línea de conteo**: se dibuja de A a B; «invertir sentido» define qué lado es la entrada. Por defecto cuenta personas.
- **Puerta**: rectángulo sobre la hoja de la puerta cerrada; se detecta como abierta cuando cambia más del 50 % de su área.
- **Parámetros**: segundos de merodeo, de estacionamiento, de puerta y de abandono; personas para aglomeración; ventana del ingreso en grupo.

Al guardar, la aplicación ofrece reanalizar las grabaciones de esa cámara. En vivo (cámara web o emulación), el motor corre en cada cuadro y las reglas del chat alertan en el momento, por ejemplo «avísame si la puerta queda abierta en la cámara 2 durante 60 minutos».

## Preguntas en el chat

- «¿Cuántas personas han ingresado al salón hoy?» · «¿Cuántos vehículos salieron por la cámara 2?»
- «Vehículos mal parqueados» · «¿La puerta quedó abierta?» · «¿Hubo humo en alguna cámara?»
- «Persona con camisa roja y pantalón negro» · «Persona vestida de naranja»
- «Merodeo en la zona restringida» · «Objetos abandonados» · «¿Alguien tapó la cámara?»
- «¿Entraron en grupo al salón?» · «Aglomeraciones en el salón»

Cuando la cámara no tiene la configuración o el análisis necesario, el chat lo dice («la cámara no tiene zona de tipo no parqueo», «requiere el detector IA») en lugar de responder sin evidencia.

## Verificación

Video sintético `tools/gen_casos.py` (4 min 26 s), con guion de eventos conocido. Las personas son fotografías de dominio público (astronauta de la NASA y Grace Hopper) y el vehículo es una motocicleta del conjunto de scikit-image.

| Evento del guion | Esperado | Obtenido (IA real, `tests/e2e_casos.mjs`) |
|---|---|---|
| Ingresos / salidas por la línea de acceso | 4 / 1 | **4 / 1** (00:18 e, 00:40 e, 01:39 s, 01:56 e, 01:59 e) |
| Ingreso en grupo 01:50–02:06 | 1 | **1** (01:56–01:59) |
| Intrusión + merodeo 00:42–01:20 | 1 + 1 | **1 + 1** (merodeo de 40 s) |
| Aglomeración (umbral 2) | 1 | **1** |
| Moto en zona de no estacionar 02:15–03:00 | 1 | **1** (02:13–03:02) |
| Puerta abierta 02:30–03:06 | 1 | **1** (02:30–03:06, 71 % de cambio) |
| Humo 03:12–03:55 | 1 (experimental) | **1** (03:18–03:56) |
| Caja abandonada 03:58–04:19 | 1 | **1**, sin falsos positivos por la moto estacionada, la puerta, el humo ni la persona quieta |
| Cámara cubierta 04:19 | 1 | **1** (cubierta u oscurecida) |

También hay una prueba unitaria determinista del motor dentro de la suite de la app (Administración → Pruebas).

**Límites honestos:**
- La precisión en cámaras reales **no se ha medido**. Iluminación nocturna/IR, ángulos cenitales, oclusiones y multitudes densas reducen el rendimiento de COCO-SSD y del seguimiento a 1 cuadro por segundo.
- El color de prenda en el video sintético se calcula sobre retratos, no sobre cuerpos completos. En cámaras reales debe validarse por escenario.
- El humo es una heurística: no reemplaza detectores certificados (NFPA/NTC).
- El muestreo a 1 cuadro por segundo puede perder cruces muy rápidos (personas corriendo cerca de la cámara).
