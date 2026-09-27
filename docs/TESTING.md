# VIGÍA · Pruebas

Todas las pruebas se ejecutaron el 26/09/2026 sobre el código entregado. Resultados completos en `codigo-fuente/tests/resultado_*.txt` y capturas en `codigo-fuente/tests/capturas/`.

## Comandos

```bash
cd codigo-fuente
npm install                          # mp4box, jspdf, playwright, tfjs, coco-ssd
npm run build                        # genera app/VIGIA.html
node tests/node_nlp.test.cjs         # intérprete en español (Node)
node tests/node_mp4cut.test.cjs      # corte MP4 sin recodificar, validado con ffprobe/ffmpeg
node tests/run_suite.mjs [--ia]      # suite interna en Chromium sin interfaz (file://)
node tests/e2e.mjs                   # recorrido completo a través de la interfaz
node tests/webcam.mjs                # adaptador de cámara web con dispositivo simulado
```

El video de prueba `tests/muestra_cam01_vp9.mp4` se usa en Chromium automatizado porque ese binario no incluye H.264; la muestra H.264 que se entrega al usuario se reproduce en Chrome/Edge/Safari normales.

## Resultados

| Batería | Resultado | Duración |
|---|---|---|
| Intérprete de prompts (Node) | **21/21** correctas | < 1 s |
| Corte MP4 (Node + ffprobe) | **14/14** (H.264/AAC y VP9/Opus: duración, 2 pistas, decodificación sin errores, primer fotograma idéntico al original) | 2 s |
| Suite interna en navegador | **16/16** correctas (incluida IA) | 213 s (IA en WebGL por software) |
| Recorrido por interfaz (e2e) | **21/21** comprobaciones | ≈ 2 min |
| Cámara web simulada | primer cuadro 1,19 s · edad 0,6 s · búfer 12 s · clip de contexto 705 KB | 13 s |

### Suite interna (qué se comprueba)

1. SHA-256: vectores conocidos, cálculo incremental = WebCrypto.
2. Autenticación: 8 usuarios, contraseñas aleatorias, credenciales incorrectas rechazadas, selección de organización.
3. Carga: hash del original, verificación del almacenado, 201 miniaturas, duplicado → CONFLICTO, archivo falso → FORMATO, hora del contenedor detectada.
4. Fotograma auténtico: 640×360 nativo, PNG, referencia al original, hash.
5. Clip: intervalo solicitado 60–90 s → real 60,000–90,000 s, referencia, hash, duración del MP4 resultante.
6. Ventanas: «últimos 5 min disponibles» = final del archivo con cobertura incompleta; decisión reloj/posición; conversión reloj→posición.
7. Búsqueda limitada a cámara y periodo; otra cámara sin resultados ni cobertura.
8. Chat: fotogramas (histórico, no vivo), búsqueda sin IA (declara que no distingue, 0 inventados), clip del hallazgo, expediente, indicadores, seguimiento.
9. Honestidad: cámara sin transmisión, cámara inexistente, ventana sin detecciones → «Sin evidencia», falta de cámara → aclaración.
10. Informe HTML con hash del original, del clip y del fotograma, lagunas, método y advertencia legal; PDF válido.
11. **Aislamiento**: la organización Sur no puede listar ni leer cámaras, grabaciones, miniaturas, originales, clips, hallazgos, búsquedas, chats, mensajes, expedientes, trabajos, reglas ni indicadores de Norte; tampoco añadir evidencia ajena ni agrupar cámaras ajenas; consultor en Sur no ve Norte.
12. Permisos: operador no descarga originales ni confirma incidentes ni gestiona cámaras; directivo no ve medios; supervisor confirma; descargas auditadas.
13. Retención: evidencia en expediente protegido no se puede borrar.
14. Auditoría: cadena íntegra; alteración de un registro detectada.
15. Inyección: texto con órdenes no produce organización/rol ni filtra identificadores.
16. IA local: persona detectada en **00:01:26–00:01:46 (88%)**, evento real 01:20–01:50; **0** personas en 0–60 s.

## Qué NO se verificó

- Precisión del detector en cámaras reales (sólo video sintético con una fotografía real).
- Decodificación H.264 en el Chromium automatizado (no la incluye); verificado el corte H.264 con ffprobe y la carga/hash de la muestra embebida.
- Cámara web física (se usó el dispositivo simulado de Chromium).
- Firefox y Safari (diseñados para funcionar; no automatizados aquí).
- Volúmenes grandes (> 1 h de video, miles de archivos), cupo de almacenamiento del navegador.
- RTSP, servidor, escala a 5.000 cámaras: no implementados en esta fase.

## Prueba manual guiada (5 minutos)

1. Abrir `VIGIA.html` en Chrome → **Crear entorno de demostración** → descargar credenciales → entrar como `admin@norte.demo`.
2. Centro de operaciones → **Cargar video de demostración** → marcar «Analizar con motor IA» → Importar. Esperar «completado».
3. Chat: `encuentra personas o vehículos entre 00:01:00 y 00:03:00` → debe aparecer una **persona** alrededor de 14:01:26 con recuadro.
4. En la tarjeta: **extraer clip** → reproducir → **verificar hash** → **descargar**.
5. `abre un caso "Prueba" con este hallazgo` → abrir → añadir hipótesis → **Informe PDF**.
6. Centro de operaciones → **Emular en vivo** → Chat: `¿qué sucede ahora en la cámara 1?` (tarjeta con edad del cuadro y etiqueta EMULACIÓN).
7. Cerrar sesión → entrar como `admin@sur.demo` → no debe verse nada de Norte.
8. Administración → **Pruebas automáticas** → Ejecutar (usa base de datos temporal).
