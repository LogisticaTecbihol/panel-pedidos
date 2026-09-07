-- Normaliza la columna Departamento en Pedidos, Clientes y ClientesUnicos
-- contra la lista oficial de js/colombia-geo.js (32 deptos + Bogotá D.C.).
--
-- Confirmado con el equipo (2026-09-07):
--   A) Mayúsculas / tildes / abreviaturas -> forma oficial
--      "CUNDINAMARCA","cundinamarca","CUND","cund" -> "Cundinamarca"
--      "BOYACA" -> "Boyacá", "TOLIMA" -> "Tolima", etc.
--      (Pedidos, Clientes y ClientesUnicos)
--   B) "SAN BERNANDO" en Pedidos (8 filas, cliente AGRINTER) -> "Cundinamarca".
--   C) Filas con Departamento vacío / con un teléfono / "pasto nariño" en
--      Pedidos y Clientes: se deduce el departamento del Municipio de la fila
--      usando un mapa de municipios inequívocos. Municipio "Nariño" -> Antioquia
--      (verificado: todas esas filas son de PUNTO AGROTECNOLOGICO, que en el
--      resto de sus pedidos usa Nariño (Antioquia)).
--      ClientesUnicos NO se rellena aquí (queda para una pasada aparte).
--   * Las filas sin Municipio utilizable se dejan como están.
--
-- Idempotente. Respaldos public._backup_*_departamento_20260907.
-- Triggers user desactivados durante el UPDATE en Pedidos y ClientesUnicos.

-- ---- catálogos compartidos (se repiten inline en cada bloque) ----
--   canon: nombre oficial + clave normalizada (minúsculas, sin tildes)
--   fill : municipio normalizado -> departamento oficial

-- ==================== public."Pedidos" ====================
create table if not exists public._backup_pedidos_departamento_20260907 (
  id bigint primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_pedidos_departamento_20260907 enable row level security;

with canon(nombre) as (values
 ('Amazonas'),('Antioquia'),('Arauca'),('Atlántico'),('Bogotá D.C.'),('Bolívar'),('Boyacá'),
 ('Caldas'),('Caquetá'),('Casanare'),('Cauca'),('Cesar'),('Chocó'),('Córdoba'),('Cundinamarca'),
 ('Guainía'),('Guaviare'),('Huila'),('La Guajira'),('Magdalena'),('Meta'),('Nariño'),
 ('Norte de Santander'),('Putumayo'),('Quindío'),('Risaralda'),('San Andrés y Providencia'),
 ('Santander'),('Sucre'),('Tolima'),('Valle del Cauca'),('Vaupés'),('Vichada')),
c as (select nombre, translate(lower(nombre),'áéíóúñ','aeioun') as k from canon),
fill(mk, dep) as (values
 ('neiva','Huila'),('cogua','Cundinamarca'),('pasto','Nariño'),('suaza','Huila'),
 ('bucaramanga','Santander'),('fosca','Cundinamarca'),('funza','Cundinamarca'),
 ('fomeque','Cundinamarca'),('pupiales','Nariño'),('bogota d.c.','Bogotá D.C.'),
 ('manizales','Caldas'),('paipa','Boyacá'),('une','Cundinamarca'),('narino','Antioquia'),
 ('saboya','Boyacá'),('tunja','Boyacá')),
calc as (
  select p.id, p."Departamento" as orig,
    translate(lower(btrim(coalesce(p."Departamento",''))),'áéíóúñ','aeioun') as dk,
    translate(lower(btrim(coalesce(p."Municipio",''))),'áéíóúñ','aeioun') as mk
  from public."Pedidos" p
),
nuevo as (
  select id, orig,
    case
      when dk = 'cund' then 'Cundinamarca'
      when (select nombre from c where c.k = calc.dk) is not null
        then (select nombre from c where c.k = calc.dk)
      when btrim(coalesce(orig,'')) = 'SAN BERNANDO' then 'Cundinamarca'
      when (select dep from fill where fill.mk = calc.mk) is not null
        then (select dep from fill where fill.mk = calc.mk)
      else orig
    end as nv
  from calc
)
insert into public._backup_pedidos_departamento_20260907 (id, valor_anterior, valor_nuevo)
select id, orig, nv from nuevo where nv is distinct from orig
on conflict (id) do nothing;

alter table public."Pedidos" disable trigger user;
update public."Pedidos" p set "Departamento" = b.valor_nuevo
from public._backup_pedidos_departamento_20260907 b
where p.id = b.id and p."Departamento" is not distinct from b.valor_anterior
  and p."Departamento" is distinct from b.valor_nuevo;
alter table public."Pedidos" enable trigger user;

-- ==================== public."Clientes" ====================
create table if not exists public._backup_clientes_departamento_20260907 (
  id_cliente text primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_clientes_departamento_20260907 enable row level security;

with canon(nombre) as (values
 ('Amazonas'),('Antioquia'),('Arauca'),('Atlántico'),('Bogotá D.C.'),('Bolívar'),('Boyacá'),
 ('Caldas'),('Caquetá'),('Casanare'),('Cauca'),('Cesar'),('Chocó'),('Córdoba'),('Cundinamarca'),
 ('Guainía'),('Guaviare'),('Huila'),('La Guajira'),('Magdalena'),('Meta'),('Nariño'),
 ('Norte de Santander'),('Putumayo'),('Quindío'),('Risaralda'),('San Andrés y Providencia'),
 ('Santander'),('Sucre'),('Tolima'),('Valle del Cauca'),('Vaupés'),('Vichada')),
c as (select nombre, translate(lower(nombre),'áéíóúñ','aeioun') as k from canon),
fill(mk, dep) as (values
 ('neiva','Huila'),('cogua','Cundinamarca'),('pasto','Nariño'),('suaza','Huila'),
 ('bucaramanga','Santander'),('fosca','Cundinamarca'),('funza','Cundinamarca'),
 ('fomeque','Cundinamarca'),('pupiales','Nariño'),('bogota d.c.','Bogotá D.C.'),
 ('manizales','Caldas'),('paipa','Boyacá'),('une','Cundinamarca'),('narino','Antioquia'),
 ('saboya','Boyacá'),('tunja','Boyacá')),
calc as (
  select cl."ID_Cliente" as k, cl."Departamento" as orig,
    translate(lower(btrim(coalesce(cl."Departamento",''))),'áéíóúñ','aeioun') as dk,
    translate(lower(btrim(coalesce(cl."Municipio",''))),'áéíóúñ','aeioun') as mk
  from public."Clientes" cl
),
nuevo as (
  select k, orig,
    case
      when dk = 'cund' then 'Cundinamarca'
      when (select nombre from c where c.k = calc.dk) is not null
        then (select nombre from c where c.k = calc.dk)
      when btrim(coalesce(orig,'')) = 'SAN BERNANDO' then 'Cundinamarca'
      when (select dep from fill where fill.mk = calc.mk) is not null
        then (select dep from fill where fill.mk = calc.mk)
      else orig
    end as nv
  from calc
)
insert into public._backup_clientes_departamento_20260907 (id_cliente, valor_anterior, valor_nuevo)
select k, orig, nv from nuevo where nv is distinct from orig
on conflict (id_cliente) do nothing;

update public."Clientes" cl set "Departamento" = b.valor_nuevo
from public._backup_clientes_departamento_20260907 b
where cl."ID_Cliente" = b.id_cliente and cl."Departamento" is not distinct from b.valor_anterior
  and cl."Departamento" is distinct from b.valor_nuevo;

-- ==================== public."ClientesUnicos" (solo A: casing/tildes) ====================
create table if not exists public._backup_clientesunicos_departamento_20260907 (
  id bigint primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_clientesunicos_departamento_20260907 enable row level security;

with canon(nombre) as (values
 ('Amazonas'),('Antioquia'),('Arauca'),('Atlántico'),('Bogotá D.C.'),('Bolívar'),('Boyacá'),
 ('Caldas'),('Caquetá'),('Casanare'),('Cauca'),('Cesar'),('Chocó'),('Córdoba'),('Cundinamarca'),
 ('Guainía'),('Guaviare'),('Huila'),('La Guajira'),('Magdalena'),('Meta'),('Nariño'),
 ('Norte de Santander'),('Putumayo'),('Quindío'),('Risaralda'),('San Andrés y Providencia'),
 ('Santander'),('Sucre'),('Tolima'),('Valle del Cauca'),('Vaupés'),('Vichada')),
c as (select nombre, translate(lower(nombre),'áéíóúñ','aeioun') as k from canon),
calc as (
  select cu.id, cu."Departamento" as orig,
    translate(lower(btrim(coalesce(cu."Departamento",''))),'áéíóúñ','aeioun') as dk
  from public."ClientesUnicos" cu
),
nuevo as (
  select id, orig,
    case
      when dk = 'cund' then 'Cundinamarca'
      when (select nombre from c where c.k = calc.dk) is not null
        then (select nombre from c where c.k = calc.dk)
      else orig
    end as nv
  from calc
)
insert into public._backup_clientesunicos_departamento_20260907 (id, valor_anterior, valor_nuevo)
select id, orig, nv from nuevo where nv is distinct from orig
on conflict (id) do nothing;

alter table public."ClientesUnicos" disable trigger user;
update public."ClientesUnicos" cu set "Departamento" = b.valor_nuevo
from public._backup_clientesunicos_departamento_20260907 b
where cu.id = b.id and cu."Departamento" is not distinct from b.valor_anterior
  and cu."Departamento" is distinct from b.valor_nuevo;
alter table public."ClientesUnicos" enable trigger user;

-- Rollback manual: por tabla, update ... set "Departamento" = b.valor_anterior
--   from <backup> b where <pk> = b.<pk> and "Departamento" is not distinct from b.valor_nuevo;
--   (con disable/enable trigger user en Pedidos y ClientesUnicos)
