-- Trazabilidad en el maestro ClientesUnicos: quién y cuándo creó / modificó
-- cada registro.
--
-- · 6 columnas nuevas. El UUID (creado_por / modificado_por) es la traza dura;
--   el nombre desnormalizado (creado_por_nombre / modificado_por_nombre) es
--   para mostrarlo en el panel sin chocar con la RLS de 'usuarios' (que solo
--   deja a un usuario ver su propio registro, salvo admin).
-- · Un trigger BEFORE INSERT/UPDATE las llena solo -> cubre los 6 caminos que
--   escriben en la tabla: alta manual de cliente, edición, cambio de estado
--   masivo (setEstadoClientes), importar Excel, "reemplazar empresa" y el alta
--   automática desde un pedido (registrar_cliente_nuevo_desde_pedido).
-- · Se conecta además al sistema audit_log (panel Auditoría), igual que Pedidos.
-- · Los 1808 registros previos quedan marcados "Carga inicial".
--
-- Se muestra en clientes.html -> modal "Detalle del Cliente".
-- Ver [[reference_agregar_modulo]] no aplica; esto es solo esquema + UI.

-- ── 1. Columnas ───────────────────────────────────────────────────────
-- Sin DEFAULT en creado_en: el trigger y el backfill lo controlan, así el
-- ADD COLUMN no reescribe la tabla entera.
alter table public."ClientesUnicos"
  add column if not exists creado_por             uuid references auth.users(id),
  add column if not exists creado_por_nombre      text,
  add column if not exists creado_en              timestamptz,
  add column if not exists modificado_por         uuid references auth.users(id),
  add column if not exists modificado_por_nombre  text,
  add column if not exists modificado_en          timestamptz;

-- ── 2. Backfill de registros previos (antes de crear los triggers) ─────
update public."ClientesUnicos"
   set creado_en         = coalesce(creado_en, timestamptz '2026-09-02 00:00:00-05'),
       creado_por_nombre = coalesce(nullif(btrim(creado_por_nombre), ''), 'Carga inicial')
 where creado_por is null
   and (creado_por_nombre is null or btrim(creado_por_nombre) = '');

-- ── 3. Trigger que llena las columnas de auditoría ────────────────────
create or replace function public.set_auditoria_clientes_unicos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_nombre text;
begin
  if v_uid is not null then
    select coalesce(nullif(btrim(u.nombre), ''), u.email)
      into v_nombre
      from public.usuarios u
     where u.id = v_uid;
  end if;

  if tg_op = 'INSERT' then
    -- Respeta valores explícitos (útil para migraciones/seeds); por defecto,
    -- el actor de la sesión.
    new.creado_por            := coalesce(new.creado_por, v_uid);
    new.creado_por_nombre     := coalesce(nullif(btrim(new.creado_por_nombre), ''), v_nombre);
    new.creado_en             := coalesce(new.creado_en, now());
    new.modificado_por        := null;
    new.modificado_por_nombre := null;
    new.modificado_en         := null;
    return new;
  end if;

  -- UPDATE: creado_* es inmutable. modificado_* solo se toca si cambió algún
  -- campo real (no un "guardar" sin cambios) -> queda consistente con audit_log.
  new.creado_por        := old.creado_por;
  new.creado_por_nombre := old.creado_por_nombre;
  new.creado_en         := old.creado_en;

  if (to_jsonb(new) - 'creado_por' - 'creado_por_nombre' - 'creado_en'
                    - 'modificado_por' - 'modificado_por_nombre' - 'modificado_en')
     is distinct from
     (to_jsonb(old) - 'creado_por' - 'creado_por_nombre' - 'creado_en'
                    - 'modificado_por' - 'modificado_por_nombre' - 'modificado_en')
  then
    new.modificado_por        := v_uid;
    new.modificado_por_nombre := v_nombre;
    new.modificado_en         := now();
  else
    new.modificado_por        := old.modificado_por;
    new.modificado_por_nombre := old.modificado_por_nombre;
    new.modificado_en         := old.modificado_en;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auditoria_clientes_unicos on public."ClientesUnicos";
create trigger trg_auditoria_clientes_unicos
  before insert or update on public."ClientesUnicos"
  for each row execute function public.set_auditoria_clientes_unicos();

-- ── 4. Conectar ClientesUnicos al panel Auditoría (audit_log) ─────────
-- fn_audit_log ya excluye del snapshot las columnas de auditoría; se agregan
-- las dos nuevas (*_nombre) para no ensuciar el diff. La función la comparten
-- 12 tablas: agregar claves a la lista de exclusión es inocuo para las demás.
create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_old JSONB;
  v_new JSONB;
  v_registro_id TEXT;
  v_changed JSONB;
  v_key TEXT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email
    FROM usuarios WHERE id = v_user_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_registro_id := OLD.id::text;
    v_old := v_old - 'creado_por' - 'creado_en' - 'modificado_por' - 'modificado_en'
                   - 'creado_por_nombre' - 'modificado_por_nombre';

    INSERT INTO audit_log (tabla, accion, registro_id, usuario_id, usuario_email, datos_antes)
    VALUES (TG_TABLE_NAME, 'DELETE', v_registro_id, v_user_id, v_user_email, v_old);

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_registro_id := NEW.id::text;
    v_new := v_new - 'creado_por' - 'creado_en' - 'modificado_por' - 'modificado_en'
                   - 'creado_por_nombre' - 'modificado_por_nombre';

    INSERT INTO audit_log (tabla, accion, registro_id, usuario_id, usuario_email, datos_despues)
    VALUES (TG_TABLE_NAME, 'INSERT', v_registro_id, v_user_id, v_user_email, v_new);

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_registro_id := NEW.id::text;

    v_changed := '{}'::jsonb;
    FOR v_key IN SELECT jsonb_object_keys(v_new)
    LOOP
      IF v_key IN ('creado_por','creado_en','modificado_por','modificado_en',
                   'creado_por_nombre','modificado_por_nombre') THEN
        CONTINUE;
      END IF;
      IF (v_old->v_key)::text IS DISTINCT FROM (v_new->v_key)::text THEN
        v_changed := v_changed || jsonb_build_object(v_key, v_new->v_key);
      END IF;
    END LOOP;

    IF v_changed = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    v_old := '{}'::jsonb;
    FOR v_key IN SELECT jsonb_object_keys(v_changed)
    LOOP
      v_old := v_old || jsonb_build_object(v_key, to_jsonb(OLD)->v_key);
    END LOOP;

    INSERT INTO audit_log (tabla, accion, registro_id, usuario_id, usuario_email, datos_antes, datos_despues)
    VALUES (TG_TABLE_NAME, 'UPDATE', v_registro_id, v_user_id, v_user_email, v_old, v_changed);

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$function$;

drop trigger if exists trg_audit_log on public."ClientesUnicos";
create trigger trg_audit_log
  after insert or update or delete on public."ClientesUnicos"
  for each row execute function public.fn_audit_log();
