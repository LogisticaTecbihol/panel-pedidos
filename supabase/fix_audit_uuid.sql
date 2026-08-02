-- ============================================================
-- FIX: fn_audit_log fallaba en tablas con PK UUID (usuarios)
-- Cambia registro_id de BIGINT a TEXT para soportar ambos tipos.
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

ALTER TABLE audit_log ALTER COLUMN registro_id TYPE TEXT USING registro_id::text;

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    v_old := v_old - 'creado_por' - 'creado_en' - 'modificado_por' - 'modificado_en';

    INSERT INTO audit_log (tabla, accion, registro_id, usuario_id, usuario_email, datos_antes)
    VALUES (TG_TABLE_NAME, 'DELETE', v_registro_id, v_user_id, v_user_email, v_old);

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_registro_id := NEW.id::text;
    v_new := v_new - 'creado_por' - 'creado_en' - 'modificado_por' - 'modificado_en';

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
      IF v_key IN ('creado_por','creado_en','modificado_por','modificado_en') THEN
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
$$;

DROP FUNCTION IF EXISTS get_audit_history(TEXT, BIGINT);

CREATE OR REPLACE FUNCTION get_audit_history(
  p_tabla TEXT,
  p_registro_id TEXT
) RETURNS TABLE (
  accion TEXT,
  usuario_email TEXT,
  datos_antes JSONB,
  datos_despues JSONB,
  fecha TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT accion, usuario_email, datos_antes, datos_despues, created_at
  FROM audit_log
  WHERE tabla = p_tabla AND registro_id = p_registro_id
  ORDER BY created_at DESC;
$$;
