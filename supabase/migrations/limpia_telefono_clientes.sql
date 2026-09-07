-- Limpia el Telefono en las dos tablas de clientes (2026-09-07).
-- Mismo criterio que supabase/migrations/limpia_telefono_pedidos.sql, con
-- diferencias por tabla (confirmadas con el equipo):
--
--   public."Clientes"  (tabla vieja de importacion, 156 filas, la UI no la usa):
--     mismo algoritmo que Pedidos sobre las 14 filas con caracteres no numericos:
--       - 7 o 10 digitos tras quitar simbolos -> se guarda solo con digitos
--       - >10 digitos (dos numeros pegados)   -> sin cambio
--       - <7 digitos ("GAC-C01", etc.)        -> NULL
--
--   public."ClientesUnicos"  (la del panel, ya normalizada el 2026-09-03):
--     los 588 telefonos en formato "XXX XXX XXXX" NO se tocan.
--     solo se arreglan 2 casos puntuales con salto de linea:
--       id 1590  "3112637455\n3112637455" -> "311 263 7455"  (mismo numero repetido)
--       id 1604  "3212080\n128"           -> "3212080128"    (se juntan los digitos)
--     los 2 celulares chilenos (+56..., ids 1640 y 2096) se dejan como estan.
--
-- Idempotente. Respaldos en:
--   public._backup_clientes_telefono_20260907
--   public._backup_clientesunicos_telefono_20260907

-- ===================== public."Clientes" =====================
create table if not exists public._backup_clientes_telefono_20260907 (
  id_cliente     text primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);
alter table public._backup_clientes_telefono_20260907 enable row level security;

with base_data as (
  select "ID_Cliente" as k, "Telefono" as v
  from public."Clientes"
  where "Telefono" is not null and "Telefono" <> '' and "Telefono" !~ '^[0-9]+$'
),
fmt as (
  select k, v, regexp_replace(v, '[^0-9]', '', 'g') as d from base_data
),
cambios as (
  select k, v,
    case
      when length(d) in (7, 10) then d
      when length(d) > 10       then v      -- dos numeros pegados: sin cambio
      else null                             -- menos de 7 digitos: no es telefono
    end as nuevo
  from fmt
)
insert into public._backup_clientes_telefono_20260907 (id_cliente, valor_anterior, valor_nuevo)
select k, v, nuevo from cambios where v is distinct from nuevo
on conflict (id_cliente) do nothing;

update public."Clientes" c
set "Telefono" = b.valor_nuevo
from public._backup_clientes_telefono_20260907 b
where c."ID_Cliente" = b.id_cliente
  and c."Telefono" = b.valor_anterior
  and c."Telefono" is distinct from b.valor_nuevo;

-- ===================== public."ClientesUnicos" =====================
create table if not exists public._backup_clientesunicos_telefono_20260907 (
  id             bigint primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);
alter table public._backup_clientesunicos_telefono_20260907 enable row level security;

insert into public._backup_clientesunicos_telefono_20260907 (id, valor_anterior, valor_nuevo)
select cu.id, cu."Telefono",
       case cu.id when 1590 then '311 263 7455' when 1604 then '3212080128' end
from public."ClientesUnicos" cu
where cu.id in (1590, 1604) and cu."Telefono" ~ E'[\\r\\n]'
on conflict (id) do nothing;

alter table public."ClientesUnicos" disable trigger user;

update public."ClientesUnicos" cu
set "Telefono" = b.valor_nuevo
from public._backup_clientesunicos_telefono_20260907 b
where cu.id = b.id
  and cu."Telefono" = b.valor_anterior
  and cu."Telefono" is distinct from b.valor_nuevo;

alter table public."ClientesUnicos" enable trigger user;

-- Rollback manual:
--   update public."Clientes" c set "Telefono" = b.valor_anterior
--   from public._backup_clientes_telefono_20260907 b
--   where c."ID_Cliente" = b.id_cliente and c."Telefono" is not distinct from b.valor_nuevo;
--
--   alter table public."ClientesUnicos" disable trigger user;
--   update public."ClientesUnicos" cu set "Telefono" = b.valor_anterior
--   from public._backup_clientesunicos_telefono_20260907 b
--   where cu.id = b.id and cu."Telefono" is not distinct from b.valor_nuevo;
--   alter table public."ClientesUnicos" enable trigger user;
