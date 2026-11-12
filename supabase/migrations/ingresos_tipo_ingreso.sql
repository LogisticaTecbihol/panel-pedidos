-- ============================================================
-- Ingresos: «Tipo de ingreso»
--
-- Hasta ahora la pantalla de Ingresos solo tenía «Origen» (planta, proveedor
-- o texto libre) y no distinguía lo realmente fabricado de lo que entra por
-- otras vías. Esta migración agrega el tipo como dato propio:
--
--   FABRICADO       producción de una planta propia (Mosquera / Cachipay)
--   PT_PROVEEDOR    producto terminado de un proveedor (Carval, Chia Abago,
--                   Germisemillas, Bodega Villeta)
--   REENVASE        retorno de una salida a producción (Reenvase_Ref) o
--                   entrada de reenvase / reembase de la planta
--   REFORMULACION   entrada de reformulación de la planta
--   BIDONES_USADOS  bidones usados que llegan de la planta
--   GRANEL          cualquier ingreso con destino GRANEL
--   OTROS           todo lo demás (Ecociclus, personas, bodegas, retornos…)
--
-- Piezas:
--   1. Columna "Tipo_Ingreso" (text, NOT NULL, default '').
--   2. _ingreso_tipo_sugerido(...): las reglas, en un solo lugar de la BD.
--      La pantalla (js/ingresos.js, ingTipoSugerido) tiene una copia SIN el
--      texto de Observaciones, solo para proponer el valor en el formulario:
--      si cambias una regla de origen/destino, cámbiala en las dos.
--   3. Trigger BEFORE INSERT / UPDATE OF "Tipo_Ingreso": si llega vacío (una
--      pestaña con el JS anterior, otro camino de escritura), lo deduce con
--      las mismas reglas. Así nunca queda un ingreso sin tipo.
--   4. Relleno de lo ya guardado POR INGRESO (mismas columnas que agrupa
--      js/ingresos.js: fecha, origen, empresas, responsable, remisiones y
--      referencia de reenvase), mirando las Observaciones de todas sus
--      líneas, para que las líneas de un mismo ingreso queden con el mismo
--      tipo. Es un relleno mecánico (no lo hizo ningún usuario), así que se
--      apagan los triggers de auditoría para no registrar «modificaciones»
--      falsas ni tocar modificado_en / modificado_por.
--   5. CHECK con los siete valores válidos.
--
-- Los tipos deducidos por texto (reenvase, reformulación, bidones usados)
-- son una sugerencia sobre datos de texto libre: se pueden corregir
-- editando el ingreso (campo «Tipo de ingreso»).
--
-- Aplicar con apply_migration (MCP) ANTES de publicar el JS nuevo (los
-- select y los insert de ingresos.js / shared.js ya usan la columna).
-- Rollback: ingresos_tipo_ingreso_rollback.sql
-- ============================================================

-- ── 1. Columna ──
ALTER TABLE public."Ingresos"
  ADD COLUMN IF NOT EXISTS "Tipo_Ingreso" text NOT NULL DEFAULT '';

COMMENT ON COLUMN public."Ingresos"."Tipo_Ingreso" IS
  'Tipo de ingreso: FABRICADO, PT_PROVEEDOR, REENVASE, REFORMULACION, BIDONES_USADOS, GRANEL u OTROS. Se repite en todas las líneas del ingreso.';

-- ── 2. Reglas de clasificación ──
-- Orden (la primera que aplica gana):
--   1) con vínculo a una salida a producción        → REENVASE
--   2) destino GRANEL                               → GRANEL
--   3) planta + «bidones usados» en las notas       → BIDONES_USADOS
--   4) planta + «reformulación» en las notas        → REFORMULACION
--   5) planta + reenvase / reembase / reempaque     → REENVASE
--   6) cualquier otra entrada de planta             → FABRICADO
--   7) origen proveedor de producto terminado       → PT_PROVEEDOR
--   8) el resto                                     → OTROS
-- Las reglas por texto (3 a 5) solo miran orígenes de planta.
CREATE OR REPLACE FUNCTION public._ingreso_tipo_sugerido(
  p_origen text,
  p_empresa_destino text,
  p_reenvase_ref text,
  p_observaciones text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_reenvase_ref, '')) <> ''
      THEN 'REENVASE'
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

-- ── 3. Valor por defecto al insertar ──
CREATE OR REPLACE FUNCTION public.fn_ingresos_tipo_defecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF btrim(coalesce(NEW."Tipo_Ingreso", '')) = '' THEN
    NEW."Tipo_Ingreso" := public._ingreso_tipo_sugerido(
      NEW."Origen", NEW."Empresa_Destino", NEW."Reenvase_Ref", NEW."Observaciones");
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ingresos_tipo_defecto ON public."Ingresos";
CREATE TRIGGER trg_ingresos_tipo_defecto
  BEFORE INSERT OR UPDATE OF "Tipo_Ingreso" ON public."Ingresos"
  FOR EACH ROW EXECUTE FUNCTION public.fn_ingresos_tipo_defecto();

-- Ninguna de las dos es para llamarse desde el navegador.
REVOKE ALL ON FUNCTION public._ingreso_tipo_sugerido(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ingresos_tipo_defecto() FROM PUBLIC, anon, authenticated;

-- ── 4. Relleno de lo ya guardado (por ingreso, no por línea) ──
ALTER TABLE public."Ingresos" DISABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."Ingresos" DISABLE TRIGGER trg_audit_log;

WITH t AS (
  SELECT id,
         public._ingreso_tipo_sugerido(
           "Origen", "Empresa_Destino", "Reenvase_Ref",
           string_agg(coalesce("Observaciones", ''), ' ') OVER (
             PARTITION BY coalesce("Fecha", ''), coalesce("Origen", ''),
                          coalesce("Empresa_Origen", ''), coalesce("Empresa_Destino", ''),
                          coalesce("Responsable", ''), coalesce("Remision_Origen", ''),
                          coalesce("Remision_Destino", ''), coalesce("Reenvase_Ref", ''))
         ) AS tipo
    FROM public."Ingresos"
)
UPDATE public."Ingresos" i
   SET "Tipo_Ingreso" = t.tipo
  FROM t
 WHERE t.id = i.id
   AND i."Tipo_Ingreso" = '';

ALTER TABLE public."Ingresos" ENABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."Ingresos" ENABLE TRIGGER trg_audit_log;

-- ── 5. Solo los siete valores ──
ALTER TABLE public."Ingresos" DROP CONSTRAINT IF EXISTS ingresos_tipo_ingreso_check;
ALTER TABLE public."Ingresos"
  ADD CONSTRAINT ingresos_tipo_ingreso_check
  CHECK ("Tipo_Ingreso" IN ('FABRICADO', 'PT_PROVEEDOR', 'REENVASE', 'REFORMULACION',
                            'BIDONES_USADOS', 'GRANEL', 'OTROS'));

-- ── 6. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
