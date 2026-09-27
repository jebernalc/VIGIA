-- La cuenta maestra puede cambiar el nombre de su propia organización.
-- No puede cambiar su creador, roles ni datos de otras organizaciones.
create policy "vigia_org_maestro_editar" on public.vigia_organizaciones
  for update to authenticated
  using (creado_por = (select auth.uid()) and exists (
    select 1 from public.vigia_miembros m
    where m.organizacion_id = id and m.usuario_id = (select auth.uid()) and m.rol = 'maestro'
  ))
  with check (creado_por = (select auth.uid()) and exists (
    select 1 from public.vigia_miembros m
    where m.organizacion_id = id and m.usuario_id = (select auth.uid()) and m.rol = 'maestro'
  ));

grant update (nombre) on public.vigia_organizaciones to authenticated;
