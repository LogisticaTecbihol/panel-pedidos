-- Normaliza public."Clientes"."NIT" al formato con guion base-DV, con la misma
-- logica de supabase/migrations/normaliza_nit_pedidos.sql y de
-- normaliza_identificacion_nit_clientes_unicos.sql:
--
--   "901185718 1"      -> "901185718-1"
--   "901402671 - 6"    -> "901402671-6"
--   "NIT 800159028 1"  -> "800159028-1"
--   "9017374281"       -> "901737428-1"   (NIT de empresa de 10 dig con el DV pegado)
--   "VALOR TOTAL", "48" -> NULL            (basura: <= 4 digitos)
--
-- Reglas (mismas que en Pedidos, confirmadas con el equipo 2026-09-07):
--   * NO se calcula el DV: solo se reformatea cuando el DV YA viene en el dato.
--   * "Clientes" no tiene columna de tipo, asi que solo se reformatea a base-DV
--     cuando la base tiene 9 digitos y empieza en 8/9 (NIT de empresa). Las
--     cedulas con un digito extra ("1033764044 3", "20547240 2", "24134755 5")
--     se dejan igual.
--   * Los NIT que ya estan como "900123456-7" no se tocan.
--
-- Nota: public."ClientesUnicos"."Identificacion" ya se normalizo el 2026-09-03
-- (migracion normaliza_identificacion_nit_clientes_unicos.sql); solo quedan 2
-- filas tipo 'CC' que esa regla y esta omiten a proposito.
--
-- Idempotente. Respaldo en public._backup_clientes_nit_20260907.
-- "Clientes" no tiene triggers.

create table if not exists public._backup_clientes_nit_20260907 (
  id_cliente     text primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);
alter table public._backup_clientes_nit_20260907 enable row level security;

with base_data as (
  select "ID_Cliente" as k, "NIT" as orig, btrim(coalesce("NIT", '')) as s
  from public."Clientes"
  where coalesce(btrim("NIT"), '') <> ''
),
step1 as (
  select k, orig, s,
    regexp_replace(s, '\D', '', 'g') as digs,
    (s ~ '[\s.\-]\d\s*$') as tiene_sep,
    regexp_replace(regexp_replace(s, '[\s.\-]\d\s*$', ''), '\D', '', 'g') as pre_digs,
    (regexp_match(s, '[\s.\-](\d)\s*$'))[1] as dv_sep
  from base_data
),
step2 as (
  select k, orig, digs, tiene_sep, dv_sep,
    case when tiene_sep then pre_digs else digs end as work
  from step1
),
step3 as (
  select k, orig, digs, tiene_sep, dv_sep, work,
    (length(work) = 10 and left(work, 1) in ('8', '9')) as pegado
  from step2
),
final as (
  select k, orig, digs,
    case when pegado then left(work, 9) else work end as base,
    case
      when pegado    then right(work, 1)
      when tiene_sep then dv_sep
      else null
    end as dv
  from step3
),
calc as (
  select k, orig,
    case
      when length(digs) <= 4 then null
      when dv is not null and length(base) = 9 and left(base, 1) in ('8', '9')
        then base || '-' || dv
      else orig
    end as nuevo
  from final
),
cambios as (
  select k, orig, nuevo from calc where orig is distinct from nuevo
)
insert into public._backup_clientes_nit_20260907 (id_cliente, valor_anterior, valor_nuevo)
select k, orig, nuevo from cambios
on conflict (id_cliente) do nothing;

update public."Clientes" c
set "NIT" = b.valor_nuevo
from public._backup_clientes_nit_20260907 b
where c."ID_Cliente" = b.id_cliente
  and c."NIT" = b.valor_anterior
  and c."NIT" is distinct from b.valor_nuevo;

-- Rollback manual:
--   update public."Clientes" c set "NIT" = b.valor_anterior
--   from public._backup_clientes_nit_20260907 b
--   where c."ID_Cliente" = b.id_cliente and c."NIT" is not distinct from b.valor_nuevo;
