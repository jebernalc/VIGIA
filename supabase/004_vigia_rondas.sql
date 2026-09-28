-- Rondas ordenadas por organización; las cámaras de una ronda deben pertenecer al mismo tenant.
create table public.vigia_rondas (
 id uuid primary key,
 organizacion_id uuid not null references public.vigia_organizaciones(id),
 nombre text not null check (length(trim(nombre)) between 3 and 100),
 camaras uuid[] not null check (cardinality(camaras) between 1 and 32),
 intervalo_segundos integer not null check (intervalo_segundos between 5 and 120),
 creado_en timestamptz not null default now(),
 unique(id,organizacion_id)
);
create index vigia_rondas_org_idx on public.vigia_rondas(organizacion_id,creado_en desc);
alter table public.vigia_rondas enable row level security;
create policy vigia_rondas_leer on public.vigia_rondas for select to authenticated
 using (exists (select 1 from public.vigia_miembros m where m.organizacion_id=vigia_rondas.organizacion_id and m.usuario_id=(select auth.uid())));
create policy vigia_rondas_crear on public.vigia_rondas for insert to authenticated
 with check (
  exists (select 1 from public.vigia_miembros m where m.organizacion_id=vigia_rondas.organizacion_id and m.usuario_id=(select auth.uid()) and m.rol='maestro')
  and not exists (select 1 from unnest(camaras) as cid where not exists
   (select 1 from public.vigia_camaras c where c.id=cid and c.organizacion_id=vigia_rondas.organizacion_id))
 );
create policy vigia_rondas_borrar on public.vigia_rondas for delete to authenticated
 using (exists (select 1 from public.vigia_miembros m where m.organizacion_id=vigia_rondas.organizacion_id and m.usuario_id=(select auth.uid()) and m.rol='maestro'));
grant select,insert,delete on public.vigia_rondas to authenticated;
revoke all on public.vigia_rondas from anon;
