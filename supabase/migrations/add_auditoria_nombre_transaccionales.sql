-- Nombre desnormalizado (creado_por_nombre / modificado_por_nombre) + trigger
-- genérico set_auditoria_row en las 13 tablas transaccionales que ya tenían
-- creado_por / modificado_por (UUID) + audit_log.
--
-- Objetivo: poder mostrar "creado por / última modificación por" en cada
-- módulo. La RLS de `usuarios` (usuarios_select_own) no deja a un no-admin
-- resolver el nombre desde el cliente, así que se guarda desnormalizado.
--
-- Reemplaza `trg_modificado_en` por `trg_auditoria_row`, que además es
-- diff-gated: un UPDATE sin cambios reales ya no toca `modificado_en`.
-- `trg_audit_log` (panel Auditoría) se mantiene.

-- ── 1. set_auditoria_row: excluir también updated_at / created_at del ──
-- diff-gate (usuarios tiene set_updated_at ANTES que este trigger, que
-- bumpea updated_at y dispararía un falso "cambio").
create or replace function public.set_auditoria_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.creado_por        := coalesce(new.creado_por, v_uid);
    new.creado_en         := coalesce(new.creado_en, now());
    new.creado_por_nombre := coalesce(nullif(btrim(new.creado_por_nombre), ''),
                                      public._usuario_nombre(new.creado_por));
    if new.modificado_por is null
       and nullif(btrim(new.modificado_por_nombre), '') is null then
      new.modificado_por        := null;
      new.modificado_por_nombre := null;
      new.modificado_en         := null;
    else
      new.modificado_en         := coalesce(new.modificado_en, now());
      new.modificado_por_nombre := coalesce(nullif(btrim(new.modificado_por_nombre), ''),
                                            public._usuario_nombre(new.modificado_por));
    end if;
    return new;
  end if;

  new.creado_por        := old.creado_por;
  new.creado_en         := old.creado_en;
  new.creado_por_nombre := coalesce(nullif(btrim(old.creado_por_nombre), ''),
                                    public._usuario_nombre(old.creado_por));

  if (to_jsonb(new) - 'creado_por' - 'creado_por_nombre' - 'creado_en'
                    - 'modificado_por' - 'modificado_por_nombre' - 'modificado_en'
                    - 'updated_at' - 'created_at')
     is distinct from
     (to_jsonb(old) - 'creado_por' - 'creado_por_nombre' - 'creado_en'
                    - 'modificado_por' - 'modificado_por_nombre' - 'modificado_en'
                    - 'updated_at' - 'created_at')
  then
    new.modificado_por        := v_uid;
    new.modificado_en         := now();
    new.modificado_por_nombre := public._usuario_nombre(v_uid);
  else
    new.modificado_por        := old.modificado_por;
    new.modificado_por_nombre := old.modificado_por_nombre;
    new.modificado_en         := old.modificado_en;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_auditoria_row() from public, anon;

-- ── 2. Columnas + backfill + repunte de trigger en las 13 tablas ──────
do $$
declare
  t text;
begin
  foreach t in array array[
    'Pedidos','Ingresos','OrdenesCompra','EntregasPedido','Reenvases',
    'KardexNC','KardexAjustes','Devoluciones','SolicitudMuestras',
    'CambiosMercancia','usuarios','RemisionesAnuladas','Inventario'
  ]
  loop
    execute format(
      'alter table public.%I
         add column if not exists creado_por_nombre text,
         add column if not exists modificado_por_nombre text', t);

    execute format(
      'update public.%I x
          set creado_por_nombre = coalesce(nullif(btrim(x.creado_por_nombre), ''''),
                                           public._usuario_nombre(x.creado_por)),
              modificado_por_nombre = coalesce(nullif(btrim(x.modificado_por_nombre), ''''),
                                               public._usuario_nombre(x.modificado_por))
        where x.creado_por is not null or x.modificado_por is not null', t);

    execute format('drop trigger if exists trg_modificado_en on public.%I', t);
    execute format('drop trigger if exists trg_auditoria_row on public.%I', t);
    execute format(
      'create trigger trg_auditoria_row
         before insert or update on public.%I
         for each row execute function public.set_auditoria_row()', t);
  end loop;
end $$;

-- ── 3. Refrescar el schema cache de PostgREST ───────────────────────
notify pgrst, 'reload schema';
