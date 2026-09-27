-- Metadatos persistentes de VIGÍA. Todas las tablas son nuevas y quedan aisladas.
create table public.vigia_camaras (
 id uuid primary key, organizacion_id uuid not null references public.vigia_organizaciones(id),
 nombre text not null, zona_horaria text not null, ubicacion text not null default '',
 fuente text not null default 'archivo', creado_en timestamptz not null default now(),
 unique(id,organizacion_id)
);
create table public.vigia_grabaciones (
 id uuid primary key, organizacion_id uuid not null references public.vigia_organizaciones(id),
 camara_id uuid not null, nombre text not null, objeto_original text not null,
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'), tamano bigint not null check(tamano>0),
 duracion double precision not null default 0, estado text not null check(estado in ('processing','ready','failed')),
 error text, cargado_en timestamptz not null default now(),
 unique(id,organizacion_id),
 foreign key(camara_id,organizacion_id) references public.vigia_camaras(id,organizacion_id)
);
create table public.vigia_fotogramas (
 id uuid primary key, organizacion_id uuid not null, grabacion_id uuid not null,
 segundo double precision not null check(segundo>=0), objeto text not null,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 creado_en timestamptz not null default now(),
 foreign key(grabacion_id,organizacion_id) references public.vigia_grabaciones(id,organizacion_id)
);
create table public.vigia_clips (
 id uuid primary key, organizacion_id uuid not null, grabacion_id uuid not null,
 inicio double precision not null check(inicio>=0), fin double precision not null check(fin>inicio),
 objeto text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 creado_en timestamptz not null default now(),
 unique(id,organizacion_id),
 foreign key(grabacion_id,organizacion_id) references public.vigia_grabaciones(id,organizacion_id)
);
create table public.vigia_expedientes (
 id uuid primary key, organizacion_id uuid not null references public.vigia_organizaciones(id),
 titulo text not null, nota text not null default '', estado text not null default 'hipótesis',
 creado_en timestamptz not null default now(), unique(id,organizacion_id)
);
create table public.vigia_evidencias (
 id uuid primary key, organizacion_id uuid not null, expediente_id uuid not null,
 grabacion_id uuid not null, fotograma_id uuid, clip_id uuid,
 foreign key(expediente_id,organizacion_id) references public.vigia_expedientes(id,organizacion_id),
 foreign key(grabacion_id,organizacion_id) references public.vigia_grabaciones(id,organizacion_id)
);
create table public.vigia_auditoria (
 id uuid primary key, organizacion_id uuid not null references public.vigia_organizaciones(id),
 actor uuid not null references auth.users(id), accion text not null, objeto_id uuid not null,
 creado_en timestamptz not null default now()
);
create index vigia_camaras_org_idx on public.vigia_camaras(organizacion_id);
create index vigia_grabaciones_org_fecha_idx on public.vigia_grabaciones(organizacion_id,cargado_en desc);
create index vigia_fotogramas_tiempo_idx on public.vigia_fotogramas(organizacion_id,grabacion_id,segundo);
create index vigia_clips_org_idx on public.vigia_clips(organizacion_id,grabacion_id);
create index vigia_expedientes_org_idx on public.vigia_expedientes(organizacion_id,creado_en desc);
create index vigia_evidencias_exp_idx on public.vigia_evidencias(organizacion_id,expediente_id);
create index vigia_auditoria_org_fecha_idx on public.vigia_auditoria(organizacion_id,creado_en desc);

alter table public.vigia_camaras enable row level security;
alter table public.vigia_grabaciones enable row level security;
alter table public.vigia_fotogramas enable row level security;
alter table public.vigia_clips enable row level security;
alter table public.vigia_expedientes enable row level security;
alter table public.vigia_evidencias enable row level security;
alter table public.vigia_auditoria enable row level security;

-- RLS por membresía para lectura y usuario maestro para escrituras.
do $$
declare t text;
begin
 foreach t in array array['vigia_camaras','vigia_grabaciones','vigia_fotogramas','vigia_clips','vigia_expedientes','vigia_evidencias','vigia_auditoria'] loop
  execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.vigia_miembros m where m.organizacion_id = %I.organizacion_id and m.usuario_id = (select auth.uid())))',t||'_leer',t,t);
  execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.vigia_miembros m where m.organizacion_id = %I.organizacion_id and m.usuario_id = (select auth.uid()) and m.rol = ''maestro''))',t||'_crear',t,t);
  if t='vigia_grabaciones' then
    execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.vigia_miembros m where m.organizacion_id = %I.organizacion_id and m.usuario_id = (select auth.uid()) and m.rol = ''maestro'')) with check (exists (select 1 from public.vigia_miembros m where m.organizacion_id = %I.organizacion_id and m.usuario_id = (select auth.uid()) and m.rol = ''maestro''))',t||'_editar',t,t,t);
    execute format('grant select,insert,update on public.%I to authenticated',t);
  else
    execute format('grant select,insert on public.%I to authenticated',t);
  end if;
  execute format('revoke all on public.%I from anon',t);
 end loop;
end $$;
create policy "vigia_auditoria_actor_real" on public.vigia_auditoria
 as restrictive for insert to authenticated with check (actor=(select auth.uid()));

-- Objetos privados. El primer segmento de cada ruta es el UUID de organización.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('vigia-evidencias','vigia-evidencias',false,52428800,array['video/mp4','image/jpeg'])
on conflict (id) do nothing;
create policy "vigia_objetos_leer" on storage.objects for select to authenticated
 using (bucket_id='vigia-evidencias' and exists (
  select 1 from public.vigia_miembros m where m.organizacion_id::text=(storage.foldername(name))[1]
  and m.usuario_id=(select auth.uid())
 ));
create policy "vigia_objetos_crear" on storage.objects for insert to authenticated
 with check (bucket_id='vigia-evidencias' and exists (
  select 1 from public.vigia_miembros m where m.organizacion_id::text=(storage.foldername(name))[1]
  and m.usuario_id=(select auth.uid()) and m.rol='maestro'
 ));
