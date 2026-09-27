# VIGÍA · Supabase

Proyecto: `vigia` (ref `vxolklytmkenflxevlwq`, región sa-east-1 São Paulo).

- URL: `https://vxolklytmkenflxevlwq.supabase.co`
- Clave **publicable** (segura en el navegador; el acceso lo controla RLS): en `app/vigia.config.js`.
- **Nunca** publique la clave secreta (`sb_secret_…` / `service_role`).

## Migraciones aplicadas

1. `0001_vigia_nube.sql` — organizaciones, miembros con rol, cámaras, grabaciones (metadatos + SHA-256), hallazgos, derivados, expedientes, evidencias, auditoría (sólo inserción) y registro de sincronizaciones. RLS por organización en todas las tablas; sin borrado desde la API.
2. `0002_vigia_funciones_privadas.sql` — funciones auxiliares de RLS movidas a un esquema no expuesto.

Verificado con SQL impersonando dos usuarios: el segundo ve 0 filas de la organización del primero, no puede modificarlas y la inserción cruzada es rechazada por RLS.

## Qué se sincroniza

Metadatos y cadena de custodia desde la edición local (Administración → Nube). Los videos, miniaturas y clips **no se suben**.

## Configuración pendiente en el panel de Supabase (recomendada)

Authentication → URL Configuration → **Site URL** = `https://jebernalc2036-ai.github.io/vigia/` y agregar la misma URL en *Redirect URLs*, para que los enlaces de confirmación de correo de cuentas nuevas lleven a la aplicación publicada.
