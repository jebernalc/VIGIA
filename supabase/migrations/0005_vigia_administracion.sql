-- VIGÍA · 0005 · administración: acceso, roles, permisos y licencias
-- Refleja lo que está aplicado en la base de datos (definiciones tomadas con pg_get_functiondef,
-- pg_get_constraintdef, pg_get_triggerdef, pg_indexes y pg_policies).
--   · columnas de licencia/permisos en vigia_miembros y vigia_organizaciones
--   · tablas vigia_plataforma_admins y vigia_admin_eventos
--   · funciones privadas (esquema vigia_priv) y funciones públicas vigia_* de administración
--   · disparador vigia_limpiar_marca_clave sobre auth.users, política y permisos
-- Todo pasa por funciones SECURITY DEFINER que comprueban el rol del llamador; nunca se expone auth.users.
-- Las funciones de bajas (vigia_miembro_quitar, vigia_miembro_reiniciar_2fa) NO están aquí: ver 0007 (pendiente).

-- vigia_priv.vigia_notificar y vigia_notificar_admins (lenguaje sql) usan public.vigia_notificaciones,
-- que se crea en la migración 0006: se desactiva la validación de cuerpos durante esta migración.
set check_function_bodies = off;

create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) columnas de licencia y permisos
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.vigia_miembros
  add column if not exists activo boolean not null default true,
  add column if not exists licencia_vence date,
  add column if not exists permisos jsonb not null default '{}'::jsonb,
  add column if not exists nombre text;

alter table public.vigia_organizaciones
  add column if not exists plan text not null default 'prueba'::text,
  add column if not exists max_usuarios integer not null default 5,
  add column if not exists max_camaras integer not null default 8,
  add column if not exists licencia_vence date default (CURRENT_DATE + 30),
  add column if not exists licencia_estado text not null default 'activa'::text,
  add column if not exists sede_inicial text,
  add column if not exists requiere_2fa boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vigia_org_plan_chk' and conrelid = 'public.vigia_organizaciones'::regclass
  ) then
    alter table public.vigia_organizaciones add constraint vigia_org_plan_chk
      CHECK (((plan = ANY (ARRAY['prueba'::text, 'profesional'::text, 'empresarial'::text])) AND (licencia_estado = ANY (ARRAY['activa'::text, 'suspendida'::text])) AND ((max_usuarios >= 1) AND (max_usuarios <= 100000)) AND ((max_camaras >= 1) AND (max_camaras <= 100000))));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) administradores de la plataforma. Sin políticas: sólo vía funciones.
--    Los correos de los administradores de la plataforma se insertan manualmente
--    (no se incluyen filas de datos en las migraciones).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.vigia_plataforma_admins (
  email text not null,
  agregado_en timestamp with time zone not null default now(),
  constraint vigia_plataforma_admins_pkey primary key (email),
  constraint vigia_plataforma_admins_email_check CHECK ((email = lower(email)))
);
alter table public.vigia_plataforma_admins enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) eventos de administración (quién cambió qué)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.vigia_admin_eventos (
  id bigint generated always as identity,
  org_id uuid not null,
  actor uuid,
  actor_email text,
  accion text not null,
  detalle jsonb not null default '{}'::jsonb,
  en timestamp with time zone not null default now(),
  constraint vigia_admin_eventos_pkey primary key (id),
  constraint vigia_admin_eventos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.vigia_organizaciones(id) ON DELETE CASCADE
);
create index if not exists vigia_admin_eventos_org_idx on public.vigia_admin_eventos using btree (org_id, en desc);
alter table public.vigia_admin_eventos enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) funciones privadas (esquema vigia_priv, no expuesto por la Data API)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION vigia_priv.vigia_aal_ok()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
      or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_es_plataforma()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select vigia_priv.vigia_aal_ok() and exists (select 1 from public.vigia_plataforma_admins a join auth.users u on lower(u.email) = a.email where u.id = (select auth.uid()) and u.email_confirmed_at is not null)
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_licencia_ok(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select vigia_priv.vigia_aal_ok() and exists (
    select 1 from public.vigia_miembros m join public.vigia_organizaciones o on o.id = m.org_id
     where m.org_id = p_org and m.user_id = (select auth.uid()) and m.activo
       and (m.licencia_vence is null or m.licencia_vence >= current_date)
       and o.licencia_estado = 'activa' and (o.licencia_vence is null or o.licencia_vence >= current_date))
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_rol_en(p_org uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.rol from public.vigia_miembros m where m.org_id = p_org and m.user_id = (select auth.uid()) and vigia_priv.vigia_licencia_ok(p_org)
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_es_miembro(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select vigia_priv.vigia_licencia_ok(p_org)
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_puede_escribir(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(vigia_priv.vigia_rol_en(p_org) in ('operador','supervisor','investigador','admin'), false)
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_es_admin(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select vigia_priv.vigia_aal_ok() and exists (select 1 from public.vigia_miembros m where m.org_id = p_org and m.user_id = (select auth.uid()) and m.rol = 'admin' and m.activo and (m.licencia_vence is null or m.licencia_vence >= current_date))
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_evento(p_org uuid, p_accion text, p_detalle jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.vigia_admin_eventos(org_id, actor, actor_email, accion, detalle)
  values (p_org, (select auth.uid()), (select u.email::text from auth.users u where u.id = (select auth.uid())), p_accion, coalesce(p_detalle, '{}'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_notificar(p_dest uuid, p_plataforma boolean, p_org uuid, p_tipo text, p_titulo text, p_cuerpo text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.vigia_notificaciones(destinatario, para_plataforma, org_id, tipo, titulo, cuerpo, datos)
  values (p_dest, coalesce(p_plataforma, false), p_org, p_tipo, left(p_titulo, 200), left(p_cuerpo, 1000), coalesce(p_datos, '{}'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_notificar_admins(p_org uuid, p_tipo text, p_titulo text, p_cuerpo text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.vigia_notificaciones(destinatario, org_id, tipo, titulo, cuerpo, datos)
  select m.user_id, p_org, p_tipo, left(p_titulo, 200), left(p_cuerpo, 1000), coalesce(p_datos, '{}'::jsonb)
    from public.vigia_miembros m where m.org_id = p_org and m.rol = 'admin' and m.activo
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_permisos_validos()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select array['camaras.ver','camaras.gestionar','grabaciones.cargar','medios.ver','evidencia.descargar','clips.crear','hallazgos.revisar','incidentes.confirmar','expedientes.ver','expedientes.crear','informes.aprobar','reglas.crear','vivo.usar','alarmas.gestionar','auditoria.ver','admin.usuarios','admin.politicas','indicadores.ver','chat.usar','chats.ver_todos','grabaciones.eliminar']
$function$
;

CREATE OR REPLACE FUNCTION vigia_priv.vigia_limpiar_marca_clave()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.encrypted_password is distinct from old.encrypted_password and coalesce(current_setting('vigia.clave_temporal', true), '') <> '1' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) - 'must_change_password';
  end if;
  return new;
end $function$
;

-- función del disparador vigia_cuenta_nueva (el disparador se crea en 0006)
CREATE OR REPLACE FUNCTION vigia_priv.vigia_cuenta_nueva()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    perform vigia_priv.vigia_notificar(null, true, null, 'cuenta.nueva', 'Nueva cuenta registrada: ' || coalesce(new.email, ''), case when new.raw_user_meta_data ? 'vigia_org' then 'Se registró como propietario de «' || (new.raw_user_meta_data ->> 'vigia_org') || '».' else 'Se registró como miembro de equipo.' end, jsonb_build_object('usuario', new.id, 'email', new.email));
  exception when others then null; -- un fallo del aviso nunca debe impedir el registro
  end;
  return new;
end $function$
;

-- permisos de las funciones privadas: sólo authenticated
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'vigia_priv'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) funciones públicas (RPC)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vigia_registrar_propietario(p_org text, p_sede text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_uid uuid := (select auth.uid()); v_mail text;
begin
  if v_uid is null then raise exception 'Inicia sesión para registrar la organización'; end if;
  if char_length(trim(coalesce(p_org, ''))) < 2 then raise exception 'Escribe el nombre de la organización'; end if;
  if exists (select 1 from public.vigia_organizaciones where creado_por = v_uid) then raise exception 'Esta cuenta ya es propietaria de una organización'; end if;
  select u.email::text into v_mail from auth.users u where u.id = v_uid;
  insert into public.vigia_organizaciones(nombre, creado_por, sede_inicial) values (trim(p_org), v_uid, nullif(trim(coalesce(p_sede, '')), '')) returning id into v_id;
  insert into public.vigia_miembros(org_id, user_id, rol) values (v_id, v_uid, 'admin');
  perform vigia_priv.vigia_evento(v_id, 'organizacion.registrar', jsonb_build_object('nombre', trim(p_org)));
  perform vigia_priv.vigia_notificar(null, true, v_id, 'organizacion.nueva', 'Nueva organización: ' || trim(p_org), 'Propietario: ' || coalesce(v_mail, '') || '. Plan de prueba por 30 días (5 usuarios, 8 cámaras).', jsonb_build_object('org', v_id));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_mi_acceso()
 RETURNS TABLE(org_id uuid, org_nombre text, sede_inicial text, rol text, activo boolean, licencia_vence date, permisos jsonb, nombre text, plan text, max_usuarios integer, max_camaras integer, org_vence date, org_estado text, usuarios integer, propietario boolean, es_plataforma boolean, debe_cambiar_clave boolean, requiere_2fa boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.id, o.nombre, o.sede_inicial, m.rol, m.activo, m.licencia_vence, m.permisos, m.nombre,
         o.plan, o.max_usuarios, o.max_camaras, o.licencia_vence, o.licencia_estado,
         (select count(*)::int from public.vigia_miembros x where x.org_id = o.id),
         o.creado_por = m.user_id,
         exists (select 1 from public.vigia_plataforma_admins a join auth.users u on lower(u.email) = a.email where u.id = m.user_id),
         coalesce((select (u.raw_app_meta_data ->> 'must_change_password')::boolean from auth.users u where u.id = m.user_id), false),
         o.requiere_2fa
    from public.vigia_miembros m join public.vigia_organizaciones o on o.id = m.org_id
   where m.user_id = (select auth.uid())
   order by o.nombre
$function$
;

CREATE OR REPLACE FUNCTION public.vigia_miembros_listar(p_org uuid)
 RETURNS TABLE(user_id uuid, email text, nombre text, rol text, activo boolean, licencia_vence date, permisos jsonb, propietario boolean, creado_en timestamp with time zone, ultimo_ingreso timestamp with time zone, tiene_2fa boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (vigia_priv.vigia_es_admin(p_org) or vigia_priv.vigia_es_plataforma()) then raise exception 'Sólo el administrador puede ver el equipo'; end if;
  return query select m.user_id, u.email::text, m.nombre, m.rol, m.activo, m.licencia_vence, m.permisos, o.creado_por = m.user_id, m.creado_en, u.last_sign_in_at,
      exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified')
    from public.vigia_miembros m join auth.users u on u.id = m.user_id join public.vigia_organizaciones o on o.id = m.org_id
   where m.org_id = p_org order by u.email;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_miembro_agregar(p_org uuid, p_email text, p_rol text, p_nombre text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid; v_n int; v_max int; v_org text;
begin
  if not vigia_priv.vigia_es_admin(p_org) then raise exception 'Sólo el administrador de la organización puede agregar miembros'; end if;
  if p_rol not in ('operador','supervisor','investigador','admin','directivo') then raise exception 'Rol inválido'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then raise exception 'Ese correo aún no está registrado. Pídele que abra la pestaña «Soy del equipo» y cree su cuenta.'; end if;
  if exists (select 1 from public.vigia_miembros where org_id = p_org and user_id = v_user) then raise exception 'Esa persona ya pertenece a la organización'; end if;
  select count(*) into v_n from public.vigia_miembros where org_id = p_org;
  select max_usuarios, nombre into v_max, v_org from public.vigia_organizaciones where id = p_org;
  if v_n >= v_max then raise exception 'La licencia de la organización permite % usuarios y ya están ocupados. Envíe una solicitud de ampliación a la plataforma o suspenda un miembro.', v_max; end if;
  insert into public.vigia_miembros(org_id, user_id, rol, nombre) values (p_org, v_user, p_rol, nullif(trim(coalesce(p_nombre, '')), ''));
  perform vigia_priv.vigia_evento(p_org, 'miembro.agregar', jsonb_build_object('email', lower(trim(p_email)), 'rol', p_rol));
  perform vigia_priv.vigia_notificar(v_user, false, p_org, 'miembro.agregado', 'Ya tienes acceso a ' || v_org, 'Tu rol: ' || p_rol || '. Ingresa con tu correo y contraseña.');
  return v_user;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_miembro_actualizar(p_org uuid, p_user uuid, p_rol text DEFAULT NULL::text, p_activo boolean DEFAULT NULL::boolean, p_vence date DEFAULT NULL::date, p_sin_vencimiento boolean DEFAULT false, p_permisos jsonb DEFAULT NULL::jsonb, p_nombre text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_user <> (select auth.uid()) then
    perform vigia_priv.vigia_notificar(p_user, false, p_org, 'miembro.actualizado',
      case when p_activo = false then 'Tu licencia fue suspendida' when p_activo then 'Tu licencia fue reactivada' when p_rol is not null then 'Tu rol cambió a ' || p_rol when p_permisos is not null then 'Tus permisos fueron actualizados' else 'Tu licencia fue actualizada' end,
      'Cambio realizado por el administrador de tu organización. Se aplica en tu siguiente ingreso.');
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_miembro_clave_temporal(p_org uuid, p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pw text;
begin
  if not (vigia_priv.vigia_es_admin(p_org) or vigia_priv.vigia_es_plataforma()) then raise exception 'Sólo el administrador puede restablecer la contraseña de su equipo'; end if;
  if not exists (select 1 from public.vigia_miembros where org_id = p_org and user_id = p_user) then raise exception 'Miembro no encontrado'; end if;
  if p_user = (select auth.uid()) then raise exception 'Para su propia cuenta use «Olvidé mi contraseña»'; end if;
  if not vigia_priv.vigia_es_plataforma() and exists (select 1 from public.vigia_miembros where user_id = p_user and org_id <> p_org) then raise exception 'Esa persona pertenece también a otra organización: debe usar «Olvidé mi contraseña»'; end if;
  v_pw := 'Vg-' || translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz') || '-7';
  perform set_config('vigia.clave_temporal', '1', true);
  update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
         raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb, updated_at = now()
   where id = p_user;
  perform vigia_priv.vigia_evento(p_org, 'miembro.clave_temporal', jsonb_build_object('usuario', p_user));
  return v_pw;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_agregar_miembro(p_org uuid, p_email text, p_rol text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin perform public.vigia_miembro_agregar(p_org, p_email, p_rol, null); end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_crear_organizacion(p_nombre text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select public.vigia_registrar_propietario(p_nombre, null) $function$
;

CREATE OR REPLACE FUNCTION public.vigia_org_licencia(p_org uuid, p_plan text, p_max_usuarios integer, p_max_camaras integer, p_vence date, p_estado text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_nombre text;
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma puede cambiar la licencia de una organización'; end if;
  update public.vigia_organizaciones set plan = p_plan, max_usuarios = p_max_usuarios, max_camaras = p_max_camaras, licencia_vence = p_vence, licencia_estado = p_estado where id = p_org returning nombre into v_nombre;
  if v_nombre is null then raise exception 'Organización no encontrada'; end if;
  perform vigia_priv.vigia_evento(p_org, 'organizacion.licencia', jsonb_build_object('plan', p_plan, 'usuarios', p_max_usuarios, 'camaras', p_max_camaras, 'vence', p_vence, 'estado', p_estado));
  perform vigia_priv.vigia_notificar_admins(p_org, 'organizacion.licencia', 'La licencia de ' || v_nombre || ' fue actualizada', 'Plan ' || p_plan || ' · ' || p_max_usuarios || ' usuarios · ' || p_max_camaras || ' cámaras · ' || case when p_vence is null then 'sin vencimiento' else 'vence ' || p_vence end || ' · ' || p_estado || '.');
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_org_requerir_2fa(p_org uuid, p_requerir boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (vigia_priv.vigia_es_admin(p_org) or vigia_priv.vigia_es_plataforma()) then raise exception 'Sólo el administrador puede cambiar la política de doble factor'; end if;
  update public.vigia_organizaciones set requiere_2fa = coalesce(p_requerir, false) where id = p_org;
  perform vigia_priv.vigia_evento(p_org, 'organizacion.doble_factor', jsonb_build_object('obligatorio', coalesce(p_requerir, false)));
end $function$
;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) disparador: al cambiar la contraseña se limpia la marca de «clave temporal»
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'vigia_limpiar_marca_clave' and tgrelid = 'auth.users'::regclass and not tgisinternal
  ) then
    CREATE TRIGGER vigia_limpiar_marca_clave BEFORE UPDATE OF encrypted_password ON auth.users FOR EACH ROW EXECUTE FUNCTION vigia_priv.vigia_limpiar_marca_clave();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) política y permisos
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists vigia_admin_eventos_ver on public.vigia_admin_eventos;
create policy vigia_admin_eventos_ver on public.vigia_admin_eventos
  as permissive for select to authenticated
  using ((( SELECT vigia_priv.vigia_es_admin(vigia_admin_eventos.org_id) AS vigia_es_admin) OR ( SELECT vigia_priv.vigia_es_plataforma() AS vigia_es_plataforma)));
revoke insert, update, delete on public.vigia_admin_eventos from anon, authenticated;

-- funciones públicas vigia_*: sólo usuarios autenticados
-- (vigia_solicitar_restablecimiento es la excepción: se usa sin sesión; ver 0006)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'vigia\_%' and p.proname <> 'vigia_solicitar_restablecimiento'
  loop
    execute format('revoke execute on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

-- los miembros no se editan directamente desde el cliente: sólo por las funciones anteriores
revoke insert, update, delete on public.vigia_miembros from anon, authenticated;
revoke all on public.vigia_plataforma_admins from anon, authenticated;
-- el administrador sólo puede renombrar su organización; plan, cupos y vencimiento son de la plataforma
revoke insert, delete, update on public.vigia_organizaciones from anon, authenticated;
grant update (nombre) on public.vigia_organizaciones to authenticated;

reset check_function_bodies;
