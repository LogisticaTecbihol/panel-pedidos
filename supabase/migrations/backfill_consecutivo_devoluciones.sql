-- Backfill de Devoluciones.Consecutivo para registros antiguos que quedaron
-- sin numerar (el campo era texto libre antes del 2026-09-28; si el usuario
-- no lo escribía, se guardaba vacío). Desde ahora el panel lo autogenera
-- (js/devoluciones.js: nextConsecutivoDev) igual que Cambios de Mercancía.
--
-- Agrupa por Empresa+Cliente+Vendedor+Fecha (mismo criterio que devGroupKey
-- en js/devoluciones.js, donde varias líneas de producto de una misma
-- devolución comparten consecutivo) y numera secuencialmente por empresa, en
-- orden cronológico, continuando desde el consecutivo numérico más alto ya
-- usado en esa empresa (para no chocar con los ya asignados manualmente).

with grupos as (
  select
    "Empresa", "Cliente", "Vendedor", "Fecha",
    min("Fecha_Registro") as primer_registro,
    min(id) as primer_id
  from "Devoluciones"
  where coalesce("Consecutivo", '') = ''
    and coalesce("Historico", false) = false
  group by "Empresa", "Cliente", "Vendedor", "Fecha"
),
maximos as (
  select "Empresa",
    coalesce(max(case when "Consecutivo" ~ '^\s*[0-9]+\s*$' then trim("Consecutivo")::int else 0 end), 0) as max_consec
  from "Devoluciones"
  group by "Empresa"
),
numerados as (
  select
    g."Empresa", g."Cliente", g."Vendedor", g."Fecha",
    m.max_consec + row_number() over (
      partition by g."Empresa"
      order by g."Fecha", g.primer_registro, g.primer_id
    ) as nuevo_consecutivo
  from grupos g
  join maximos m on m."Empresa" = g."Empresa"
)
update "Devoluciones" d
set "Consecutivo" = n.nuevo_consecutivo::text
from numerados n
where d."Empresa" = n."Empresa"
  and d."Cliente" = n."Cliente"
  and d."Vendedor" = n."Vendedor"
  and d."Fecha" = n."Fecha"
  and coalesce(d."Consecutivo", '') = '';
