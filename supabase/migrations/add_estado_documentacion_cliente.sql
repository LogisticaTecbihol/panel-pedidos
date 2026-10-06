-- ============================================================
-- Estado de documentación de cartera en ClientesUnicos.
--
-- Revisión de los documentos de cartera del cliente (RUT, Cámara de
-- Comercio, etc.). Valores:
--   'Sin revisar'                 (por defecto, nunca calificado)
--   'Completa y vigente'          documentación requerida y actualizada
--   'Incompleta'                  falta uno o varios documentos
--   'Desactualizada'              completa, pero algún documento requiere actualización
--   'Incompleta y desactualizada' faltan documentos y otros requieren actualización
-- + Observaciones_Documentacion: texto libre (qué falta / qué está vencido).
--
-- A diferencia del Estado (por empresa), la documentación es UNA por cliente
-- unificado (mismo NIT, vía nit_normalizado()): al cambiarla en un registro
-- se replica a todos los registros con el mismo NIT, y los registros nuevos
-- (sede nueva, asignar a otra empresa, alta desde pedido, importación)
-- heredan la de sus hermanos.
--
-- Solo admin/editor/cartera pueden cambiarla (mismo candado que
-- Observaciones_Cartera). Se edita en clientes.html y se ve en cartera.html.
--
-- Fecha: 2026-10-06
-- ============================================================

-- ── 1. Columnas ──
ALTER TABLE public."ClientesUnicos"
  ADD COLUMN IF NOT EXISTS "Estado_Documentacion" text NOT NULL DEFAULT 'Sin revisar',
  ADD COLUMN IF NOT EXISTS "Observaciones_Documentacion" text NOT NULL DEFAULT '';

ALTER TABLE public."ClientesUnicos"
  DROP CONSTRAINT IF EXISTS "ClientesUnicos_estado_documentacion_chk";
ALTER TABLE public."ClientesUnicos"
  ADD CONSTRAINT "ClientesUnicos_estado_documentacion_chk"
  CHECK ("Estado_Documentacion" IN ('Sin revisar','Completa y vigente','Incompleta','Desactualizada','Incompleta y desactualizada'));

-- ── 2. BEFORE: candado de rol + herencia al insertar ──
CREATE OR REPLACE FUNCTION public.guard_documentacion_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text := get_user_role();
  v_priv boolean := (v_rol IS NULL OR v_rol IN ('admin','editor','cartera'));
  v_nit text;
  v_est text;
  v_obs text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- pg_trigger_depth() > 1 = réplica hecha por sync_documentacion_cliente.
    IF NOT v_priv AND pg_trigger_depth() = 1
       AND (NEW."Estado_Documentacion" IS DISTINCT FROM OLD."Estado_Documentacion"
            OR NEW."Observaciones_Documentacion" IS DISTINCT FROM OLD."Observaciones_Documentacion")
    THEN
      RAISE EXCEPTION 'Solo Cartera, edición o administración pueden cambiar el estado de documentación de un cliente';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NOT v_priv THEN
    NEW."Estado_Documentacion" := 'Sin revisar';
    NEW."Observaciones_Documentacion" := '';
  END IF;
  IF COALESCE(NEW."Estado_Documentacion", 'Sin revisar') = 'Sin revisar'
     AND COALESCE(NEW."Observaciones_Documentacion", '') = '' THEN
    v_nit := public.nit_normalizado(NEW."Identificacion");
    IF v_nit <> '' THEN
      SELECT cu."Estado_Documentacion", cu."Observaciones_Documentacion"
        INTO v_est, v_obs
      FROM public."ClientesUnicos" cu
      WHERE public.nit_normalizado(cu."Identificacion") = v_nit
      ORDER BY (cu."Estado_Documentacion" = 'Sin revisar'), cu.modificado_en DESC NULLS LAST
      LIMIT 1;
      IF FOUND THEN
        NEW."Estado_Documentacion" := v_est;
        NEW."Observaciones_Documentacion" := COALESCE(v_obs, '');
      END IF;
    END IF;
  END IF;
  NEW."Estado_Documentacion" := COALESCE(NEW."Estado_Documentacion", 'Sin revisar');
  NEW."Observaciones_Documentacion" := COALESCE(NEW."Observaciones_Documentacion", '');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_documentacion_cliente ON public."ClientesUnicos";
CREATE TRIGGER trg_guard_documentacion_cliente
  BEFORE INSERT OR UPDATE ON public."ClientesUnicos"
  FOR EACH ROW EXECUTE FUNCTION public.guard_documentacion_cliente();

-- ── 3. AFTER: replicar a los registros con el mismo NIT ──
CREATE OR REPLACE FUNCTION public.sync_documentacion_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nit text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW."Estado_Documentacion" IS NOT DISTINCT FROM OLD."Estado_Documentacion"
     AND NEW."Observaciones_Documentacion" IS NOT DISTINCT FROM OLD."Observaciones_Documentacion" THEN
    RETURN NULL;
  END IF;
  v_nit := public.nit_normalizado(NEW."Identificacion");
  IF v_nit = '' THEN RETURN NULL; END IF;

  UPDATE public."ClientesUnicos" cu
     SET "Estado_Documentacion" = NEW."Estado_Documentacion",
         "Observaciones_Documentacion" = NEW."Observaciones_Documentacion"
   WHERE cu.id <> NEW.id
     AND public.nit_normalizado(cu."Identificacion") = v_nit
     AND (cu."Estado_Documentacion" IS DISTINCT FROM NEW."Estado_Documentacion"
          OR cu."Observaciones_Documentacion" IS DISTINCT FROM NEW."Observaciones_Documentacion");
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_documentacion_cliente ON public."ClientesUnicos";
CREATE TRIGGER trg_sync_documentacion_cliente
  AFTER INSERT OR UPDATE OF "Estado_Documentacion", "Observaciones_Documentacion" ON public."ClientesUnicos"
  FOR EACH ROW EXECUTE FUNCTION public.sync_documentacion_cliente();

REVOKE ALL ON FUNCTION public.guard_documentacion_cliente() FROM public, anon;
REVOKE ALL ON FUNCTION public.sync_documentacion_cliente() FROM public, anon;

-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración add_estado_documentacion_cliente
-- ============================================================
