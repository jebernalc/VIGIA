# VIGÍA · Supabase

Proyecto: `vigia` (ref `vxolklytmkenflxevlwq`, región sa-east-1 São Paulo).

- URL: `https://vxolklytmkenflxevlwq.supabase.co`
- Clave **publicable** (segura en el navegador; el acceso lo controla RLS): en `app/vigia.config.js`.
- **Nunca** publique la clave secreta (`sb_secret_…` / `service_role`).

## Migraciones aplicadas

1. `0001_vigia_nube.sql` — organizaciones, miembros con rol, cámaras, grabaciones (metadatos + SHA-256), hallazgos, derivados, expedientes, evidencias, auditoría (sólo inserción) y registro de sincronizaciones. RLS por organización en todas las tablas; sin borrado desde la API.
2. `0002_vigia_funciones_privadas.sql` — funciones auxiliares de RLS movidas a un esquema no expuesto.
3. `0003_vigia_analitica.sql` — eventos de analítica (columnas en `vigia_hallazgos`), `vigia_conteos` (cruces por línea), `vigia_analisis` (ocupación, puertas, mapa de calor), catálogo `vigia_casos_uso` (18 casos: implementados, experimentales y en fase posterior) y vistas `vigia_v_eventos_por_tipo`, `vigia_v_cruces` y `vigia_v_conteo_por_hora` (con `security_invoker`, respetan RLS). Verificado: la organización B ve 0 cruces, conteos y eventos de A.

Verificado con SQL impersonando dos usuarios: el segundo ve 0 filas de la organización del primero, no puede modificarlas y la inserción cruzada es rechazada por RLS.

## Qué se sincroniza

Metadatos y cadena de custodia desde la edición local (Administración → Nube). Los videos, miniaturas y clips **no se suben**.

## Configuración pendiente en el panel de Supabase (recomendada)

- Authentication → Password security → activar **Leaked password protection** (aviso del analizador de seguridad).

Authentication → URL Configuration → **Site URL** = `https://jebernalc2036-ai.github.io/vigia/` y agregar la misma URL en *Redirect URLs*, para que los enlaces de confirmación de correo de cuentas nuevas lleven a la aplicación publicada.
