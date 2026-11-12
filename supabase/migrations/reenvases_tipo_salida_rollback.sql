-- ============================================================
-- Rollback de reenvases_tipo_salida.sql
-- Quita los triggers, las funciones, el CHECK y la columna "Tipo_Salida", y devuelve
-- _ingreso_tipo_sugerido a su versión de ingresos_tipo_ingreso.sql (cualquier ingreso vinculado a
-- una salida cuenta como REENVASE). NO deshace los ingresos que ya se reclasificaron como
-- REFORMULACION: si hace falta, se corrigen a mano o con un UPDATE.
-- Publicar el JS anterior ANTES de ejecutarlo: el nuevo pide la columna.
-- ============================================================

DROP TRIGGER IF EXISTS trg_reenvases_tipo_a_ingresos ON public."Reenvases";
DROP TRIGGER IF EXISTS trg_reenvases_tipo_defecto ON public."Reenvases";

-- La función de Ingresos deja de leer "Reenvases" ANTES de borrar la columna.
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

DROP FUNCTION IF EXISTS public.fn_reenvases_tipo_a_ingresos();
DROP FUNCTION IF EXISTS public.fn_reenvases_tipo_defecto();
DROP FUNCTION IF EXISTS public._reenvase_tipo_sugerido(text, text, text, text);
ALTER TABLE public."Reenvases" DROP CONSTRAINT IF EXISTS reenvases_tipo_salida_check;
ALTER TABLE public."Reenvases" DROP COLUMN IF EXISTS "Tipo_Salida";

NOTIFY pgrst, 'reload schema';
