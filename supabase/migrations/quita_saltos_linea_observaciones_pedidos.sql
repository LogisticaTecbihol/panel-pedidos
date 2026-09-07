-- Quita los saltos de linea dentro de public."Pedidos"."Observaciones".
--
-- Motivo: un salto de linea dentro de una celda parte la fila en dos al abrir
-- el CSV exportado en Excel/Sheets, y corre las columnas siguientes (Facturar_A,
-- etc.) bajo encabezados equivocados. Confirmado con el equipo (2026-09-07).
--
-- Afecta 7 filas (Consecutivo 66 de ORTIZ GUERRA Y ASOCIADOS SAS, ids 964-970):
--   "lo reemplaza el pedido 113\npor solicitud de disney castellanos"
--   -> "lo reemplaza el pedido 113 por solicitud de disney castellanos"
--
-- Regla: cualquier corrida de \r\n (con espacios alrededor) -> un solo espacio;
-- se recorta el resultado. Idempotente.
-- Respaldo public._backup_pedidos_observaciones_20260907.
-- Triggers user desactivados durante el UPDATE.

create table if not exists public._backup_pedidos_observaciones_20260907 (
  id bigint primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_pedidos_observaciones_20260907 enable row level security;

with nuevo as (
  select id, "Observaciones" as orig,
    btrim(regexp_replace("Observaciones", E'\\s*[\\r\\n]+\\s*', ' ', 'g')) as nv
  from public."Pedidos"
  where "Observaciones" ~ E'[\\r\\n]'
)
insert into public._backup_pedidos_observaciones_20260907 (id, valor_anterior, valor_nuevo)
select id, orig, nv from nuevo where nv is distinct from orig
on conflict (id) do nothing;

alter table public."Pedidos" disable trigger user;
update public."Pedidos" p set "Observaciones" = b.valor_nuevo
from public._backup_pedidos_observaciones_20260907 b
where p.id = b.id and p."Observaciones" is not distinct from b.valor_anterior
  and p."Observaciones" is distinct from b.valor_nuevo;
alter table public."Pedidos" enable trigger user;

-- Rollback manual:
--   alter table public."Pedidos" disable trigger user;
--   update public."Pedidos" p set "Observaciones" = b.valor_anterior
--   from public._backup_pedidos_observaciones_20260907 b
--   where p.id = b.id and p."Observaciones" is not distinct from b.valor_nuevo;
--   alter table public."Pedidos" enable trigger user;
