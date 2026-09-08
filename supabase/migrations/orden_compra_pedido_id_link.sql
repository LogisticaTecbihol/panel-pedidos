-- ─────────────────────────────────────────────────────────────────────────────
-- OrdenesCompra.pedido_id  —  vínculo preciso OC de traslado ↔ línea de pedido
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PROBLEMA
--   El consecutivo de un pedido se numera POR COMERCIAL (js/pedidos.js
--   nextConsecutivoPorComercial), así que dentro de una misma empresa el
--   mismo N° se repite entre comerciales / clientes distintos. Ej.: hay dos
--   pedidos "INSUMOS AGROPECUARIOS DE LA SABANA SAS #124" (uno de ISO-C15 /
--   AGROINSUMOS SAN MIGUEL, otro de ISO-C10 / PAEZ SANCHEZ).
--
--   La OC de traslado guarda su vínculo con el pedido SÓLO como el texto
--   Ref_Pedido = 'EMPRESA #N°'. Los índices que arman el "paquete" del pedido
--   (ocsLegalizadasPorPedido, solicitudesCompraPorPedido) clavan por
--   empresa+consecutivo sin cliente → una OC de un pedido #124 se cuela en el
--   paquete del OTRO pedido #124.
--
-- SOLUCIÓN
--   Columna pedido_id (FK lógica a Pedidos.id) que fija exactamente la línea
--   de pedido que originó cada línea de OC de traslado. Las OC nuevas la
--   escriben en el insert (persistirEntregasYTraslados). Esta migración la
--   rellena para las OC históricas.
--
-- BACKFILL
--   Para cada línea de OC de traslado con Ref_Pedido 'EMPRESA #N°' se busca la
--   línea de Pedidos con esa empresa + consecutivo, priorizando (1) mismo
--   producto y (2) Fecha_Pedido más cercana a la fecha de la OC. Verificado:
--   las 113 líneas de traslado ligadas a un pedido resuelven a un único match.
--
-- REVERSIÓN
--   El backfill sólo escribe una columna que nace toda NULL; para deshacer,
--   `update "OrdenesCompra" set pedido_id = null;` o eliminar la columna.
--   Respaldo del estado previo en _bkp_oc_pedido_id_20260908.

-- 1) Respaldo (sólo de las traslado, que son las que toca el backfill).
create table if not exists "_bkp_oc_pedido_id_20260908" as
select id, "Tipo", "Ref_Pedido", "Producto", "Fecha", "Remision", "Remision_Origen"
from "OrdenesCompra"
where "Tipo" ilike 'traslado';

-- 2) Columna nueva (aditiva, nullable).
alter table "OrdenesCompra" add column if not exists pedido_id bigint;

comment on column "OrdenesCompra".pedido_id is
  'Línea de Pedidos (id) que originó esta OC de traslado. NULL para OC no '
  'ligadas a un pedido (compras, cambios, muestras) o históricas sin resolver.';

create index if not exists idx_ordenescompra_pedido_id
  on "OrdenesCompra" (pedido_id) where pedido_id is not null;

-- 3) Backfill de las OC de traslado históricas ligadas a un pedido.
with parsed as (
  select o.id as oc_id, o."Producto" as oc_prod, o."Fecha" as oc_fecha,
         lower(trim(substring(o."Ref_Pedido" from '^(.*) #[^#]*$'))) as emp,
         trim(substring(o."Ref_Pedido" from '#([^#]*)$'))            as num
  from "OrdenesCompra" o
  where o."Tipo" ilike 'traslado'
    and o.pedido_id is null
    and coalesce(o."Ref_Pedido",'') ~ ' #[0-9]+$'
),
d as (
  select p.*,
         case when p.oc_fecha ~ '^\d{4}-\d{2}-\d{2}' then substring(p.oc_fecha from 1 for 10)::date
              when p.oc_fecha ~ '^\d{8}$'            then to_date(p.oc_fecha,'YYYYMMDD')
              else null end as oc_d
  from parsed p
),
cand as (
  select d.oc_id, ped.id as ped_id,
         row_number() over (
           partition by d.oc_id
           order by (upper(trim(ped."Producto")) = upper(trim(d.oc_prod))) desc,
                    abs( coalesce(
                           case when ped."Fecha_Pedido" ~ '^\d{4}-\d{2}-\d{2}'
                                then substring(ped."Fecha_Pedido" from 1 for 10)::date end,
                           d.oc_d, date '1900-01-01')
                         - coalesce(d.oc_d, date '1900-01-01') ) asc,
                    ped.id asc
         ) as rn
  from d
  join "Pedidos" ped
    on lower(trim(ped."Nombre_Empresa")) = d.emp
   and trim(ped."Consecutivo")           = d.num
)
update "OrdenesCompra" o
   set pedido_id = c.ped_id
  from cand c
 where c.oc_id = o.id
   and c.rn = 1;

notify pgrst, 'reload schema';
