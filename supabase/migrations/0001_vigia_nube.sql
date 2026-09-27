-- VIGÍA · esquema en la nube (Supabase / PostgreSQL) — v1
-- Guarda METADATOS y cadena de custodia sincronizados desde la edición local.
-- Los videos originales NO se suben: permanecen en el equipo que los importó.
-- Aislamiento: Row Level Security por organización en TODAS las tablas.

-- Se usa el esquema public (expuesto por la Data API) con prefijo vigia_.

-- ---------- organizaciones y membresías ----------
create table vigia_organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 2 and 120),
  creado_en timestamptz not null default now(),
  creado_por uuid not null default auth.uid() references auth.users(id)
);

create table vigia_miembros (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('operador','supervisor','investigador','admin','directivo')),
  creado_en timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- funciones auxiliares (security definer para evitar recursión en RLS)
create or replace function vigia_rol_en(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from vigia_miembros where org_id = p_org and user_id = auth.uid()
$$;
create or replace function vigia_es_miembro(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vigia_miembros where org_id = p_org and user_id = auth.uid())
$$;
create or replace function vigia_puede_escribir(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(vigia_rol_en(p_org) in ('operador','supervisor','investigador','admin'), false)
$$;

-- crea una organización y agrega al usuario actual como administrador
create or replace function vigia_crear_organizacion(p_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  insert into vigia_organizaciones(nombre, creado_por) values (p_nombre, auth.uid()) returning id into v_id;
  insert into vigia_miembros(org_id, user_id, rol) values (v_id, auth.uid(), 'admin');
  return v_id;
end $$;

-- el administrador agrega miembros existentes por correo
create or replace function vigia_agregar_miembro(p_org uuid, p_email text, p_rol text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid;
begin
  if vigia_rol_en(p_org) is distinct from 'admin' then raise exception 'sólo el administrador puede agregar miembros'; end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'el usuario debe registrarse primero'; end if;
  insert into vigia_miembros(org_id, user_id, rol) values (p_org, v_user, p_rol)
  on conflict (org_id, user_id) do update set rol = excluded.rol;
end $$;

-- ---------- datos sincronizados (id = identificador estable de la edición local) ----------
create table vigia_camaras (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, numero int, codigo text, nombre text not null, tipo text, tz text, ubicacion text, sede text, zona text,
  actualizado_en timestamptz not null default now(), primary key (org_id, id));

create table vigia_grabaciones (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, camara_id text, nombre_archivo text, bytes bigint, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duracion_s double precision, codec text, ancho int, alto int, hora_inicio timestamptz, hora_inicio_fuente text,
  subido_por text, importado_en timestamptz, motores text[], indexado boolean,
  actualizado_en timestamptz not null default now(), primary key (org_id, id));

create table vigia_hallazgos (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, grabacion_id text, camara_id text, clase text, etiqueta text, inicio_s double precision, fin_s double precision,
  t_abs timestamptz, score double precision, motor text, estado text check (estado in ('sugerido','revisado','descartado','confirmado')),
  revisado_por text, actualizado_en timestamptz not null default now(), primary key (org_id, id));

create table vigia_derivados (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, tipo text, grabacion_id text, camara_id text, nombre text, sha256 text, origen_sha256 text,
  inicio_s double precision, fin_s double precision, metodo text, transformacion text, creado_por text, creado_en timestamptz,
  actualizado_en timestamptz not null default now(), primary key (org_id, id));

create table vigia_expedientes (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, codigo text, titulo text, descripcion text, prioridad text, estado text, aprobacion text,
  creado_por text, creado_en timestamptz, actualizado_en timestamptz not null default now(), primary key (org_id, id));

create table vigia_evidencias (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, expediente_id text, tipo text, ref_id text, clasificacion text, nota text, agregado_por text, en timestamptz,
  actualizado_en timestamptz not null default now(), primary key (org_id, id));

create table vigia_auditoria (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, usuario text, accion text, recurso text, recurso_id text, detalle jsonb, ts timestamptz, prev text, hash text,
  primary key (org_id, id));

create table vigia_sincronizaciones (
  id bigint generated always as identity primary key,
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  user_id uuid not null default auth.uid(), en timestamptz not null default now(), resumen jsonb);

-- ---------- RLS ----------
alter table vigia_organizaciones enable row level security;
alter table vigia_miembros enable row level security;
create policy org_ver on vigia_organizaciones for select using (vigia_es_miembro(id));
create policy org_editar on vigia_organizaciones for update using (vigia_rol_en(id) = 'admin') with check (vigia_rol_en(id) = 'admin');
create policy miem_ver on vigia_miembros for select using (vigia_es_miembro(org_id));

do $$
declare t text;
begin
  foreach t in array array['vigia_camaras','vigia_grabaciones','vigia_hallazgos','vigia_derivados','vigia_expedientes','vigia_evidencias','vigia_sincronizaciones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (vigia_es_miembro(org_id))', t || '_ver', t);
    execute format('create policy %I on public.%I for insert with check (vigia_puede_escribir(org_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update using (vigia_puede_escribir(org_id)) with check (vigia_puede_escribir(org_id))', t || '_upd', t);
  end loop;
end $$;
-- auditoría: sólo inserción (nunca actualización ni borrado) y lectura para supervisor/admin
alter table vigia_auditoria enable row level security;
create policy auditoria_ver on vigia_auditoria for select using (vigia_rol_en(org_id) in ('supervisor','admin'));
create policy auditoria_ins on vigia_auditoria for insert with check (vigia_es_miembro(org_id));

-- ---------- permisos de la API ----------
grant select, insert, update on vigia_organizaciones, vigia_miembros, vigia_camaras, vigia_grabaciones, vigia_hallazgos, vigia_derivados, vigia_expedientes, vigia_evidencias, vigia_sincronizaciones to authenticated;
grant select, insert on vigia_auditoria to authenticated;
revoke insert, update on vigia_organizaciones from authenticated;
revoke insert, update, delete on vigia_miembros from authenticated;
grant update (nombre) on vigia_organizaciones to authenticated;
grant execute on function vigia_crear_organizacion(text), vigia_agregar_miembro(uuid, text, text), vigia_rol_en(uuid), vigia_es_miembro(uuid), vigia_puede_escribir(uuid) to authenticated;
revoke all on vigia_organizaciones, vigia_miembros, vigia_camaras, vigia_grabaciones, vigia_hallazgos, vigia_derivados, vigia_expedientes, vigia_evidencias, vigia_sincronizaciones, vigia_auditoria from anon;
revoke execute on function vigia_crear_organizacion(text), vigia_agregar_miembro(uuid, text, text), vigia_rol_en(uuid), vigia_es_miembro(uuid), vigia_puede_escribir(uuid) from anon, public;
-- sin borrado desde la API (la retención se gestiona fuera del cliente); la auditoría es de sólo inserción
revoke delete, truncate, references, trigger on vigia_organizaciones, vigia_miembros, vigia_camaras, vigia_grabaciones, vigia_hallazgos, vigia_derivados, vigia_expedientes, vigia_evidencias, vigia_sincronizaciones, vigia_auditoria from authenticated;
revoke update on vigia_auditoria from authenticated;
