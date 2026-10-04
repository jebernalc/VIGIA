-- VIGÍA · 0007 · bajas de miembros y reinicio de doble factor — PENDIENTE
-- ESTA MIGRACIÓN AÚN NO ESTÁ APLICADA en la base de datos.
-- Está pendiente de la confirmación del propietario en Supabase porque contiene sentencias DELETE
-- (borra filas de public.vigia_miembros, auth.mfa_factors y auth.sessions).
-- No aplicar hasta tener esa confirmación; al aplicarla, quitar el sufijo _PENDIENTE del nombre.

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
create or replace function public.vigia_miembro_reiniciar_2fa(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (vigia_priv.vigia_es_plataforma() or (vigia_priv.vigia_es_admin(p_org) and exists (select 1 from public.vigia_miembros where org_id = p_org and user_id = p_user))) then raise exception 'Sólo el administrador puede reiniciar el doble factor de su equipo'; end if;
  if p_user = (select auth.uid()) then raise exception 'No puede reiniciar su propio doble factor desde aquí'; end if;
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  if p_org is not null then perform vigia_priv.vigia_evento(p_org, 'miembro.reiniciar_2fa', jsonb_build_object('usuario', p_user)); end if;
  perform vigia_priv.vigia_notificar(p_user, false, p_org, 'cuenta.2fa_reiniciado', 'Tu doble factor fue reiniciado', 'Un administrador reinició tu verificación en dos pasos. Vuelve a configurarla al ingresar.');
end $$;
revoke execute on function public.vigia_miembro_quitar(uuid, uuid), public.vigia_miembro_reiniciar_2fa(uuid, uuid) from public, anon;
grant execute on function public.vigia_miembro_quitar(uuid, uuid), public.vigia_miembro_reiniciar_2fa(uuid, uuid) to authenticated;
