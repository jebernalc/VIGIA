-- VIGÍA · central de alarmas, plano del sitio y funciones avanzadas — v4
-- Alarmas con prioridad, SLA, procedimiento (SOP), asignación y resolución; plano del sitio por organización;
-- firma de apariencia en hallazgos (búsqueda por similitud); vistas de indicadores de la central. RLS por organización.

-- 1) alarmas (sincronizadas desde la central local; la resolución se conserva para indicadores)
create table if not exists vigia_alarmas (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, camara_id text, regla_id text, hallazgo_id text, clase text not null,
  prioridad text not null check (prioridad in ('critica','alta','media','baja')),
  sla_s int not null check (sla_s > 0),
  estado text not null check (estado in ('nueva','reconocida','en_atencion','cerrada')),
  fuente text, creada_en timestamptz not null,
  reconocida_en timestamptz, reconocida_por text, dentro_sla boolean,
  asignada_a text, cerrada_en timestamptz, cerrada_por text,
  resolucion text check (resolucion is null or resolucion in ('real','falsa','prueba','duplicada')),
  nota_cierre text, pasos jsonb not null default '[]'::jsonb, historial jsonb not null default '[]'::jsonb,
  actualizado_en timestamptz not null default now(), primary key (org_id, id));
create index if not exists vigia_alarmas_estado_idx on vigia_alarmas (org_id, estado, prioridad, creada_en desc);

-- 2) plano del sitio (posición, orientación y campo de visión por cámara; imagen como data URL ≤ 3 MB)
create table if not exists vigia_planos (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, nombre text not null, imagen text check (imagen is null or (length(imagen) <= 4500000 and imagen ~ '^data:image/(png|jpeg|webp);base64,')),
  camaras jsonb not null default '{}'::jsonb, actualizado_por text,
  actualizado_en timestamptz not null default now(), primary key (org_id, id));

-- 3) firma de apariencia (30 valores: histograma HSV de torso y piernas; describe ropa, no identidad)
alter table vigia_hallazgos add column if not exists firma real[];
alter table vigia_hallazgos drop constraint if exists vigia_hallazgos_firma_len;
alter table vigia_hallazgos add constraint vigia_hallazgos_firma_len check (firma is null or array_length(firma, 1) = 30);

do $$
declare t text;
begin
  foreach t in array array['vigia_alarmas','vigia_planos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for select using (vigia_priv.vigia_es_miembro(org_id))', t || '_ver', t);
    execute format('create policy %I on public.%I for insert with check (vigia_priv.vigia_puede_escribir(org_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update using (vigia_priv.vigia_puede_escribir(org_id)) with check (vigia_priv.vigia_puede_escribir(org_id))', t || '_upd', t);
  end loop;
end $$;
grant select, insert, update on vigia_alarmas, vigia_planos to authenticated;
revoke all on vigia_alarmas, vigia_planos from anon;
revoke delete, truncate, references, trigger on vigia_alarmas, vigia_planos from authenticated;

-- 4) indicadores de la central (vista con security_invoker: respeta RLS del usuario)
create or replace view vigia_v_central_alarmas with (security_invoker = true) as
select org_id,
       count(*) as total,
       count(*) filter (where estado <> 'cerrada') as abiertas,
       count(*) filter (where estado = 'nueva' and now() - creada_en > make_interval(secs => sla_s)) as sla_vencido,
       round(avg(extract(epoch from reconocida_en - creada_en)) filter (where reconocida_en is not null))::int as mtta_s,
       round(avg(extract(epoch from cerrada_en - creada_en)) filter (where cerrada_en is not null))::int as mttr_s,
       round((count(*) filter (where dentro_sla))::numeric / nullif(count(*) filter (where reconocida_en is not null), 0), 3) as cumplimiento_sla,
       round((count(*) filter (where resolucion = 'falsa'))::numeric / nullif(count(*) filter (where estado = 'cerrada'), 0), 3) as tasa_falsas
from vigia_alarmas group by org_id;
grant select on vigia_v_central_alarmas to authenticated;
revoke all on vigia_v_central_alarmas from anon;

-- 5) catálogo: funciones avanzadas de referencia de mercado
insert into vigia_casos_uso (id, nombre, estado, requiere_ia, requiere_config, descripcion, referencia_mercado) values
 ('sinopsis','Sinopsis de video (resumen condensado)','implementado',true,null,'Muestra a la vez objetos de distintos momentos sobre el fondo, con su hora real; clic para ir al original.','BriefCam Video Synopsis'),
 ('apariencia','Búsqueda por apariencia entre cámaras','implementado',true,null,'Encuentra personas con ropa de colores similares (torso/piernas) en todas las cámaras. No es biometría.','Avigilon Appearance Search; Verkada People Search (atributos)'),
 ('central_alarmas','Central de alarmas con SOP y SLA','implementado',false,null,'Triage por prioridad, procedimiento paso a paso, asignación, resolución y métricas MTTA/MTTR/SLA.','Genetec Security Center (alarm management); Milestone XProtect (Alarm Manager)'),
 ('plano_sitio','Plano del sitio con estado de cámaras','implementado',false,null,'Cámaras ubicadas con orientación y campo de visión; color por estado y alarmas abiertas.','Genetec Plan Manager; Milestone Smart Map'),
 ('privacidad','Redacción de privacidad (pixelado de personas)','implementado',true,null,'Versión de clip o imagen con personas pixeladas para exportar; transformación registrada con hash.','Axis Live Privacy Shield; Genetec KiwiVision Privacy Protector'),
 ('paquete_evidencia','Paquete de evidencia verificable','implementado',false,null,'ZIP con manifiesto, SHA256SUMS, cadena de custodia e informe; exportación auditada.','Genetec Clearance; Axon Evidence (exportación con hash)'),
 ('horarios','Reglas y zonas con horario','implementado',false,null,'Vigilancia recurrente por franja horaria y días en la zona horaria de la cámara.','Programación de eventos en VMS (Milestone, Genetec)')
on conflict (id) do update set nombre = excluded.nombre, estado = excluded.estado, requiere_ia = excluded.requiere_ia, descripcion = excluded.descripcion, referencia_mercado = excluded.referencia_mercado;
