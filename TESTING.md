# Verificación

Ejecutar `cd vigia && python -m pytest tests -q`. El test crea un video `testsrc` con FFmpeg y comprueba carga, hash original, trabajo asíncrono, JPEG auténtico, respuesta honesta ante búsqueda de personas, clip y hash, informe con fuente y aislamiento de cámaras, grabaciones, fotogramas, clips, casos e informe entre dos organizaciones. Comprueba también que cerrar sesión revoca el token.

Prueba manual pendiente: iniciar el servidor; abrir `/`; ingresar; crear cámara; importar MP4; esperar estado «Listo para consultar»; abrir chat; consultar fotogramas desde acceso rápido e intervalo personalizado; seleccionar uno; extraer y descargar clip; abrir expediente; imprimir informe en PDF; revisar indicadores; cerrar sesión. Se validó la sintaxis del JavaScript con `node --check`. No se ha validado escala, navegadores móviles ni detector.
