-- Corrige el NIT mal digitado de JOSE RICARDO LOPEZ CUERVO en Pedidos:
-- 80463373 -> 80468373 (el correcto, según ClientesUnicos). 4 líneas, 3
-- consecutivos (103, 104, 107 de PARCELAR, julio 2026). Respaldo por id.
-- Aplicada en opghwfuxrvjpbuxeykxn el 2026-09-04.
create table if not exists public._backup_nit_pedidos_20260904 (
  id             bigint primary key,
  valor_anterior text,
  valor_nuevo    text,
  motivo         text,
  aplicado_en    timestamptz not null default now()
);

insert into public._backup_nit_pedidos_20260904 (id, valor_anterior, valor_nuevo, motivo)
select id, "NIT", '80468373', 'typo NIT JOSE RICARDO LOPEZ CUERVO (80463373->80468373)'
from public."Pedidos"
where regexp_replace(coalesce("NIT",''),'\D','','g') = '80463373'
on conflict (id) do nothing;

update public."Pedidos" p
set "NIT" = b.valor_nuevo
from public._backup_nit_pedidos_20260904 b
where p.id = b.id
  and p."NIT" = b.valor_anterior
  and p."NIT" is distinct from b.valor_nuevo;

-- Rollback:
--   update public."Pedidos" p set "NIT" = b.valor_anterior
--   from public._backup_nit_pedidos_20260904 b
--   where p.id = b.id and p."NIT" = b.valor_nuevo;
