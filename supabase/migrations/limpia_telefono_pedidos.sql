-- Limpia public."Pedidos"."Telefono": saca de la columna todo lo que no es un
-- numero telefonico utilizable.
--
-- Alcance: SOLO las filas cuyo Telefono hoy tiene algun caracter no numerico.
--   Las que ya son "solo digitos" o estan vacias ('') NO se tocan.
--
-- Reglas (confirmadas con el equipo, 2026-09-07):
--   * Se quitan espacios, guiones y demas simbolos; se conservan los digitos.
--   * Si quedan 7 o 10 digitos  -> es un telefono: se guarda solo con digitos.
--       "322 743 4051"          -> "3227434051"
--       "3 1 1 8 5 7 8 5 2 7"   -> "3118578527"
--   * Si quedan menos de 7 digitos -> no es un telefono (codigos tipo "GAC-C01",
--     notacion cientifica de Excel "3,21E+09"): la casilla queda en NULL.
--   * Si quedan mas de 10 digitos -> son dos numeros pegados en una sola celda
--     ("8640500-3152985901", "3124963362- 3142592298"): NO se tocan.
--
-- Idempotente (tras correr, las filas cambiadas ya son "solo digitos" o NULL y
-- salen del alcance). Respaldo en public._backup_pedidos_telefono_20260907.
-- Los triggers de auditoria se desactivan durante el UPDATE para no atribuir
-- estas 91 filas a una "modificacion" de usuario ni ensuciar audit_log.

create table if not exists public._backup_pedidos_telefono_20260907 (
  id             bigint primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);
alter table public._backup_pedidos_telefono_20260907 enable row level security;

with base_data as (
  select id, "Telefono" as v
  from public."Pedidos"
  where "Telefono" is not null
    and "Telefono" <> ''
    and "Telefono" !~ '^[0-9]+$'
),
calc as (
  select id, v, regexp_replace(v, '[^0-9]', '', 'g') as d
  from base_data
),
fmt as (
  select id, v,
    case
      when length(d) in (7, 10) then d
      when length(d) > 10       then v     -- dos numeros pegados: sin cambio
      else null                            -- menos de 7 digitos: no es telefono
    end as nuevo
  from calc
),
cambios as (
  select id, v, nuevo
  from fmt
  where v is distinct from nuevo
)
insert into public._backup_pedidos_telefono_20260907 (id, valor_anterior, valor_nuevo)
select id, v, nuevo from cambios
on conflict (id) do nothing;

alter table public."Pedidos" disable trigger user;

update public."Pedidos" pe
set "Telefono" = b.valor_nuevo
from public._backup_pedidos_telefono_20260907 b
where pe.id = b.id
  and pe."Telefono" = b.valor_anterior
  and pe."Telefono" is distinct from b.valor_nuevo;

alter table public."Pedidos" enable trigger user;

-- Rollback manual (si hiciera falta):
--   alter table public."Pedidos" disable trigger user;
--   update public."Pedidos" pe
--   set "Telefono" = b.valor_anterior
--   from public._backup_pedidos_telefono_20260907 b
--   where pe.id = b.id and pe."Telefono" is not distinct from b.valor_nuevo;
--   alter table public."Pedidos" enable trigger user;
