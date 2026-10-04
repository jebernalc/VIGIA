-- VIGÍA · 0006 · plataforma: solicitudes y notificaciones
-- Refleja lo que está aplicado en la base de datos (definiciones tomadas con pg_get_functiondef,
-- pg_get_constraintdef, pg_get_triggerdef, pg_indexes y pg_policies).
--   · tablas vigia_solicitudes (peticiones de las organizaciones a la plataforma) y vigia_notificaciones
--   · disparador vigia_cuenta_nueva sobre auth.users (avisa a la plataforma de cada cuenta nueva)
--   · funciones públicas de solicitudes, notificaciones y panel de la plataforma
-- Las funciones privadas que se usan aquí (vigia_priv.*) se crean en 0005.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) solicitudes a la plataforma
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.vigia_solicitudes (
  id bigint generated always as identity,
  org_id uuid,
  solicitante uuid,
  solicitante_email text,
  tipo text not null,
  cantidad integer,
  mensaje text,
  estado text not null default 'pendiente'::text,
  respuesta text,
  resuelta_por text,
  creada_en timestamp with time zone not null default now(),
  resuelta_en timestamp with time zone,
  constraint vigia_solicitudes_pkey primary key (id),
  constraint vigia_solicitudes_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.vigia_organizaciones(id) ON DELETE CASCADE,
  constraint vigia_solicitudes_cantidad_check CHECK (((cantidad IS NULL) OR ((cantidad >= 1) AND (cantidad <= 100000)))),
  constraint vigia_solicitudes_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text]))),
  constraint vigia_solicitudes_mensaje_check CHECK (((mensaje IS NULL) OR (char_length(mensaje) <= 1000))),
  constraint vigia_solicitudes_respuesta_check CHECK (((respuesta IS NULL) OR (char_length(respuesta) <= 1000))),
  constraint vigia_solicitudes_tipo_check CHECK ((tipo = ANY (ARRAY['ampliar_usuarios'::text, 'ampliar_camaras'::text, 'cambiar_plan'::text, 'renovar_licencia'::text, 'reactivar'::text, 'soporte'::text, 'otro'::text])))
);
create index if not exists vigia_solicitudes_estado_idx on public.vigia_solicitudes using btree (estado, creada_en desc);
create index if not exists vigia_solicitudes_org_idx on public.vigia_solicitudes using btree (org_id, creada_en desc);
alter table public.vigia_solicitudes enable row level security;

drop policy if exists vigia_solicitudes_ver on public.vigia_solicitudes;
create policy vigia_solicitudes_ver on public.vigia_solicitudes
  as permissive for select to authenticated
  using ((( SELECT vigia_priv.vigia_es_plataforma() AS vigia_es_plataforma) OR ((org_id IS NOT NULL) AND ( SELECT vigia_priv.vigia_es_admin(vigia_solicitudes.org_id) AS vigia_es_admin)) OR (solicitante = ( SELECT auth.uid() AS uid))));
grant select on public.vigia_solicitudes to authenticated;
revoke insert, update, delete on public.vigia_solicitudes from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) notificaciones (a un usuario o a la plataforma)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.vigia_notificaciones (
  id bigint generated always as identity,
  destinatario uuid,
  para_plataforma boolean not null default false,
  org_id uuid,
  tipo text not null,
  titulo text not null,
  cuerpo text,
  datos jsonb not null default '{}'::jsonb,
  creada_en timestamp with time zone not null default now(),
  leida_en timestamp with time zone,
  constraint vigia_notificaciones_pkey primary key (id),
  constraint vigia_notificaciones_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.vigia_organizaciones(id) ON DELETE CASCADE,
  constraint vigia_notificaciones_check CHECK (((destinatario IS NOT NULL) OR para_plataforma))
);
create index if not exists vigia_notif_dest_idx on public.vigia_notificaciones using btree (destinatario, creada_en desc);
create index if not exists vigia_notif_plat_idx on public.vigia_notificaciones using btree (creada_en desc) where para_plataforma;
alter table public.vigia_notificaciones enable row level security;

drop policy if exists vigia_notif_ver on public.vigia_notificaciones;
create policy vigia_notif_ver on public.vigia_notificaciones
  as permissive for select to authenticated
  using (((destinatario = ( SELECT auth.uid() AS uid)) OR (para_plataforma AND ( SELECT vigia_priv.vigia_es_plataforma() AS vigia_es_plataforma))));
grant select on public.vigia_notificaciones to authenticated;
revoke insert, update, delete on public.vigia_notificaciones from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) disparador: aviso a la plataforma por cada cuenta nueva
--    (la función vigia_priv.vigia_cuenta_nueva está en 0005)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'vigia_cuenta_nueva' and tgrelid = 'auth.users'::regclass and not tgisinternal
  ) then
    CREATE TRIGGER vigia_cuenta_nueva AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION vigia_priv.vigia_cuenta_nueva();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) funciones públicas (RPC)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vigia_solicitar_restablecimiento(p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid; v_mail text := lower(trim(coalesce(p_email, ''))); r record; v_n int := 0;
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_mail;
  if v_user is null then return; end if;
  if exists (select 1 from public.vigia_notificaciones n where n.tipo = 'acceso.restablecer' and n.datos ->> 'email' = v_mail and n.creada_en > now() - interval '30 minutes') then return; end if;
  for r in select distinct m.org_id from public.vigia_miembros m where m.user_id = v_user loop
    perform vigia_priv.vigia_notificar_admins(r.org_id, 'acceso.restablecer', 'Solicitud de restablecimiento de acceso', v_mail || ' no puede ingresar y pide una clave temporal (Administración → Usuarios, roles y licencias → Clave temporal).', jsonb_build_object('email', v_mail, 'usuario', v_user));
    v_n := v_n + 1;
  end loop;
  perform vigia_priv.vigia_notificar(null, true, null, 'acceso.restablecer', 'Solicitud de restablecimiento de acceso', v_mail || ' pidió ayuda para ingresar' || case when v_n = 0 then ' y no pertenece a ninguna organización.' else '.' end, jsonb_build_object('email', v_mail, 'usuario', v_user));
end $function$
;
-- se usa desde la pantalla de ingreso, sin sesión
grant execute on function public.vigia_solicitar_restablecimiento(text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.vigia_solicitud_crear(p_org uuid, p_tipo text, p_cantidad integer DEFAULT NULL::integer, p_mensaje text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id bigint; v_mail text; v_org text; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Inicia sesión'; end if;
  if p_org is not null and not exists (select 1 from public.vigia_miembros m where m.org_id = p_org and m.user_id = v_uid and m.rol = 'admin') then raise exception 'Sólo el administrador de la organización puede enviar solicitudes a la plataforma'; end if;
  if (select count(*) from public.vigia_solicitudes s where s.solicitante = v_uid and s.estado = 'pendiente') >= 10 then raise exception 'Ya tienes 10 solicitudes pendientes. Espera la respuesta de la plataforma.'; end if;
  select u.email::text into v_mail from auth.users u where u.id = v_uid;
  select o.nombre into v_org from public.vigia_organizaciones o where o.id = p_org;
  insert into public.vigia_solicitudes(org_id, solicitante, solicitante_email, tipo, cantidad, mensaje) values (p_org, v_uid, v_mail, p_tipo, p_cantidad, nullif(trim(coalesce(p_mensaje, '')), '')) returning id into v_id;
  perform vigia_priv.vigia_notificar(null, true, p_org, 'solicitud.nueva', 'Solicitud #' || v_id || ': ' || replace(p_tipo, '_', ' ') || coalesce(' (' || p_cantidad || ')', ''), coalesce(v_org, 'Sin organización') || ' · ' || coalesce(v_mail, '') || coalesce(' · ' || nullif(trim(p_mensaje), ''), ''), jsonb_build_object('solicitud', v_id));
  if p_org is not null then perform vigia_priv.vigia_evento(p_org, 'solicitud.crear', jsonb_build_object('solicitud', v_id, 'tipo', p_tipo, 'cantidad', p_cantidad)); end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_solicitud_resolver(p_id bigint, p_estado text, p_respuesta text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.vigia_solicitudes; v_mail text;
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma resuelve solicitudes'; end if;
  if p_estado not in ('aprobada','rechazada') then raise exception 'Estado inválido'; end if;
  select * into s from public.vigia_solicitudes where id = p_id;
  if s.id is null then raise exception 'Solicitud no encontrada'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya fue resuelta'; end if;
  select u.email::text into v_mail from auth.users u where u.id = (select auth.uid());
  update public.vigia_solicitudes set estado = p_estado, respuesta = nullif(trim(coalesce(p_respuesta, '')), ''), resuelta_por = v_mail, resuelta_en = now() where id = p_id;
  if s.solicitante is not null then perform vigia_priv.vigia_notificar(s.solicitante, false, s.org_id, 'solicitud.resuelta', 'Tu solicitud #' || p_id || ' fue ' || p_estado, coalesce(nullif(trim(p_respuesta), ''), 'Sin comentarios.'), jsonb_build_object('solicitud', p_id)); end if;
  if s.org_id is not null then perform vigia_priv.vigia_evento(s.org_id, 'solicitud.' || p_estado, jsonb_build_object('solicitud', p_id)); end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_notificaciones_marcar(p_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.vigia_notificaciones set leida_en = now()
   where leida_en is null and (p_id is null or id = p_id)
     and (destinatario = (select auth.uid()) or (para_plataforma and vigia_priv.vigia_es_plataforma()))
$function$
;

CREATE OR REPLACE FUNCTION public.vigia_orgs_plataforma()
 RETURNS TABLE(org_id uuid, nombre text, plan text, max_usuarios integer, max_camaras integer, licencia_vence date, licencia_estado text, usuarios integer, propietario text, creado_en timestamp with time zone, requiere_2fa boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma'; end if;
  return query select o.id, o.nombre, o.plan, o.max_usuarios, o.max_camaras, o.licencia_vence, o.licencia_estado,
      (select count(*)::int from public.vigia_miembros m where m.org_id = o.id), (select u.email::text from auth.users u where u.id = o.creado_por), o.creado_en, o.requiere_2fa
    from public.vigia_organizaciones o order by o.creado_en desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_plataforma_cuentas()
 RETURNS TABLE(user_id uuid, email text, confirmada boolean, creada_en timestamp with time zone, ultimo_ingreso timestamp with time zone, tiene_2fa boolean, organizaciones text, es_plataforma boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma'; end if;
  return query select u.id, u.email::text, u.email_confirmed_at is not null, u.created_at, u.last_sign_in_at,
      exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
      (select string_agg(o.nombre || ' (' || m.rol || case when m.activo then '' else ', suspendida' end || ')', ' · ' order by o.nombre) from public.vigia_miembros m join public.vigia_organizaciones o on o.id = m.org_id where m.user_id = u.id),
      exists (select 1 from public.vigia_plataforma_admins a where a.email = lower(u.email))
    from auth.users u order by u.created_at desc limit 2000;
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_plataforma_confirmar_cuenta(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma'; end if;
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = p_user;
  perform vigia_priv.vigia_notificar(null, true, null, 'cuenta.confirmada', 'Cuenta confirmada manualmente', (select u.email::text from auth.users u where u.id = p_user), jsonb_build_object('usuario', p_user));
end $function$
;

CREATE OR REPLACE FUNCTION public.vigia_plataforma_resumen()
 RETURNS TABLE(organizaciones integer, org_vigentes integer, org_por_vencer integer, cuentas integer, cuentas_sin_confirmar integer, cuentas_sin_organizacion integer, miembros_activos integer, con_2fa integer, solicitudes_pendientes integer, notificaciones_sin_leer integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not vigia_priv.vigia_es_plataforma() then raise exception 'Sólo el administrador de la plataforma'; end if;
  return query select
    (select count(*)::int from public.vigia_organizaciones),
    (select count(*)::int from public.vigia_organizaciones o where o.licencia_estado = 'activa' and (o.licencia_vence is null or o.licencia_vence >= current_date)),
    (select count(*)::int from public.vigia_organizaciones o where o.licencia_estado = 'activa' and o.licencia_vence between current_date and current_date + 15),
    (select count(*)::int from auth.users),
    (select count(*)::int from auth.users u where u.email_confirmed_at is null),
    (select count(*)::int from auth.users u where not exists (select 1 from public.vigia_miembros m where m.user_id = u.id)),
    (select count(*)::int from public.vigia_miembros m where m.activo and (m.licencia_vence is null or m.licencia_vence >= current_date)),
    (select count(distinct f.user_id)::int from auth.mfa_factors f where f.status = 'verified'),
    (select count(*)::int from public.vigia_solicitudes s where s.estado = 'pendiente'),
    (select count(*)::int from public.vigia_notificaciones n where n.para_plataforma and n.leida_en is null);
end $function$
;

-- permisos de las funciones públicas de esta migración: sólo usuarios autenticados
-- (vigia_solicitar_restablecimiento queda además disponible para anon; ver arriba)
revoke execute on function
  public.vigia_solicitud_crear(uuid, text, integer, text),
  public.vigia_solicitud_resolver(bigint, text, text),
  public.vigia_notificaciones_marcar(bigint),
  public.vigia_orgs_plataforma(),
  public.vigia_plataforma_cuentas(),
  public.vigia_plataforma_confirmar_cuenta(uuid),
  public.vigia_plataforma_resumen()
  from public, anon;
grant execute on function
  public.vigia_solicitud_crear(uuid, text, integer, text),
  public.vigia_solicitud_resolver(bigint, text, text),
  public.vigia_notificaciones_marcar(bigint),
  public.vigia_orgs_plataforma(),
  public.vigia_plataforma_cuentas(),
  public.vigia_plataforma_confirmar_cuenta(uuid),
  public.vigia_plataforma_resumen()
  to authenticated;
