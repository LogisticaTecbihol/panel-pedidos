-- Corrige el NIT mal digitado de TODO CAMPO FAJARDO SAS en Pedidos:
-- 901737420 / 901737420-0 -> 901737428 (correcto, según ClientesUnicos).
-- 5 líneas (ids 54, 658, 659, 660, 665), consecutivos 74/80/81/82 de IASO,
-- junio 2026. Respaldo en _backup_nit_pedidos_20260904 (motivo 'typo NIT TODO...').
-- Aplicada en opghwfuxrvjpbuxeykxn el 2026-09-04.
insert into public._backup_nit_pedidos_20260904 (id, valor_anterior, valor_nuevo, motivo)
select id, "NIT", '901737428', 'typo NIT TODO CAMPO FAJARDO SAS (901737420->901737428)'
from public."Pedidos"
where regexp_replace(coalesce("NIT",''),'\D','','g') in ('901737420','9017374200')
on conflict (id) do nothing;

update public."Pedidos" p
set "NIT" = b.valor_nuevo
from public._backup_nit_pedidos_20260904 b
where p.id = b.id
  and b.motivo like 'typo NIT TODO CAMPO FAJARDO%'
  and p."NIT" = b.valor_anterior
  and p."NIT" is distinct from b.valor_nuevo;

-- Rollback:
--   update public."Pedidos" p set "NIT" = b.valor_anterior
--   from public._backup_nit_pedidos_20260904 b
--   where p.id = b.id and b.motivo like 'typo NIT TODO CAMPO FAJARDO%'
--     and p."NIT" = b.valor_nuevo;
