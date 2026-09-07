-- Segunda pasada de normalizacion de NIT/identificacion (2026-09-07): las
-- cedulas de persona natural que traian un digito de verificacion suelto al
-- final (separado por espacio/guion) y que las migraciones anteriores dejaron
-- sin tocar por la regla conservadora (solo NIT de empresa de 9 dig 8/9).
--
-- Ahora tambien pasan al formato base-DV:
--   "3003158 1"    -> "3003158-1"
--   "24134755 5"   -> "24134755-5"
--   "20547240 2"   -> "20547240-2"
--   "1033764044 3" -> "1033764044-3"
--   "93449825 6"   -> "93449825-6"
--   "7182039---2"  -> "7182039-2"
--
-- Regla: valor que NO es ya "digitos-DV" ni "solo digitos", termina en
-- separador + 1 digito, y la base tiene entre 5 y 12 digitos -> base || '-' || DV.
-- Sigue sin calcularse ningun DV: solo se reformatea el que ya venia.
--
-- Afecta: Pedidos.NIT (14 filas), Clientes.NIT (3), ClientesUnicos.Identificacion (2).
-- Idempotente. Respaldos *_nit_cedulas_20260907. Triggers user desactivados
-- durante el UPDATE en Pedidos y ClientesUnicos (Clientes no tiene triggers).

-- ============ helper de transformacion (inline en cada bloque) ============
-- base = digitos antes del separador+digito final ; dv = ese digito final.

-- ==================== public."Pedidos" ====================
create table if not exists public._backup_pedidos_nit_cedulas_20260907 (
  id bigint primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_pedidos_nit_cedulas_20260907 enable row level security;

with cand as (
  select id, "NIT" as orig, btrim("NIT") as s
  from public."Pedidos"
  where "NIT" is not null and "NIT" <> ''
    and "NIT" !~ '^[0-9]+$' and "NIT" !~ '^[0-9]+-[0-9kK]$'
),
calc as (
  select id, orig,
    regexp_replace(regexp_replace(s, '[\s.\-]\d\s*$', ''), '\D', '', 'g') as base,
    (regexp_match(s, '[\s.\-](\d)\s*$'))[1] as dv,
    (s ~ '[\s.\-]\d\s*$') as tiene_sep
  from cand
),
nuevo as (
  select id, orig,
    case when tiene_sep and dv is not null and length(base) between 5 and 12
         then base || '-' || dv end as nv
  from calc
)
insert into public._backup_pedidos_nit_cedulas_20260907 (id, valor_anterior, valor_nuevo)
select id, orig, nv from nuevo where nv is not null and nv is distinct from orig
on conflict (id) do nothing;

alter table public."Pedidos" disable trigger user;
update public."Pedidos" p set "NIT" = b.valor_nuevo
from public._backup_pedidos_nit_cedulas_20260907 b
where p.id = b.id and p."NIT" = b.valor_anterior and p."NIT" is distinct from b.valor_nuevo;
alter table public."Pedidos" enable trigger user;

-- ==================== public."Clientes" ====================
create table if not exists public._backup_clientes_nit_cedulas_20260907 (
  id_cliente text primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_clientes_nit_cedulas_20260907 enable row level security;

with cand as (
  select "ID_Cliente" as k, "NIT" as orig, btrim("NIT") as s
  from public."Clientes"
  where "NIT" is not null and "NIT" <> ''
    and "NIT" !~ '^[0-9]+$' and "NIT" !~ '^[0-9]+-[0-9kK]$'
),
calc as (
  select k, orig,
    regexp_replace(regexp_replace(s, '[\s.\-]\d\s*$', ''), '\D', '', 'g') as base,
    (regexp_match(s, '[\s.\-](\d)\s*$'))[1] as dv,
    (s ~ '[\s.\-]\d\s*$') as tiene_sep
  from cand
),
nuevo as (
  select k, orig,
    case when tiene_sep and dv is not null and length(base) between 5 and 12
         then base || '-' || dv end as nv
  from calc
)
insert into public._backup_clientes_nit_cedulas_20260907 (id_cliente, valor_anterior, valor_nuevo)
select k, orig, nv from nuevo where nv is not null and nv is distinct from orig
on conflict (id_cliente) do nothing;

update public."Clientes" c set "NIT" = b.valor_nuevo
from public._backup_clientes_nit_cedulas_20260907 b
where c."ID_Cliente" = b.id_cliente and c."NIT" = b.valor_anterior and c."NIT" is distinct from b.valor_nuevo;

-- ==================== public."ClientesUnicos" ====================
create table if not exists public._backup_clientesunicos_ident_cedulas_20260907 (
  id bigint primary key, valor_anterior text, valor_nuevo text,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_clientesunicos_ident_cedulas_20260907 enable row level security;

with cand as (
  select id, "Identificacion" as orig, btrim("Identificacion") as s
  from public."ClientesUnicos"
  where "Identificacion" is not null and "Identificacion" <> ''
    and "Identificacion" !~ '^[0-9]+$' and "Identificacion" !~ '^[0-9]+-[0-9kK]$'
),
calc as (
  select id, orig,
    regexp_replace(regexp_replace(s, '[\s.\-]\d\s*$', ''), '\D', '', 'g') as base,
    (regexp_match(s, '[\s.\-](\d)\s*$'))[1] as dv,
    (s ~ '[\s.\-]\d\s*$') as tiene_sep
  from cand
),
nuevo as (
  select id, orig,
    case when tiene_sep and dv is not null and length(base) between 5 and 12
         then base || '-' || dv end as nv
  from calc
)
insert into public._backup_clientesunicos_ident_cedulas_20260907 (id, valor_anterior, valor_nuevo)
select id, orig, nv from nuevo where nv is not null and nv is distinct from orig
on conflict (id) do nothing;

alter table public."ClientesUnicos" disable trigger user;
update public."ClientesUnicos" cu set "Identificacion" = b.valor_nuevo
from public._backup_clientesunicos_ident_cedulas_20260907 b
where cu.id = b.id and cu."Identificacion" = b.valor_anterior and cu."Identificacion" is distinct from b.valor_nuevo;
alter table public."ClientesUnicos" enable trigger user;

-- Rollback manual: por cada tabla,
--   [disable trigger user;] update ... set col = b.valor_anterior
--   from <backup> b where <pk> = b.<pk> and col is not distinct from b.valor_nuevo;
--   [enable trigger user;]
