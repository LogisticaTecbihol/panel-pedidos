-- Trazabilidad (creado/modificado por + cuándo) en 3 maestros más:
-- maestro_productos, ListaPrecios, InventarioFisico. Mismo patrón que
-- ClientesUnicos (ver add_auditoria_clientes_unicos.sql).
--
-- · Función trigger genérica `set_auditoria_row` (reutilizable). ClientesUnicos
--   se repunta a ella y se elimina `set_auditoria_clientes_unicos`.
-- · `maestro_productos` y `ListaPrecios` reciben además `trg_audit_log`
--   (panel Auditoría).
-- · `InventarioFisico` NO recibe `trg_audit_log`: guardarInventarioFisico
--   borra y reinserta todas las líneas del conteo en cada guardado, lo que
--   generaría cientos de filas de log por conteo. Solo columnas + relleno.
-- · Backfill: nombre desde `usuarios` si ya había `creado_por`; si no,
--   "Carga inicial".

-- ── 1. Helper: nombre visible de un usuario (nombre, o email si no hay) ──
create or replace function public._usuario_nombre(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(u.nombre), ''), u.email)
    from public.usuarios u
   where u.id = p_uid;
$$;

-- ── 2. Función trigger genérica ──────────────────────────────────────
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
    -- modificado_* normalmente null en un INSERT; se respeta si viene explícito
    -- (caso: re-guardado de un borrador que borra+reinserta filas).
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

  -- UPDATE: creado_* es inmutable; modificado_* solo si cambió un campo real.
  new.creado_por        := old.creado_por;
  new.creado_en         := old.creado_en;
  new.creado_por_nombre := coalesce(nullif(btrim(old.creado_por_nombre), ''),
                                    public._usuario_nombre(old.creado_por));

  if (to_jsonb(new) - 'creado_por' - 'creado_por_nombre' - 'creado_en'
                    - 'modificado_por' - 'modificado_por_nombre' - 'modificado_en')
     is distinct from
     (to_jsonb(old) - 'creado_por' - 'creado_por_nombre' - 'creado_en'
                    - 'modificado_por' - 'modificado_por_nombre' - 'modificado_en')
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

-- Los triggers ejecutan la función sin necesidad de EXECUTE del invocador.
revoke execute on function public._usuario_nombre(uuid) from public, anon;
revoke execute on function public.set_auditoria_row() from public, anon;

-- Repuntar ClientesUnicos a la función genérica y limpiar la específica.
drop trigger if exists trg_auditoria_clientes_unicos on public."ClientesUnicos";
drop trigger if exists trg_auditoria_row on public."ClientesUnicos";
create trigger trg_auditoria_row
  before insert or update on public."ClientesUnicos"
  for each row execute function public.set_auditoria_row();
drop function if exists public.set_auditoria_clientes_unicos();

-- ── 3. maestro_productos ─────────────────────────────────────────────
alter table public.maestro_productos
  add column if not exists creado_por             uuid references auth.users(id),
  add column if not exists creado_por_nombre      text,
  add column if not exists creado_en              timestamptz,
  add column if not exists modificado_por         uuid references auth.users(id),
  add column if not exists modificado_por_nombre  text,
  add column if not exists modificado_en          timestamptz;

update public.maestro_productos
   set creado_en = coalesce(creado_en, timestamptz '2026-09-02 00:00:00-05'),
       creado_por_nombre = coalesce(
         nullif(btrim(creado_por_nombre), ''),
         (select coalesce(nullif(btrim(u.nombre), ''), u.email)
            from public.usuarios u where u.id = maestro_productos.creado_por),
         'Carga inicial')
 where creado_en is null or creado_por_nombre is null;

drop trigger if exists trg_auditoria_row on public.maestro_productos;
create trigger trg_auditoria_row
  before insert or update on public.maestro_productos
  for each row execute function public.set_auditoria_row();

drop trigger if exists trg_audit_log on public.maestro_productos;
create trigger trg_audit_log
  after insert or update or delete on public.maestro_productos
  for each row execute function public.fn_audit_log();

-- ── 4. ListaPrecios (ya tenía creado_por / modificado_por uuid) ───────
alter table public."ListaPrecios"
  add column if not exists creado_por_nombre      text,
  add column if not exists creado_en              timestamptz,
  add column if not exists modificado_por_nombre  text,
  add column if not exists modificado_en          timestamptz;

update public."ListaPrecios"
   set creado_en = coalesce(creado_en, timestamptz '2026-09-02 00:00:00-05'),
       creado_por_nombre = coalesce(
         nullif(btrim(creado_por_nombre), ''),
         (select coalesce(nullif(btrim(u.nombre), ''), u.email)
            from public.usuarios u where u.id = "ListaPrecios".creado_por),
         'Carga inicial'),
       modificado_por_nombre = coalesce(
         nullif(btrim(modificado_por_nombre), ''),
         (select coalesce(nullif(btrim(u.nombre), ''), u.email)
            from public.usuarios u where u.id = "ListaPrecios".modificado_por))
 where creado_en is null or creado_por_nombre is null
    or (modificado_por is not null and modificado_por_nombre is null);

drop trigger if exists trg_auditoria_row on public."ListaPrecios";
create trigger trg_auditoria_row
  before insert or update on public."ListaPrecios"
  for each row execute function public.set_auditoria_row();

drop trigger if exists trg_audit_log on public."ListaPrecios";
create trigger trg_audit_log
  after insert or update or delete on public."ListaPrecios"
  for each row execute function public.fn_audit_log();

-- ── 5. InventarioFisico (sin trg_audit_log; ver nota de cabecera) ────
alter table public."InventarioFisico"
  add column if not exists creado_por_nombre      text,
  add column if not exists creado_en              timestamptz,
  add column if not exists modificado_por_nombre  text,
  add column if not exists modificado_en          timestamptz;

update public."InventarioFisico"
   set creado_en = coalesce(creado_en, timestamptz '2026-09-02 00:00:00-05'),
       creado_por_nombre = coalesce(
         nullif(btrim(creado_por_nombre), ''),
         (select coalesce(nullif(btrim(u.nombre), ''), u.email)
            from public.usuarios u where u.id = "InventarioFisico".creado_por),
         'Carga inicial'),
       modificado_por_nombre = coalesce(
         nullif(btrim(modificado_por_nombre), ''),
         (select coalesce(nullif(btrim(u.nombre), ''), u.email)
            from public.usuarios u where u.id = "InventarioFisico".modificado_por))
 where creado_en is null or creado_por_nombre is null
    or (modificado_por is not null and modificado_por_nombre is null);

drop trigger if exists trg_auditoria_row on public."InventarioFisico";
create trigger trg_auditoria_row
  before insert or update on public."InventarioFisico"
  for each row execute function public.set_auditoria_row();

-- ── 6. Refrescar el schema cache de PostgREST ───────────────────────
notify pgrst, 'reload schema';
