-- Normaliza ClientesUnicos.Identificacion de los NIT al formato con guion:
--   "900946020 2"     -> "900946020-2"
--   "900.946.020-2"   -> "900946020-2"
--   "9009460202"      -> "900946020-2"   (NIT de empresa con el DV pegado)
--   "NIT 800159028 1" -> "800159028-1"
--   "901310216---2"   -> "901310216-2"
--   "9010402489 8"    -> "901040248-9"   (DV pegado manda; el " 8" sobra)
--
-- Reglas (alineadas con la funcion nit_normalizado y con js/clientes.js _fmtIdent):
--   * Se toma la parte anterior a un separador final (espacio/punto/guion) + 1
--     digito; si esa parte tiene 10 digitos y empieza en 8/9, es un NIT de
--     empresa con el DV pegado: base = 9 digitos, DV = el 10.o (se descarta el
--     digito que iba tras el separador). Si no, base = esa parte y DV = el
--     digito tras el separador.
--   * Sin separador: si son 10 digitos que empiezan en 8/9 -> base 9 + DV pegado.
--   * Solo se toca la fila si es NIT: Tipo_Identificacion = 'NIT', o el tipo
--     esta vacio y la base tiene 9 digitos y empieza en 8/9.
--   * Solo se reescribe cuando el DV YA existe en el dato. NO se calcula el DV:
--     un NIT guardado sin DV se deja igual.
--   * Cedulas (Tipo = 'CC'), pasaportes y numeros que no caen en las reglas de
--     NIT no se tocan.
--
-- Limpieza puntual: idempotente (correrla de nuevo no cambia nada).
-- Antes de reescribir deja una copia de seguridad de los valores originales en
-- public._backup_identificacion_20260903 (id, valor_anterior, valor_nuevo).

create table if not exists public._backup_identificacion_20260903 (
  id             bigint primary key,
  valor_anterior text,
  valor_nuevo    text,
  aplicado_en    timestamptz not null default now()
);

with base_data as (
  select
    id,
    "Identificacion" as orig,
    coalesce(nullif(btrim("Tipo_Identificacion"), ''), '') as tipo,
    btrim(coalesce("Identificacion", '')) as s
  from public."ClientesUnicos"
  where coalesce(btrim("Identificacion"), '') <> ''
),
step1 as (
  select id, orig, tipo,
    regexp_replace(s, '\D', '', 'g') as digs,
    (s ~ '[\s.\-]\d\s*$') as tiene_sep,
    regexp_replace(regexp_replace(s, '[\s.\-]\d\s*$', ''), '\D', '', 'g') as pre_digs,
    (regexp_match(s, '[\s.\-](\d)\s*$'))[1] as dv_sep
  from base_data
),
step2 as (
  select id, orig, tipo, tiene_sep, dv_sep,
    case when tiene_sep then pre_digs else digs end as work
  from step1
),
step3 as (
  select id, orig, tipo, tiene_sep, dv_sep, work,
    (length(work) = 10 and left(work, 1) in ('8', '9')) as pegado
  from step2
),
final as (
  select id, orig, tipo,
    case when pegado then left(work, 9) else work end as base,
    case
      when pegado    then right(work, 1)
      when tiene_sep then dv_sep
      else null
    end as dv
  from step3
),
fmt as (
  select id, orig, base || '-' || dv as nuevo
  from final
  where dv is not null
    and length(base) between 6 and 15
    and ( upper(tipo) = 'NIT'
       or (tipo = '' and length(base) = 9 and left(base, 1) in ('8', '9')) )
),
cambios as (
  select id, orig, nuevo from fmt where orig is distinct from nuevo
)
insert into public._backup_identificacion_20260903 (id, valor_anterior, valor_nuevo)
select id, orig, nuevo from cambios
on conflict (id) do nothing;

update public."ClientesUnicos" cu
set "Identificacion" = b.valor_nuevo
from public._backup_identificacion_20260903 b
where cu.id = b.id
  and cu."Identificacion" = b.valor_anterior
  and cu."Identificacion" is distinct from b.valor_nuevo;

-- Rollback manual (si hiciera falta):
--   update public."ClientesUnicos" cu
--   set "Identificacion" = b.valor_anterior
--   from public._backup_identificacion_20260903 b
--   where cu.id = b.id and cu."Identificacion" = b.valor_nuevo;
