-- Tablas independientes para VIGÍA en un proyecto Supabase compartido.
-- Aplicar una vez. No modifica tablas de otras aplicaciones.
create table if not exists public.vigia_organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 3 and 120),
  creado_por uuid not null references auth.users(id) on delete restrict,
  creado_en timestamptz not null default now()
);

create table if not exists public.vigia_miembros (
  organizacion_id uuid not null references public.vigia_organizaciones(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('maestro','supervisor','operador','investigador')),
  creado_en timestamptz not null default now(),
  primary key (organizacion_id,usuario_id)
);

create index if not exists vigia_miembros_usuario_idx on public.vigia_miembros(usuario_id);
create index if not exists vigia_organizaciones_creador_idx on public.vigia_organizaciones(creado_por);

alter table public.vigia_organizaciones enable row level security;
alter table public.vigia_miembros enable row level security;

create policy "vigia_org_ver_miembros" on public.vigia_organizaciones
  for select to authenticated using (
    creado_por = (select auth.uid()) or exists (select 1 from public.vigia_miembros m
      where m.organizacion_id = id and m.usuario_id = (select auth.uid()))
  );
create policy "vigia_org_crear_propia" on public.vigia_organizaciones
  for insert to authenticated with check (creado_por = (select auth.uid()));
create policy "vigia_miembro_ver_propio" on public.vigia_miembros
  for select to authenticated using (usuario_id = (select auth.uid()));
create policy "vigia_miembro_maestro_creador" on public.vigia_miembros
  for insert to authenticated with check (
    usuario_id = (select auth.uid()) and rol = 'maestro'
    and exists (select 1 from public.vigia_organizaciones o
      where o.id = organizacion_id and o.creado_por = (select auth.uid()))
  );

revoke all on public.vigia_organizaciones, public.vigia_miembros from anon;
grant select,insert on public.vigia_organizaciones, public.vigia_miembros to authenticated;

-- Sin políticas de update/delete: tampoco el cliente maestro puede alterar
-- evidencias, roles ni el autor de una organización mediante la Data API.
