-- ============================================================
-- Salidas a producción: «Tipo de salida»
--
-- La pantalla de Salidas a producción (tabla "Reenvases") mezclaba todo lo que
-- sale hacia una planta (o hacia otra empresa) sin decir para qué. Esta
-- migración agrega el tipo como dato propio, igual que Ingresos (ver
-- ingresos_tipo_ingreso.sql):
--
--   REENVASE             reenvase / reembase / reempaque (a litro, galón, dosis, bidón…)
--   REETIQUETADO         cambio de etiqueta, reetiquetado, cambio de tapa
--   REFORMULACION        salida a reformulación (p. ej. por calidad, desde no conformes)
--   MUESTRAS             orden de producción de muestras (Muestra_Ref) o pruebas / laboratorio
--   TRASLADO_DEVOLUCION  traslado o devolución entre empresas (sin planta, con empresa destino)
--   OTROS                cualquier otra salida con nota (baja, materia prima, pago en producto…)
--   SIN_CLASIFICAR       histórico sin nota: no se sabe para qué fue; se clasifica a mano
--                        desde el detalle de la salida. Las salidas nuevas siempre exigen tipo.
--
-- Piezas:
--   1. Columna "Tipo_Salida" (text, NOT NULL, default '').
--   2. _reenvase_tipo_sugerido(...): las reglas, en un solo lugar de la BD. Se leen las
--      Observaciones de TODAS las líneas de la salida (cada línea trae su propia nota).
--      La pantalla (js/reenvases.js, reTipoSugerido) solo propone lo que no depende de texto.
--   3. Trigger BEFORE INSERT / UPDATE OF "Tipo_Salida": si llega vacío (pestaña con el JS
--      anterior) hereda el tipo de otra línea de la misma salida (Remision + Empresa) o lo deduce.
--   4. Relleno del histórico POR SALIDA (Remision + Empresa), con los triggers de auditoría
--      apagados (relleno mecánico: no genera «modificaciones» falsas).
--   5. CHECK con los siete valores.
--   6. HERENCIA hacia Ingresos: un ingreso que regresa de una salida (Reenvase_Ref = Remision)
--      toma su tipo de ella: salida REFORMULACION → ingreso REFORMULACION; cualquier otra
--      (reenvase, reetiquetado, muestras, sin clasificar…) → ingreso REENVASE. Para eso se
--      redefine _ingreso_tipo_sugerido (de ingresos_tipo_ingreso.sql; ahora STABLE porque lee
--      "Reenvases"), se corrigen los ingresos ya vinculados a una reformulación (con la
--      auditoría apagada) y un trigger AFTER UPDATE OF "Tipo_Salida" mantiene la herencia:
--      al cambiar el tipo de una salida, sus ingresos de retorno pasan de REENVASE a
--      REFORMULACION (o al revés) SOLO si seguían con el tipo heredado antes del cambio; los
--      que alguien ya corrigió a mano no se tocan.
--
-- Aplicar con apply_migration (MCP) ANTES de publicar el JS nuevo (reenvases.js, ingresos.js
-- y shared.js ya usan la columna).
-- Rollback: reenvases_tipo_salida_rollback.sql
-- ============================================================

-- ── 1. Columna ──
ALTER TABLE public."Reenvases"
  ADD COLUMN IF NOT EXISTS "Tipo_Salida" text NOT NULL DEFAULT '';

COMMENT ON COLUMN public."Reenvases"."Tipo_Salida" IS
  'Tipo de salida: REENVASE, REETIQUETADO, REFORMULACION, MUESTRAS, TRASLADO_DEVOLUCION, OTROS o SIN_CLASIFICAR (histórico sin nota). Se repite en todas las líneas de la salida.';

-- ── 2. Reglas de clasificación (la primera que aplica gana) ──
--   1) con Muestra_Ref (orden de producción de muestras)  → MUESTRAS
--   2) notas con «reformul»                                → REFORMULACION
--   3) notas con reenvase / reembase / reemvase / reempaque → REENVASE
--   4) notas con «etiquet» o «tapa»                        → REETIQUETADO
--   5) notas con «muestra», «prueba» o «laborator»         → MUESTRAS
--   6) notas con devolución / traslado / reintegro / préstamo → TRASLADO_DEVOLUCION
--   7) sin planta y con empresa destino (traslado entre empresas) → TRASLADO_DEVOLUCION
--   8) sin ninguna nota                                    → SIN_CLASIFICAR
--   9) el resto                                            → OTROS
CREATE OR REPLACE FUNCTION public._reenvase_tipo_sugerido(
  p_planta text,
  p_empresa_destino text,
  p_muestra_ref text,
  p_observaciones text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_muestra_ref, '')) <> ''
      THEN 'MUESTRAS'
    WHEN coalesce(p_observaciones, '') ~* 'reformul|rformul'
      THEN 'REFORMULACION'
    WHEN coalesce(p_observaciones, '') ~* 'ree+(nv|mb|mv)as|reempa[cq]'
      THEN 'REENVASE'
    WHEN coalesce(p_observaciones, '') ~* 'etiquet|tapa'
      THEN 'REETIQUETADO'
    WHEN coalesce(p_observaciones, '') ~* 'muestra|prueba|laborator'
      THEN 'MUESTRAS'
    WHEN coalesce(p_observaciones, '') ~* 'devol|traslad|reintegro|pr[eé]stamo'
      THEN 'TRASLADO_DEVOLUCION'
    WHEN btrim(coalesce(p_planta, '')) = '' AND btrim(coalesce(p_empresa_destino, '')) <> ''
      THEN 'TRASLADO_DEVOLUCION'
    WHEN btrim(coalesce(p_observaciones, '')) = ''
      THEN 'SIN_CLASIFICAR'
    ELSE 'OTROS'
  END
$$;

-- ── 3. Valor por defecto al insertar ──
CREATE OR REPLACE FUNCTION public.fn_reenvases_tipo_defecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF btrim(coalesce(NEW."Tipo_Salida", '')) = '' THEN
    -- Otra línea de la misma salida ya tiene tipo: se hereda (una salida = un tipo).
    IF btrim(coalesce(NEW."Remision", '')) <> '' THEN
      SELECT r."Tipo_Salida" INTO v_tipo
        FROM public."Reenvases" r
       WHERE r."Remision" = NEW."Remision"
         AND r."Empresa" = NEW."Empresa"
         AND r."Tipo_Salida" <> ''
         AND r.id IS DISTINCT FROM NEW.id
       LIMIT 1;
    END IF;
    NEW."Tipo_Salida" := coalesce(v_tipo, public._reenvase_tipo_sugerido(
      NEW."Planta", NEW."Empresa_Destino", NEW."Muestra_Ref", NEW."Observaciones"));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reenvases_tipo_defecto ON public."Reenvases";
CREATE TRIGGER trg_reenvases_tipo_defecto
  BEFORE INSERT OR UPDATE OF "Tipo_Salida" ON public."Reenvases"
  FOR EACH ROW EXECUTE FUNCTION public.fn_reenvases_tipo_defecto();

-- ── 4. Relleno de lo ya guardado (por salida: Remision + Empresa) ──
ALTER TABLE public."Reenvases" DISABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."Reenvases" DISABLE TRIGGER trg_audit_log;

WITH t AS (
  SELECT id,
         public._reenvase_tipo_sugerido(
           max(coalesce("Planta", '')) OVER w,
           max(coalesce("Empresa_Destino", '')) OVER w,
           max(coalesce("Muestra_Ref", '')) OVER w,
           string_agg(coalesce("Observaciones", ''), ' ') OVER w
         ) AS tipo
    FROM public."Reenvases"
  WINDOW w AS (
    PARTITION BY coalesce(nullif(btrim("Remision"), ''),
                          'sin|' || coalesce("Fecha", '') || '|' || coalesce("Planta", '')),
                 coalesce("Empresa", '')
  )
)
UPDATE public."Reenvases" r
   SET "Tipo_Salida" = t.tipo
  FROM t
 WHERE t.id = r.id
   AND r."Tipo_Salida" = '';

ALTER TABLE public."Reenvases" ENABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."Reenvases" ENABLE TRIGGER trg_audit_log;

-- ── 5. Solo los siete valores ──
ALTER TABLE public."Reenvases" DROP CONSTRAINT IF EXISTS reenvases_tipo_salida_check;
ALTER TABLE public."Reenvases"
  ADD CONSTRAINT reenvases_tipo_salida_check
  CHECK ("Tipo_Salida" IN ('REENVASE', 'REETIQUETADO', 'REFORMULACION', 'MUESTRAS',
                           'TRASLADO_DEVOLUCION', 'OTROS', 'SIN_CLASIFICAR'));

-- ── 6. Herencia hacia Ingresos ──
-- 6a. Regla de Ingresos: con vínculo a una salida, REFORMULACION si la salida lo es; si no, REENVASE.
--     (Igual que ingresos_tipo_ingreso.sql salvo la primera rama, y STABLE porque lee "Reenvases".)
CREATE OR REPLACE FUNCTION public._ingreso_tipo_sugerido(
  p_origen text,
  p_empresa_destino text,
  p_reenvase_ref text,
  p_observaciones text
) RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_reenvase_ref, '')) <> '' THEN
      CASE WHEN EXISTS (
             SELECT 1 FROM public."Reenvases" r
              WHERE r."Remision" = btrim(p_reenvase_ref)
                AND r."Tipo_Salida" = 'REFORMULACION')
           THEN 'REFORMULACION' ELSE 'REENVASE' END
    WHEN upper(btrim(coalesce(p_empresa_destino, ''))) = 'GRANEL'
      THEN 'GRANEL'
    WHEN btrim(coalesce(p_origen, '')) ~* '^planta'
         AND coalesce(p_observaciones, '') ~* 'bid[oó]n(es)?\s+usad'
      THEN 'BIDONES_USADOS'
    WHEN btrim(coalesce(p_origen, '')) ~* '^planta'
         AND coalesce(p_observaciones, '') ~* 'reformul'
      THEN 'REFORMULACION'
    WHEN btrim(coalesce(p_origen, '')) ~* '^planta'
         AND coalesce(p_observaciones, '') ~* 'ree+(nv|mb)as|reempa[cq]'
      THEN 'REENVASE'
    WHEN btrim(coalesce(p_origen, '')) ~* '^planta'
      THEN 'FABRICADO'
    WHEN lower(btrim(coalesce(p_origen, ''))) IN
         ('proveedor carval', 'chia abago', 'germisemillas', 'bodega villeta')
      THEN 'PT_PROVEEDOR'
    ELSE 'OTROS'
  END
$$;

-- 6b. Ingresos ya vinculados a una salida de reformulación (relleno mecánico: sin auditoría).
ALTER TABLE public."Ingresos" DISABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."Ingresos" DISABLE TRIGGER trg_audit_log;

UPDATE public."Ingresos" i
   SET "Tipo_Ingreso" = 'REFORMULACION'
 WHERE btrim(coalesce(i."Reenvase_Ref", '')) <> ''
   AND i."Tipo_Ingreso" = 'REENVASE'
   AND EXISTS (SELECT 1 FROM public."Reenvases" r
                WHERE r."Remision" = btrim(i."Reenvase_Ref")
                  AND r."Tipo_Salida" = 'REFORMULACION');

ALTER TABLE public."Ingresos" ENABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."Ingresos" ENABLE TRIGGER trg_audit_log;

-- 6c. Mantener la herencia cuando cambia el tipo de una salida. Se crea DESPUÉS del relleno del
--     paso 4 para que este no la dispare.
CREATE OR REPLACE FUNCTION public.fn_reenvases_tipo_a_ingresos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF btrim(coalesce(NEW."Remision", '')) = '' THEN
    RETURN NEW;
  END IF;
  v_old := CASE WHEN OLD."Tipo_Salida" = 'REFORMULACION' THEN 'REFORMULACION' ELSE 'REENVASE' END;
  v_new := CASE WHEN NEW."Tipo_Salida" = 'REFORMULACION' THEN 'REFORMULACION' ELSE 'REENVASE' END;
  IF v_old <> v_new THEN
    UPDATE public."Ingresos"
       SET "Tipo_Ingreso" = v_new
     WHERE btrim("Reenvase_Ref") = btrim(NEW."Remision")
       AND "Tipo_Ingreso" = v_old;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reenvases_tipo_a_ingresos ON public."Reenvases";
CREATE TRIGGER trg_reenvases_tipo_a_ingresos
  AFTER UPDATE OF "Tipo_Salida" ON public."Reenvases"
  FOR EACH ROW
  WHEN (OLD."Tipo_Salida" IS DISTINCT FROM NEW."Tipo_Salida")
  EXECUTE FUNCTION public.fn_reenvases_tipo_a_ingresos();

-- Ninguna de estas funciones es para llamarse desde el navegador.
REVOKE ALL ON FUNCTION public._reenvase_tipo_sugerido(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reenvases_tipo_defecto() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reenvases_tipo_a_ingresos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ingreso_tipo_sugerido(text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── 7. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
