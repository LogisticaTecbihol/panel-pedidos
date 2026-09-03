-- Normaliza ClientesUnicos.Telefono segun el plan de numeracion de Colombia:
--   "3 1 0 2 4 0 2 7 2 8" -> "310 240 2728"   (celular: 10 dig, empieza en 3)
--   "+57 310 240 2728"    -> "310 240 2728"
--   "6013345450"          -> "601 334 5450"   (fijo desde 2022: 10 dig, empieza 60)
--   "7 6 1 1 3 2 1"        -> "7611321"        (fijo viejo de 7 dig: solo limpia espacios)
--
-- Reglas (alineadas con js/clientes.js _fmtTelefono):
--   * Se quitan indicativos +57 / 57 / 0 de larga distancia.
--   * Celular = 10 digitos que empieza en 3; fijo nuevo = 10 digitos que
--     empieza en 60 -> se agrupan "XXX XXX XXXX".
--   * Fijo viejo de 7 digitos (sin indicativo de ciudad) -> se deja igual,
--     solo se quitan espacios/puntos/guiones.
--   * Lo que no encaja (numeros extranjeros, truncados, etc.) NO se toca:
--     la UI lo marca con un aviso.
--   * Los campos con varios numeros (separados por "/", ",", ";" o salto de
--     linea) NO se tocan aqui; la UI los formatea al mostrarlos.
--
-- Limpieza puntual: idempotente. Respaldo en
-- public._backup_telefono_20260903 (id, valor_anterior, valor_nuevo).

create table if not exists public._backup_telefono_20260903 (
  id             bigint primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);

with base_data as (
  select id, btrim(coalesce("Telefono", '')) as v
  from public."ClientesUnicos"
  where coalesce(btrim("Telefono"), '') not in ('', '0')
    and btrim("Telefono") !~ '[/,;]'
    and btrim("Telefono") !~ E'[\\r\\n]'
),
digs as (
  select id, v, regexp_replace(v, '\D', '', 'g') as g from base_data
),
sin_pref as (
  select id, v, g,
    case
      when length(g) = 12 and left(g, 2) = '57'  then substr(g, 3)
      when length(g) = 13 and left(g, 3) = '057' then substr(g, 4)
      when length(g) = 11 and left(g, 1) = '0'   then substr(g, 2)
      else g
    end as d
  from digs
),
fmt as (
  select id, v,
    case
      when length(d) = 10 and (left(d, 1) = '3' or left(d, 2) = '60')
        then substr(d, 1, 3) || ' ' || substr(d, 4, 3) || ' ' || substr(d, 7, 4)
      when d ~ '^\d{7}$' and v ~ '^[\d\s.\-]+$'
        then d
      else null
    end as nuevo
  from sin_pref
),
cambios as (
  select id, v, nuevo from fmt
  where nuevo is not null and v is distinct from nuevo
)
insert into public._backup_telefono_20260903 (id, valor_anterior, valor_nuevo)
select id, v, nuevo from cambios
on conflict (id) do nothing;

update public."ClientesUnicos" cu
set "Telefono" = b.valor_nuevo
from public._backup_telefono_20260903 b
where cu.id = b.id
  and cu."Telefono" = b.valor_anterior
  and cu."Telefono" is distinct from b.valor_nuevo;

-- Rollback manual (si hiciera falta):
--   update public."ClientesUnicos" cu
--   set "Telefono" = b.valor_anterior
--   from public._backup_telefono_20260903 b
--   where cu.id = b.id and cu."Telefono" = b.valor_nuevo;
