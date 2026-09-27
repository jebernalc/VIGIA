-- Las funciones auxiliares de RLS no deben ser invocables por la Data API: se mueven a un esquema no expuesto.
create schema if not exists vigia_priv;
revoke all on schema vigia_priv from public, anon;
grant usage on schema vigia_priv to authenticated;
alter function public.vigia_rol_en(uuid) set schema vigia_priv;
alter function public.vigia_es_miembro(uuid) set schema vigia_priv;
alter function public.vigia_puede_escribir(uuid) set schema vigia_priv;
alter function vigia_priv.vigia_puede_escribir(uuid) set search_path = public, vigia_priv;
alter function public.vigia_agregar_miembro(uuid, text, text) set search_path = public, auth, vigia_priv;
alter function public.vigia_crear_organizacion(text) set search_path = public, vigia_priv;
