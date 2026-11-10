-- ============================================================
-- Verificación del endurecimiento (Paso 1c) — SOLO LECTURA
-- Ejecutar ANTES y DESPUÉS de aplicar las migraciones y comparar.
-- Simula, con SET LOCAL ROLE authenticated + JWT, a un usuario de cada rol
-- activo y a un usuario con sesión válida pero SIN fila en public.usuarios.
--
-- Esperado DESPUÉS de aplicar:
--   • Cada rol del holding: los mismos conteos que ANTES (no cambia nada).
--   • SIN_FILA_EN_USUARIOS: 0 en todas las columnas.
-- ============================================================

create temp table _t(
  rol text, usuario uuid,
  clientes_unicos int, lista_precios int, maestro_productos int,
  bodegas_consig int, consecutivos_rem int, pedidos int, ordenes_compra int,
  rol_detectado text
);

do $$
declare
  r record;
  a int; b int; c int; d int; e int; f int; g int; h text;
begin
  for r in (
    select * from (select distinct on (rol) rol, id from usuarios where activo order by rol, id) x
    union all
    select 'SIN_FILA_EN_USUARIOS', '00000000-0000-0000-0000-000000000000'::uuid
  ) loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into a from "ClientesUnicos";
    select count(*) into b from "ListaPrecios";
    select count(*) into c from maestro_productos;
    select count(*) into d from "BodegasConsignacion";
    select count(*) into e from consecutivos_remisiones;
    select count(*) into f from "Pedidos";
    select count(*) into g from "OrdenesCompra";
    select public.get_user_role() into h;
    reset role;
    insert into _t values (r.rol, r.id, a, b, c, d, e, f, g, h);
  end loop;
end $$;

select rol, clientes_unicos, lista_precios, maestro_productos, bodegas_consig,
       consecutivos_rem, pedidos, ordenes_compra, rol_detectado
from _t order by rol;

-- Políticas SELECT que siguen abiertas (esperado: solo las 2 de `empresas`)
select tablename, policyname, array_to_string(roles, ',') as roles
from pg_policies
where schemaname = 'public' and cmd = 'SELECT' and coalesce(qual, '') = 'true'
order by tablename, policyname;

-- Políticas de Storage que NO mencionan get_user_role(). Esperado tras aplicar la
-- Parte B: las 3 SELECT de buckets públicos (cambios/ingresos/muestras, a propósito)
-- y las 3 leg_adjuntos_* (legalización), que se protegen con user_has_module().
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) not like '%get_user_role%'
order by policyname;

-- Prueba de ESCRITURA en Storage (simulada y siempre revertida con una excepción).
-- Esperado: admin = PERMITIDO en los 5 intentos; SIN_FILA_EN_USUARIOS = bloqueado
-- (INSERT -> 42501; UPDATE -> 0 filas). Antes de la Parte B el usuario sin fila
-- daba PERMITIDO en los 5.
create temp table _s(rol text, bucket text, intento text, resultado text);

do $$
declare
  r record; b text; res text; n int; objname text;
begin
  for r in (select id, rol from (select id, rol from usuarios where activo and rol = 'admin' order by id limit 1) x
            union all select '00000000-0000-0000-0000-000000000000'::uuid, 'SIN_FILA_EN_USUARIOS') loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    foreach b in array array['cambios-adjuntos','ingresos-adjuntos','muestras-adjuntos','pedidos-adjuntos','legalizacion-gastos-adjuntos'] loop
      res := null;
      set local role authenticated;
      begin
        insert into storage.objects(bucket_id, name) values (b, '_rls_test/' || gen_random_uuid()::text || '.txt');
        res := 'PERMITIDO';
        raise exception 'rollback_test';
      exception when others then
        if sqlerrm <> 'rollback_test' then res := 'bloqueado: ' || sqlstate; end if;
      end;
      reset role;
      insert into _s values (r.rol, b, 'INSERT', res);
    end loop;
    select name into objname from storage.objects where bucket_id = 'cambios-adjuntos' limit 1;
    if objname is not null then
      res := null;
      set local role authenticated;
      begin
        update storage.objects set metadata = metadata where bucket_id = 'cambios-adjuntos' and name = objname;
        get diagnostics n = row_count;
        res := case when n > 0 then 'PERMITIDO' else 'bloqueado (0 filas)' end;
        raise exception 'rollback_test';
      exception when others then
        if sqlerrm <> 'rollback_test' then res := 'error: ' || sqlstate; end if;
      end;
      reset role;
      insert into _s values (r.rol, 'cambios-adjuntos', 'UPDATE', res);
    end if;
  end loop;
end $$;

select rol, bucket, intento, resultado from _s order by rol, bucket, intento;
