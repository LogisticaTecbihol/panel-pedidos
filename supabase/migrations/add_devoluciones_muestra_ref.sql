-- ============================================================
-- Migración: devolución de muestras (muestras no utilizadas que
-- regresan a Productos Buenos de la empresa)
--
-- Una muestra despachada (SolicitudMuestras.Cant_Entregada + Remision)
-- genera una SALIDA "Muestras" en el Kardex. Si la muestra no se usó y
-- vuelve a bodega, se registra como una fila de "Devoluciones" ya
-- tramitada (Bodega_Ingreso = 'Productos Buenos', Remision_Ingreso RE),
-- que kardex.js / existencias.js ya cuentan como ENTRADA de la empresa
-- sin ningún cambio de código. Esta migración solo agrega el vínculo:
--
--   Devoluciones.Muestra_Id   -> id de la LÍNEA de SolicitudMuestras
--                                (vínculo exacto; el Consecutivo no es
--                                único por empresa en otros módulos).
--   Devoluciones.Muestra_Ref  -> "<Empresa completa> Muestra #<Consec.>"
--                                (mismo formato que Reenvases.Muestra_Ref).
--
-- Candados (mismo criterio que guard_entregas_no_exceden_pedido.sql):
--   1) BEFORE INSERT/UPDATE en "Devoluciones": lo devuelto de una línea de
--      muestra (suma de devoluciones no anuladas, incluidas las parciales)
--      nunca supera lo despachado (Cant_Entregada). Bloquea la fila de la
--      muestra con FOR UPDATE para serializar dos registros simultáneos.
--   2) BEFORE UPDATE/DELETE en "SolicitudMuestras": no se puede bajar
--      Cant_Entregada por debajo de lo ya devuelto ni borrar una línea que
--      tiene devoluciones activas.
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase.
-- Fecha: 2026-09-18
-- ============================================================

ALTER TABLE public."Devoluciones"
  ADD COLUMN IF NOT EXISTS "Muestra_Id"  bigint
    REFERENCES public."SolicitudMuestras"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "Muestra_Ref" text DEFAULT ''::text;

CREATE INDEX IF NOT EXISTS idx_devoluciones_muestra_id
  ON public."Devoluciones" ("Muestra_Id")
  WHERE "Muestra_Id" IS NOT NULL;


-- ── 1) "Devoluciones": lo devuelto nunca supera lo despachado ──
CREATE OR REPLACE FUNCTION public.fn_devoluciones_no_sobre_muestra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_desp  numeric;
  v_otras numeric;
  v_new   numeric := COALESCE(NEW."Cant_Entregada", 0);
  v_prod  text;
BEGIN
  IF NEW."Muestra_Id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF lower(COALESCE(NEW."Estado", '')) = 'anulado' THEN
    RETURN NEW;
  END IF;

  -- Bloquea la línea de la muestra: dos registros simultáneos se serializan.
  SELECT COALESCE("Cant_Entregada", 0), "Producto"
    INTO v_desp, v_prod
    FROM public."SolicitudMuestras"
   WHERE id = NEW."Muestra_Id"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La línea de muestra % no existe.', NEW."Muestra_Id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT COALESCE(SUM(COALESCE("Cant_Entregada", 0)), 0)
    INTO v_otras
    FROM public."Devoluciones"
   WHERE "Muestra_Id" = NEW."Muestra_Id"
     AND "id" IS DISTINCT FROM NEW."id"
     AND lower(COALESCE("Estado", '')) <> 'anulado';

  IF v_otras + v_new > v_desp + 0.001 THEN
    RAISE EXCEPTION
      'No se puede devolver % de "%": se despacharon % y ya se han devuelto %.',
      v_new, COALESCE(v_prod, '?'), v_desp, v_otras
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_devoluciones_no_sobre_muestra ON public."Devoluciones";
CREATE TRIGGER trg_devoluciones_no_sobre_muestra
  BEFORE INSERT OR UPDATE ON public."Devoluciones"
  FOR EACH ROW EXECUTE FUNCTION public.fn_devoluciones_no_sobre_muestra();

REVOKE ALL ON FUNCTION public.fn_devoluciones_no_sobre_muestra() FROM public, anon, authenticated;


-- ── 2) "SolicitudMuestras": no bajar lo entregado por debajo de lo devuelto,
--       ni borrar una línea con devoluciones activas ──
CREATE OR REPLACE FUNCTION public.fn_muestras_no_bajo_devuelto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dev numeric;
  v_id  bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
BEGIN
  SELECT COALESCE(SUM(COALESCE("Cant_Entregada", 0)), 0)
    INTO v_dev
    FROM public."Devoluciones"
   WHERE "Muestra_Id" = v_id
     AND lower(COALESCE("Estado", '')) <> 'anulado';

  IF v_dev <= 0 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'No se puede eliminar la línea de muestra % ("%"): tiene % unidades devueltas. Elimina primero esas devoluciones.',
      OLD.id, COALESCE(OLD."Producto", '?'), v_dev
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF COALESCE(NEW."Cant_Entregada", 0) < v_dev - 0.001 THEN
    RAISE EXCEPTION
      'No se puede dejar "%" con % entregadas: ya se devolvieron % unidades de esa línea.',
      COALESCE(NEW."Producto", '?'), COALESCE(NEW."Cant_Entregada", 0), v_dev
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_muestras_no_bajo_devuelto_upd ON public."SolicitudMuestras";
CREATE TRIGGER trg_muestras_no_bajo_devuelto_upd
  BEFORE UPDATE OF "Cant_Entregada" ON public."SolicitudMuestras"
  FOR EACH ROW EXECUTE FUNCTION public.fn_muestras_no_bajo_devuelto();

DROP TRIGGER IF EXISTS trg_muestras_no_bajo_devuelto_del ON public."SolicitudMuestras";
CREATE TRIGGER trg_muestras_no_bajo_devuelto_del
  BEFORE DELETE ON public."SolicitudMuestras"
  FOR EACH ROW EXECUTE FUNCTION public.fn_muestras_no_bajo_devuelto();

REVOKE ALL ON FUNCTION public.fn_muestras_no_bajo_devuelto() FROM public, anon, authenticated;


-- Refrescar la caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración add_devoluciones_muestra_ref
-- ============================================================
