-- Estandariza public."Pedidos"."Plazo_Pago" al mismo formato que usa la funcion
-- _normalizePlazo de js/clientes.js:
--   "90" / "90 DIAS" / "90 dias" / "90 días"  -> "90 días"
--   "CONTADO" / "Contado" / "contado"          -> "Contado"
--   vacio                                       -> se deja vacio
--
-- Reglas (identicas a _normalizePlazo):
--   * Se colapsan espacios y se recorta.
--   * Si contiene "contado" (en cualquier caja) -> "Contado".
--   * Si no, se toma el primer grupo de digitos -> "<n> días".
--   * Lo que no encaja se deja como esta (recortado).
--
-- 214 filas cambian. Valores finales: Contado, 30/60/90/120/240 días y vacio.
-- Quedan 100 filas vacias (no se rellenan aqui).
--
-- Idempotente. Respaldo public._backup_pedidos_plazo_20260907.
-- Triggers user desactivados durante el UPDATE.

create table if not exists public._backup_pedidos_plazo_20260907 (
  id bigint primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_pedidos_plazo_20260907 enable row level security;

with calc as (
  select id, "Plazo_Pago" as orig,
    btrim(regexp_replace(coalesce("Plazo_Pago",''), '\s+', ' ', 'g')) as t
  from public."Pedidos"
),
nuevo as (
  select id, orig,
    case
      when t = '' then orig
      when lower(t) like '%contado%' then 'Contado'
      when (regexp_match(lower(t), '(\d+)'))[1] is not null
        then (regexp_match(lower(t), '(\d+)'))[1] || ' días'
      else t
    end as nv
  from calc
)
insert into public._backup_pedidos_plazo_20260907 (id, valor_anterior, valor_nuevo)
select id, orig, nv from nuevo where nv is distinct from orig
on conflict (id) do nothing;

alter table public."Pedidos" disable trigger user;
update public."Pedidos" p set "Plazo_Pago" = b.valor_nuevo
from public._backup_pedidos_plazo_20260907 b
where p.id = b.id and p."Plazo_Pago" is not distinct from b.valor_anterior
  and p."Plazo_Pago" is distinct from b.valor_nuevo;
alter table public."Pedidos" enable trigger user;

-- Rollback manual:
--   alter table public."Pedidos" disable trigger user;
--   update public."Pedidos" p set "Plazo_Pago" = b.valor_anterior
--   from public._backup_pedidos_plazo_20260907 b
--   where p.id = b.id and p."Plazo_Pago" is not distinct from b.valor_nuevo;
--   alter table public."Pedidos" enable trigger user;
