-- Unifica el nombre de empresa PARCELAR en ClientesUnicos.
--
-- Problema: 84 clientes quedaron guardados con Nombre_Empresa = 'PARCELAR'
-- (carga inicial supabase/import_clientes_parcelar.sql) y otros 98 con el nombre
-- oficial 'PARCELAR DE COLOMBIA SAS'. En clientes.html el filtro de Empresa
-- muestra la sigla (getSigla), asi que aparecian DOS opciones "PARCELAR" y
-- ninguna listaba a todos los clientes.
--
-- Diagnostico (2026-09-29): cada una de las 84 filas cortas tiene una fila con
-- el nombre oficial y el mismo NIT (cruce 1 a 1). Todas las columnas de negocio
-- (cupo, plazo, telefono, lista de precios, estado, cliente...) coinciden. Lo
-- unico que la fila oficial perdio es la Direccion: en 40 filas quedo copiada de
-- Direccion_Envio, y la direccion real solo vive en la fila corta.
--
-- Que hace:
--   1. Empareja cada fila corta con su fila oficial: mismo NIT y misma
--      Direccion_Envio; si no coincide el envio (vacio o reescrito), se empareja
--      solo si el NIT tiene UNA sola fila oficial. Si el emparejamiento es
--      ambiguo o incompleto, la migracion aborta sin tocar nada.
--   2. Respaldo COMPLETO (jsonb) de las 84 filas cortas y de las 84 oficiales
--      antes de tocarlas, en public._backup_clientes_parcelar_dup_20260929.
--   3. Restaura la Direccion en la fila oficial desde la corta, SOLO cuando la
--      Direccion oficial es copia de su propio Direccion_Envio. Ninguna de esas
--      filas fue editada por una persona.
--   4. Borra las filas con Nombre_Empresa = 'PARCELAR' (no hay FKs, y Pedidos no
--      usa ese nombre).
--
-- Idempotente: si ya no quedan filas cortas, no hace nada.
-- Sin FKs hacia ClientesUnicos; la Bitacora de contacto cruza por nit_normalizado.
--
-- Deshacer (con el respaldo):
--   insert into public."ClientesUnicos"
--   select (jsonb_populate_record(null::public."ClientesUnicos", fila)).*
--   from public._backup_clientes_parcelar_dup_20260929 where rol = 'corta_eliminada';
--
--   update public."ClientesUnicos" l
--      set "Direccion" = b.fila->>'Direccion'
--     from public._backup_clientes_parcelar_dup_20260929 b
--    where b.rol = 'larga_antes' and b.id = l.id;

create table if not exists public._backup_clientes_parcelar_dup_20260929 (
  id          bigint primary key,
  rol         text not null check (rol in ('corta_eliminada', 'larga_antes')),
  fila        jsonb not null,
  aplicado_en timestamptz not null default now()
);
alter table public._backup_clientes_parcelar_dup_20260929 enable row level security;

do $$
declare
  n_cortas  int;
  n_pares   int;
  n_dir     int;
  n_borradas int;
  n_resto   int;
begin
  create temp table _par_parcelar (
    id_corta bigint primary key,
    id_larga bigint unique
  ) on commit drop;

  insert into _par_parcelar (id_corta, id_larga)
  select c.id, l.id
  from public."ClientesUnicos" c
  join public."ClientesUnicos" l
    on l."Nombre_Empresa" = 'PARCELAR DE COLOMBIA SAS'
   and l."Identificacion" = c."Identificacion"
   and (
        coalesce(l."Direccion_Envio", '') = coalesce(c."Direccion_Envio", '')
        or (select count(*)
              from public."ClientesUnicos" l2
             where l2."Nombre_Empresa" = 'PARCELAR DE COLOMBIA SAS'
               and l2."Identificacion" = c."Identificacion") = 1
       )
  where c."Nombre_Empresa" = 'PARCELAR';

  select count(*) into n_cortas from public."ClientesUnicos" where "Nombre_Empresa" = 'PARCELAR';
  select count(*) into n_pares  from _par_parcelar;

  if n_cortas <> n_pares then
    raise exception 'Emparejamiento incompleto: % filas PARCELAR, % con pareja oficial. No se toca nada.', n_cortas, n_pares;
  end if;

  -- Respaldo antes de tocar nada.
  insert into public._backup_clientes_parcelar_dup_20260929 (id, rol, fila)
  select c.id, 'corta_eliminada', to_jsonb(c)
  from public."ClientesUnicos" c
  join _par_parcelar p on p.id_corta = c.id
  on conflict (id) do nothing;

  insert into public._backup_clientes_parcelar_dup_20260929 (id, rol, fila)
  select l.id, 'larga_antes', to_jsonb(l)
  from public."ClientesUnicos" l
  join _par_parcelar p on p.id_larga = l.id
  on conflict (id) do nothing;

  -- Restaurar la Direccion real (solo si la oficial es copia del envio).
  update public."ClientesUnicos" l
     set "Direccion" = c."Direccion"
    from _par_parcelar p
    join public."ClientesUnicos" c on c.id = p.id_corta
   where l.id = p.id_larga
     and coalesce(btrim(c."Direccion"), '') <> ''
     and l."Direccion" is distinct from c."Direccion"
     and l."Direccion" = l."Direccion_Envio";
  get diagnostics n_dir = row_count;

  delete from public."ClientesUnicos"
   where id in (select id_corta from _par_parcelar);
  get diagnostics n_borradas = row_count;

  select count(*) into n_resto from public."ClientesUnicos" where "Nombre_Empresa" = 'PARCELAR';
  if n_resto <> 0 or n_borradas <> n_cortas then
    raise exception 'Verificacion fallida: quedan % filas PARCELAR, borradas % de %.', n_resto, n_borradas, n_cortas;
  end if;

  raise notice 'PARCELAR unificado: % filas cortas borradas, % direcciones restauradas.', n_borradas, n_dir;
end $$;

notify pgrst, 'reload schema';
