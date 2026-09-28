-- VIGÍA · analítica y casos de uso en la nube — v3
-- Eventos de analítica (en vigia_hallazgos), conteos por línea, resumen por grabación, catálogo de casos de uso
-- y vistas agregadas para tableros/BI. Todo con RLS por organización (las vistas usan security_invoker).

-- 1) columnas nuevas
alter table vigia_camaras add column if not exists analitica jsonb;
alter table vigia_hallazgos add column if not exists categoria text;             -- 'analitica' para eventos de casos de uso
alter table vigia_hallazgos add column if not exists detalle jsonb;
alter table vigia_hallazgos add column if not exists atributos jsonb;            -- color aproximado de prendas
alter table vigia_hallazgos add column if not exists track_id int;
alter table vigia_hallazgos add column if not exists experimental boolean default false;
create index if not exists vigia_hallazgos_clase_idx on vigia_hallazgos (org_id, clase, t_abs);

-- 2) conteos por línea y resumen de analítica por grabación
create table if not exists vigia_conteos (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, grabacion_id text not null, camara_id text, linea_id text, linea text, clase text,
  entradas int not null default 0, salidas int not null default 0,
  cruces jsonb not null default '[]'::jsonb,           -- [{t, sentido, trackId, tailgating}] t = segundos desde el inicio de la grabación
  actualizado_en timestamptz not null default now(), primary key (org_id, id));

create table if not exists vigia_analisis (
  org_id uuid not null references vigia_organizaciones(id) on delete cascade,
  id text not null, grabacion_id text not null, camara_id text, motor text, ia boolean,
  ocupacion jsonb, puertas jsonb, calor jsonb, parametros jsonb, configuracion jsonb, eventos_por_tipo jsonb,
  actualizado_en timestamptz not null default now(), primary key (org_id, id));

do $$
declare t text;
begin
  foreach t in array array['vigia_conteos','vigia_analisis'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (vigia_priv.vigia_es_miembro(org_id))', t || '_ver', t);
    execute format('create policy %I on public.%I for insert with check (vigia_priv.vigia_puede_escribir(org_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update using (vigia_priv.vigia_puede_escribir(org_id)) with check (vigia_priv.vigia_puede_escribir(org_id))', t || '_upd', t);
  end loop;
end $$;
grant select, insert, update on vigia_conteos, vigia_analisis to authenticated;
revoke all on vigia_conteos, vigia_analisis from anon;
revoke delete, truncate, references, trigger on vigia_conteos, vigia_analisis from authenticated;

-- 3) catálogo de casos de uso (referencia, sólo lectura para usuarios autenticados)
create table if not exists vigia_casos_uso (
  id text primary key, nombre text not null, estado text not null check (estado in ('implementado','experimental','fase_posterior')),
  requiere_ia boolean not null default false, requiere_config text, descripcion text, referencia_mercado text);
alter table vigia_casos_uso enable row level security;
create policy casos_uso_ver on vigia_casos_uso for select to authenticated using (true);
grant select on vigia_casos_uso to authenticated;
revoke all on vigia_casos_uso from anon;
revoke insert, update, delete, truncate on vigia_casos_uso from authenticated;

insert into vigia_casos_uso (id, nombre, estado, requiere_ia, requiere_config, descripcion, referencia_mercado) values
 ('cruce_linea','Cruce de línea y conteo de entradas/salidas','implementado',true,'linea','Cuenta personas o vehículos que cruzan una línea virtual y su sentido.','Axis Object Analytics (line crossing, crossline counting); Verkada people counting'),
 ('ingreso_grupal','Ingreso en grupo (tailgating)','implementado',true,'linea','Dos o más ingresos por la misma línea en menos de N segundos.','Axis Object Analytics (tailgating detection)'),
 ('intrusion','Intrusión en zona restringida','implementado',true,'zona:restringida','Una persona entra a una zona restringida.','Axis (object in area); Avigilon (classified object in area)'),
 ('merodeo','Merodeo / tiempo en zona','implementado',true,'zona:restringida','Una persona permanece en la zona más de N segundos.','Axis (time in area); Avigilon (loitering)'),
 ('mal_parqueado','Vehículo mal estacionado','implementado',true,'zona:no_parqueo','Un vehículo permanece en zona de no estacionar más de N segundos.','Axis (time in area para vehículos)'),
 ('aglomeracion','Aglomeración / ocupación máxima','implementado',true,'zona:ocupacion','La ocupación de la zona alcanza el umbral.','Axis (occupancy in area)'),
 ('puerta_abierta','Puerta abierta','implementado',false,'puerta','La región de la puerta difiere de su referencia (cerrada) más de N segundos.','Integraciones de control de acceso (puerta forzada / mantenida abierta)'),
 ('objeto_abandonado','Objeto abandonado / nuevo objeto estático','implementado',false,null,'Objeto estático nuevo sin personas ni vehículos cerca durante N segundos.','Analíticas de objeto abandonado de fabricantes de cámaras'),
 ('manipulacion','Manipulación de cámara','implementado',false,null,'Cámara cubierta, desenfocada o movida.','Tampering detection (común en cámaras IP)'),
 ('humo','Posible humo','experimental',false,null,'Heurística de región gris difusa y creciente. No sustituye detectores certificados.','Detección de humo/fuego por video de fabricantes especializados'),
 ('color_prenda','Búsqueda por color de prenda','implementado',true,null,'Color dominante aproximado de prenda superior e inferior.','Avigilon Appearance Search; Verkada AI-Powered Search'),
 ('mapa_calor','Mapa de calor de ocupación','implementado',true,null,'Dónde permanecen y transitan las personas.','Verkada/Axis heatmaps'),
 ('reconocimiento_facial','Reconocimiento facial','fase_posterior',true,null,'Biometría: requiere base legal, evaluación de impacto y medición de sesgos.','Verkada, Avigilon'),
 ('lpr','Lectura de placas (LPR/ANPR)','fase_posterior',true,null,'Requiere OCR especializado y cámaras dedicadas.','Axis License Plate Verifier, Verkada'),
 ('epp','Equipo de protección personal (casco/chaleco)','fase_posterior',true,null,'Requiere modelo entrenado con clases de EPP.','Axis (hard hat detection)'),
 ('caida','Caída de persona','fase_posterior',true,null,'Requiere estimación de pose.','Analíticas de salud y cuidado'),
 ('reid','Re-identificación entre cámaras','fase_posterior',true,null,'Requiere modelo de apariencia (embeddings).','Avigilon Appearance Search'),
 ('busqueda_semantica','Búsqueda en lenguaje natural por contenido visual','fase_posterior',true,null,'Requiere embeddings visión-lenguaje por organización.','Verkada AI-Powered Search')
on conflict (id) do update set nombre = excluded.nombre, estado = excluded.estado, requiere_ia = excluded.requiere_ia, requiere_config = excluded.requiere_config, descripcion = excluded.descripcion, referencia_mercado = excluded.referencia_mercado;

-- 4) vistas agregadas (respetan RLS del usuario que consulta)
create or replace view vigia_v_eventos_por_tipo with (security_invoker = on) as
  select h.org_id, h.camara_id, h.clase as tipo, count(*) as eventos,
         count(*) filter (where h.estado in ('revisado','confirmado')) as validados,
         count(*) filter (where h.estado = 'descartado') as descartados,
         min(h.t_abs) as primero, max(h.t_abs) as ultimo
  from vigia_hallazgos h where h.categoria = 'analitica' group by 1, 2, 3;

create or replace view vigia_v_cruces with (security_invoker = on) as
  select c.org_id, c.camara_id, c.grabacion_id, c.linea, c.clase, (x->>'sentido') as sentido, (x->>'trackId')::int as track_id,
         coalesce((x->>'tailgating')::boolean, false) as en_grupo, (x->>'t')::double precision as t_s,
         g.hora_inicio + make_interval(secs => (x->>'t')::double precision) as t_abs
  from vigia_conteos c cross join lateral jsonb_array_elements(c.cruces) x
  left join vigia_grabaciones g on g.org_id = c.org_id and g.id = c.grabacion_id;

create or replace view vigia_v_conteo_por_hora with (security_invoker = on) as
  select org_id, camara_id, linea, clase, date_trunc('hour', t_abs) as hora,
         count(*) filter (where sentido = 'entrada') as entradas, count(*) filter (where sentido = 'salida') as salidas
  from vigia_v_cruces where t_abs is not null group by 1, 2, 3, 4, 5;

grant select on vigia_v_eventos_por_tipo, vigia_v_cruces, vigia_v_conteo_por_hora to authenticated;
revoke all on vigia_v_eventos_por_tipo, vigia_v_cruces, vigia_v_conteo_por_hora from anon;
