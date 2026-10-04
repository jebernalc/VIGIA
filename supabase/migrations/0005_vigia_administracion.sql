-- VIGÍA · administración de acceso — v5
-- Inicio de sesión con cuentas reales (Supabase Auth) y control desde la propia aplicación de:
--   · roles por usuario            · licencia por usuario (activa / suspendida / fecha de vencimiento)
--   · permisos individuales        · licencia de la organización (plan, cupos, vencimiento)
--   · clave temporal con cambio obligatorio · registro de eventos de administración
-- Todo pasa por funciones SECURITY DEFINER que comprueban el rol del llamador; nunca se expone auth.users.

create extension if not exists pgcrypto with schema extensions;

-- 1) columnas de licencia y permisos
alter table public.vigia_miembros
  add column if not exists activo boolean not null default true,
  add column if not exists licencia_vence date,
  add column if not exists permisos jsonb not null default '{}'::jsonb,
  add column if not exists nombre text;
alter table public.vigia_organizaciones
  add column if not exists plan text not null default 'prueba',
  add column if not exists max_usuarios int not null default 5,
  add column if not exists max_camaras int not null default 8,
  add column if not exists licencia_vence date default (current_date + 30),
  add column if not exists licencia_estado text not null default 'activa',
  add column if not exists sede_inicial text;
alter table public.vigia_organizaciones drop constraint if exists vigia_org_plan_chk;
alter table public.vigia_organizaciones add constraint vigia_org_plan_chk check (plan in ('prueba','profesional','empresarial') and licencia_estado in ('activa','suspendida') and max_usuarios between 1 and 100000 and max_camaras between 1 and 100000);

-- 2) administradores de la plataforma (gestionan la licencia de cualquier organización). Sin políticas: sólo vía funciones.
create table if not exists public.vigia_plataforma_admins (email text primary key check (email = lower(email)), agregado_en timestamptz not null default now());
alter table public.vigia_plataforma_admins enable row level security;
revoke all on public.vigia_plataforma_admins from anon, authenticated;

-- 3) eventos de administración (quién cambió qué)
create table if not exists public.vigia_admin_eventos (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.vigia_organizaciones(id) on delete cascade,
  actor uuid, actor_email text, accion text not null, detalle jsonb not null default '{}'::jsonb, en timestamptz not null default now());
create index if not exists vigia_admin_eventos_org_idx on public.vigia_admin_eventos (org_id, en desc);
alter table public.vigia_admin_eventos enable row level security;
-- 4) funciones privadas
create or replace function vigia_priv.vigia_es_plataforma() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vigia_plataforma_admins a join auth.users u on lower(u.email) = a.email where u.id = (select auth.uid()))
$$;
-- licencia vigente: organización activa y no vencida + miembro activo y no vencido
create or replace function vigia_priv.vigia_licencia_ok(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.vigia_miembros m join public.vigia_organizaciones o on o.id = m.org_id
     where m.org_id = p_org and m.user_id = (select auth.uid()) and m.activo
       and (m.licencia_vence is null or m.licencia_vence >= current_date)
       and o.licencia_estado = 'activa' and (o.licencia_vence is null or o.licencia_vence >= current_date))
$$;
-- el rol sólo cuenta con licencia vigente (así RLS deja de dar acceso a un usuario suspendido o vencido)
create or replace function vigia_priv.vigia_rol_en(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.rol from public.vigia_miembros m where m.org_id = p_org and m.user_id = (select auth.uid()) and vigia_priv.vigia_licencia_ok(p_org)
$$;
create or replace function vigia_priv.vigia_es_miembro(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select vigia_priv.vigia_licencia_ok(p_org)
$$;
create or replace function vigia_priv.vigia_puede_escribir(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(vigia_priv.vigia_rol_en(p_org) in ('operador','supervisor','investigador','admin'), false)
$$;
-- administrador de la organización (aunque la licencia de la organización esté vencida puede entrar a ver su estado)
create or replace function vigia_priv.vigia_es_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vigia_miembros m where m.org_id = p_org and m.user_id = (select auth.uid()) and m.rol = 'admin' and m.activo and (m.licencia_vence is null or m.licencia_vence >= current_date))
$$;
create or replace function vigia_priv.vigia_evento(p_org uuid, p_accion text, p_detalle jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.vigia_admin_eventos(org_id, actor, actor_email, accion, detalle)
  values (p_org, (select auth.uid()), (select u.email::text from auth.users u where u.id = (select auth.uid())), p_accion, coalesce(p_detalle, '{}'::jsonb))
$$;
revoke all on function vigia_priv.vigia_es_plataforma(), vigia_priv.vigia_licencia_ok(uuid), vigia_priv.vigia_es_admin(uuid), vigia_priv.vigia_evento(uuid, text, jsonb) from public, anon;
grant execute on function vigia_priv.vigia_es_plataforma(), vigia_priv.vigia_licencia_ok(uuid), vigia_priv.vigia_es_admin(uuid) to authenticated;

drop policy if exists vigia_admin_eventos_ver on public.vigia_admin_eventos;
create policy vigia_admin_eventos_ver on public.vigia_admin_eventos for select to authenticated using ((select vigia_priv.vigia_es_admin(org_id)));
revoke all on public.vigia_admin_eventos from anon, authenticated;
grant select on public.vigia_admin_eventos to authenticated;

-- 5) registro del propietario: crea la organización y lo deja como administrador
create or replace function public.vigia_registrar_propietario(p_org text, p_sede text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Inicia sesión para registrar la organización'; end if;
  if char_length(trim(coalesce(p_org, ''))) < 2 then raise exception 'Escribe el nombre de la organización'; end if;
  if exists (select 1 from public.vigia_organizaciones where creado_por = v_uid) then raise exception 'Esta cuenta ya es propietaria de una organización'; end if;
  insert into public.vigia_organizaciones(nombre, creado_por, sede_inicial) values (trim(p_org), v_uid, nullif(trim(coalesce(p_sede, '')), '')) returning id into v_id;
  insert into public.vigia_miembros(org_id, user_id, rol) values (v_id, v_uid, 'admin');
  perform vigia_priv.vigia_evento(v_id, 'organizacion.registrar', jsonb_build_object('nombre', trim(p_org)));
  return v_id;
end $$;

-- 6) mi acceso: organizaciones, rol, licencia y permisos del usuario actual
create or replace function public.vigia_mi_acceso()
returns table (org_id uuid, org_nombre text, sede_inicial text, rol text, activo boolean, licencia_vence date, permisos jsonb, nombre text,
               plan text, max_usuarios int, max_camaras int, org_vence date, org_estado text, usuarios int, propietario boolean, es_plataforma boolean, debe_cambiar_clave boolean)
language sql stable security definer set search_path = '' as $$
  select o.id, o.nombre, o.sede_inicial, m.rol, m.activo, m.licencia_vence, m.permisos, m.nombre,
         o.plan, o.max_usuarios, o.max_camaras, o.licencia_vence, o.licencia_estado,
         (select count(*)::int from public.vigia_miembros x where x.org_id = o.id),
         o.creado_por = m.user_id, vigia_priv.vigia_es_plataforma(),
         coalesce((select (u.raw_app_meta_data ->> 'must_change_password')::boolean from auth.users u where u.id = m.user_id), false)
    from public.vigia_miembros m join public.vigia_organizaciones o on o.id = m.org_id
   where m.user_id = (select auth.uid())
   order by o.nombre
$$;

-- 7) miembros de la organización (sólo administrador)
create or replace function public.vigia_miembros_listar(p_org uuid)
returns table (user_id uuid, email text, nombre text, rol text, activo boolean, licencia_vence date, permisos jsonb, propietario boolean, creado_en timestamptz, ultimo_ingreso timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (vigia_priv.vigia_es_admin(p_org) or vigia_priv.vigia_es_plataforma()) then raise exception 'Sólo el administrador puede ver el equipo'; end if;
  return query select m.user_id, u.email::text, m.nombre, m.rol, m.activo, m.licencia_vence, m.permisos, o.creado_por = m.user_id, m.creado_en, u.last_sign_in_at
    from public.vigia_miembros m join auth.users u on u.id = m.user_id join public.vigia_organizaciones o on o.id = m.org_id
   where m.org_id = p_org order by u.email;
end $$;

create or replace function public.vigia_miembro_agregar(p_org uuid, p_email text, p_rol text, p_nombre text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_n int; v_max int;
begin
  if not vigia_priv.vigia_es_admin(p_org) then raise exception 'Sólo el administrador de la organización puede agregar miembros'; end if;
  if p_rol not in ('operador','supervisor','investigador','admin','directivo') then raise exception 'Rol inválido'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then raise exception 'Ese correo aún no está registrado. Pídele que abra la pestaña «Soy del equipo» y cree su cuenta.'; end if;
  if exists (select 1 from public.vigia_miembros where org_id = p_org and user_id = v_user) then raise exception 'Esa persona ya pertenece a la organización'; end if;
  select count(*) into v_n from public.vigia_miembros where org_id = p_org;
  select max_usuarios into v_max from public.vigia_organizaciones where id = p_org;
  if v_n >= v_max then raise exception 'La licencia de la organización permite % usuarios y ya están ocupados. Amplíe el plan o quite un miembro.', v_max; end if;
  insert into public.vigia_miembros(org_id, user_id, rol, nombre) values (p_org, v_user, p_rol, nullif(trim(coalesce(p_nombre, '')), ''));
  perform vigia_priv.vigia_evento(p_org, 'miembro.agregar', jsonb_build_object('email', lower(trim(p_email)), 'rol', p_rol));
  return v_user;
end $$;

-- permisos individuales válidos (deben coincidir con la matriz de la aplicación)
create or replace function vigia_priv.vigia_permisos_validos() returns text[] language sql immutable set search_path = '' as $$
  select array['camaras.ver','camaras.gestionar','grabaciones.cargar','medios.ver','evidencia.descargar','clips.crear','hallazgos.revisar','incidentes.confirmar','expedientes.ver','expedientes.crear','informes.aprobar','reglas.crear','vivo.usar','alarmas.gestionar','auditoria.ver','admin.usuarios','admin.politicas','indicadores.ver','chat.usar','chats.ver_todos','grabaciones.eliminar']
$$;

create or replace function public.vigia_miembro_actualizar(p_org uuid, p_user uuid, p_rol text default null, p_activo boolean default null, p_vence date default null, p_sin_vencimiento boolean default false, p_permisos jsonb default null, p_nombre text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.vigia_miembros; v_admins int; k text; v jsonb;
begin
  if not vigia_priv.vigia_es_admin(p_org) then raise exception 'Sólo el administrador puede cambiar roles, permisos y licencias'; end if;
  select * into r from public.vigia_miembros where org_id = p_org and user_id = p_user;
  if r.user_id is null then raise exception 'Miembro no encontrado'; end if;
  if p_rol is not null and p_rol not in ('operador','supervisor','investigador','admin','directivo') then raise exception 'Rol inválido'; end if;
  if p_permisos is not null then
    if jsonb_typeof(p_permisos) <> 'object' then raise exception 'Permisos inválidos'; end if;
    for k, v in select * from jsonb_each(p_permisos) loop
      if not (k = any (vigia_priv.vigia_permisos_validos())) or jsonb_typeof(v) <> 'boolean' then raise exception 'Permiso inválido: %', k; end if;
    end loop;
  end if;
  -- nunca dejar a la organización sin un administrador con licencia vigente
  if r.rol = 'admin' and ((p_rol is not null and p_rol <> 'admin') or p_activo = false or (p_vence is not null and p_vence < current_date)) then
    select count(*) into v_admins from public.vigia_miembros where org_id = p_org and rol = 'admin' and activo and (licencia_vence is null or licencia_vence >= current_date) and user_id <> p_user;
    if v_admins < 1 then raise exception 'No se puede dejar a la organización sin administrador activo'; end if;
  end if;
  update public.vigia_miembros set
     rol = coalesce(p_rol, rol), activo = coalesce(p_activo, activo),
     licencia_vence = case when p_sin_vencimiento then null else coalesce(p_vence, licencia_vence) end,
     permisos = coalesce(p_permisos, permisos), nombre = coalesce(nullif(trim(p_nombre), ''), nombre)
   where org_id = p_org and user_id = p_user;
  perform vigia_priv.vigia_evento(p_org, 'miembro.actualizar', jsonb_strip_nulls(jsonb_build_object('usuario', p_user, 'rol', p_rol, 'activo', p_activo, 'vence', p_vence, 'sin_vencimiento', nullif(p_sin_vencimiento, false), 'permisos', p_permisos)));
end $$;

create or replace function public.vigia_miembro_quitar(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.vigia_miembros; v_admins int;
begin
  if not vigia_priv.vigia_es_admin(p_org) then raise exception 'Sólo el administrador puede quitar miembros'; end if;
  select * into r from public.vigia_miembros where org_id = p_org and user_id = p_user;
  if r.user_id is null then raise exception 'Miembro no encontrado'; end if;
  if r.rol = 'admin' then
    select count(*) into v_admins from public.vigia_miembros where org_id = p_org and rol = 'admin' and activo and user_id <> p_user;
    if v_admins < 1 then raise exception 'No se puede quitar al último administrador'; end if;
  end if;
  delete from public.vigia_miembros where org_id = p_org and user_id = p_user;
  perform vigia_priv.vigia_evento(p_org, 'miembro.quitar', jsonb_build_object('usuario', p_user, 'rol', r.rol));
end $$;

-- 8) clave temporal con cambio obligatorio (la marca vive en app_metadata: el usuario no puede editarla)
create or replace function vigia_priv.vigia_limpiar_marca_clave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password and coalesce(current_setting('vigia.clave_temporal', true), '') <> '1' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) - 'must_change_password';
  end if;
  return new;
end $$;
drop trigger if exists vigia_limpiar_marca_clave on auth.users;
create trigger vigia_limpiar_marca_clave before update of encrypted_password on auth.users for each row execute function vigia_priv.vigia_limpiar_marca_clave();

create or replace function public.vigia_miembro_clave_temporal(p_org uuid, p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pw text;
begin
  if not vigia_priv.vigia_es_admin(p_org) then raise exception 'Sólo el administrador puede restablecer la contraseña de su equipo'; end if;
  if not exists (select 1 from public.vigia_miembros where org_id = p_org and user_id = p_user) then raise exception 'Miembro no encontrado'; end if;
  if p_user = (select auth.uid()) then raise exception 'Para su propia cuenta use «Olvidé mi contraseña»'; end if;
  if exists (select 1 from public.vigia_miembros where user_id = p_user and org_id <> p_org) then raise exception 'Esa persona pertenece también a otra organización: debe usar «Olvidé mi contraseña»'; end if;
  v_pw := 'Vg-' || translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz') || '-7';
  perform set_config('vigia.clave_temporal', '1', true);
  update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
         raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb, updated_at = now()
   where id = p_user;
  delete from auth.sessions where user_id = p_user;
  perform vigia_priv.vigia_evento(p_org, 'miembro.clave_temporal', jsonb_build_object('usuario', p_user));
  return v_pw;
end $$;

-- 9) licencia de la organización (sólo administradores de la plataforma)
create or replace function public.vigia_org_licencia(p_org uuid, p_plan text, p_max_usuarios int, p_max_camaras int, p_vence date, p_estado text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma puede cambiar la licencia de una organización'; end if;
  update public.vigia_organizaciones set plan = p_plan, max_usuarios = p_max_usuarios, max_camaras = p_max_camaras, licencia_vence = p_vence, licencia_estado = p_estado where id = p_org;
  if not found then raise exception 'Organización no encontrada'; end if;
  perform vigia_priv.vigia_evento(p_org, 'organizacion.licencia', jsonb_build_object('plan', p_plan, 'usuarios', p_max_usuarios, 'camaras', p_max_camaras, 'vence', p_vence, 'estado', p_estado));
end $$;
create or replace function public.vigia_orgs_plataforma()
returns table (org_id uuid, nombre text, plan text, max_usuarios int, max_camaras int, licencia_vence date, licencia_estado text, usuarios int, propietario text, creado_en timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma'; end if;
  return query select o.id, o.nombre, o.plan, o.max_usuarios, o.max_camaras, o.licencia_vence, o.licencia_estado,
      (select count(*)::int from public.vigia_miembros m where m.org_id = o.id), (select u.email::text from auth.users u where u.id = o.creado_por), o.creado_en
    from public.vigia_organizaciones o order by o.creado_en desc;
end $$;

-- 10) las funciones antiguas de alta quedan sustituidas (evita saltarse el cupo de licencias)
drop function if exists public.vigia_agregar_miembro(uuid, text, text);
create or replace function public.vigia_crear_organizacion(p_nombre text) returns uuid
language sql security definer set search_path = '' as $$ select public.vigia_registrar_propietario(p_nombre, null) $$;

do $$ declare f text; begin
  foreach f in array array['vigia_registrar_propietario(text, text)','vigia_mi_acceso()','vigia_miembros_listar(uuid)','vigia_miembro_agregar(uuid, text, text, text)','vigia_miembro_actualizar(uuid, uuid, text, boolean, date, boolean, jsonb, text)','vigia_miembro_quitar(uuid, uuid)','vigia_miembro_clave_temporal(uuid, uuid)','vigia_org_licencia(uuid, text, int, int, date, text)','vigia_orgs_plataforma()','vigia_crear_organizacion(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 11) los miembros ya no se editan directamente desde el cliente: sólo por las funciones anteriores
revoke insert, update, delete on public.vigia_miembros from authenticated;
revoke insert, delete on public.vigia_organizaciones from authenticated;
-- el administrador sólo puede renombrar su organización; plan, cupos y vencimiento son de la plataforma
revoke update on public.vigia_organizaciones from authenticated;
grant update (nombre) on public.vigia_organizaciones to authenticated;

insert into public.vigia_plataforma_admins(email) values ('jebernalc2036@gmail.com') on conflict do nothing;
