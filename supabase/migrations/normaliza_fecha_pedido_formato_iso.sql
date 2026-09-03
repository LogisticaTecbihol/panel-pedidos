-- Normaliza Pedidos.Fecha_Pedido al formato ISO 'YYYY-MM-DD'.
--
-- Contexto: casi todas las filas guardan la fecha como 'YYYY-MM-DD' (texto),
-- pero 4 quedaron en 'DD/MM/YYYY'. El dashboard y el modulo Pedidos comparan
-- la fecha por prefijo de cadena contra los inputs <input type=date> (que
-- entregan 'YYYY-MM-DD'), asi que '16/06/2026' < '2026-07-01' es siempre
-- verdadero y esas ordenes quedan fuera de cualquier rango con "desde".
--
-- Alcance: SOLO las filas con patron exacto 'DD/MM/YYYY'. Idempotente.
-- Respaldo en public._backup_fecha_pedido_20260904 (id, valor_anterior, valor_nuevo).

create table if not exists public._backup_fecha_pedido_20260904 (
  id             bigint primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);

with cambios as (
  select
    id,
    "Fecha_Pedido" as valor_anterior,
    -- 'DD/MM/YYYY' -> 'YYYY-MM-DD'
    substr("Fecha_Pedido", 7, 4) || '-' ||
    substr("Fecha_Pedido", 4, 2) || '-' ||
    substr("Fecha_Pedido", 1, 2) as valor_nuevo
  from public."Pedidos"
  where "Fecha_Pedido" ~ '^\d{2}/\d{2}/\d{4}$'
)
insert into public._backup_fecha_pedido_20260904 (id, valor_anterior, valor_nuevo)
select id, valor_anterior, valor_nuevo from cambios
on conflict (id) do nothing;

update public."Pedidos" p
set "Fecha_Pedido" = b.valor_nuevo
from public._backup_fecha_pedido_20260904 b
where p.id = b.id
  and p."Fecha_Pedido" = b.valor_anterior
  and p."Fecha_Pedido" is distinct from b.valor_nuevo;

-- Rollback manual (si hiciera falta):
--   update public."Pedidos" p
--   set "Fecha_Pedido" = b.valor_anterior
--   from public._backup_fecha_pedido_20260904 b
--   where p.id = b.id and p."Fecha_Pedido" = b.valor_nuevo;
