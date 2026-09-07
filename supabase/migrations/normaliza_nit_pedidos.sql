-- Normaliza public."Pedidos"."NIT" al formato con guion base-DV, con la misma
-- logica de supabase/migrations/normaliza_identificacion_nit_clientes_unicos.sql
-- (y de la funcion SQL nit_normalizado / js/clientes.js _fmtIdent):
--
--   "901185718 1"      -> "901185718-1"
--   "901.291.485-4"    -> "901291485-4"
--   "901402671 - 6"    -> "901402671-6"
--   "NIT 800159028 1"  -> "800159028-1"
--   "9009460202"       -> "900946020-2"   (NIT de empresa de 10 dig con el DV pegado)
--   "VALOR TOTAL", "48" -> NULL            (basura: <= 4 digitos)
--
-- Reglas (confirmadas con el equipo, 2026-09-07):
--   * NO se calcula el DV: solo se reformatea cuando el DV YA viene en el dato.
--   * Pedidos no tiene columna de Tipo de identificacion, asi que solo se
--     reformatea a base-DV cuando la base tiene 9 digitos y empieza en 8/9
--     (NIT de empresa). Las cedulas con un digito extra pegado
--     ("3003158 1", "24134755 5", "1033764044 3", ...) se dejan igual.
--   * Los NIT que ya estan como "900123456-7" no se tocan.
--   * Valores con <= 4 digitos ("VALOR TOTAL" -> 0 digitos, "48") -> NULL.
--   * La columna "NIT_Adicional" NO se toca aqui.
--
-- Idempotente. Respaldo en public._backup_pedidos_nit_20260907.
-- Triggers de auditoria desactivados durante el UPDATE (igual que en
-- limpia_telefono_pedidos) para no atribuir el cambio a un usuario.

create table if not exists public._backup_pedidos_nit_20260907 (
  id             bigint primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);
alter table public._backup_pedidos_nit_20260907 enable row level security;

with base_data as (
  select id, "NIT" as orig, btrim(coalesce("NIT", '')) as s
  from public."Pedidos"
  where coalesce(btrim("NIT"), '') <> ''
),
step1 as (
  select id, orig, s,
    regexp_replace(s, '\D', '', 'g') as digs,
    (s ~ '[\s.\-]\d\s*$') as tiene_sep,
    regexp_replace(regexp_replace(s, '[\s.\-]\d\s*$', ''), '\D', '', 'g') as pre_digs,
    (regexp_match(s, '[\s.\-](\d)\s*$'))[1] as dv_sep
  from base_data
),
step2 as (
  select id, orig, digs, tiene_sep, dv_sep,
    case when tiene_sep then pre_digs else digs end as work
  from step1
),
step3 as (
  select id, orig, digs, tiene_sep, dv_sep, work,
    (length(work) = 10 and left(work, 1) in ('8', '9')) as pegado
  from step2
),
final as (
  select id, orig, digs,
    case when pegado then left(work, 9) else work end as base,
    case
      when pegado    then right(work, 1)
      when tiene_sep then dv_sep
      else null
    end as dv
  from step3
),
calc as (
  select id, orig,
    case
      when length(digs) <= 4 then null
      when dv is not null and length(base) = 9 and left(base, 1) in ('8', '9')
        then base || '-' || dv
      else orig
    end as nuevo
  from final
),
cambios as (
  select id, orig, nuevo from calc where orig is distinct from nuevo
)
insert into public._backup_pedidos_nit_20260907 (id, valor_anterior, valor_nuevo)
select id, orig, nuevo from cambios
on conflict (id) do nothing;

alter table public."Pedidos" disable trigger user;

update public."Pedidos" p
set "NIT" = b.valor_nuevo
from public._backup_pedidos_nit_20260907 b
where p.id = b.id
  and p."NIT" = b.valor_anterior
  and p."NIT" is distinct from b.valor_nuevo;

alter table public."Pedidos" enable trigger user;

-- Rollback manual:
--   alter table public."Pedidos" disable trigger user;
--   update public."Pedidos" p
--   set "NIT" = b.valor_anterior
--   from public._backup_pedidos_nit_20260907 b
--   where p.id = b.id and p."NIT" is not distinct from b.valor_nuevo;
--   alter table public."Pedidos" enable trigger user;
