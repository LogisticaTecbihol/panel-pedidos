-- ============================================================
-- Excepción para PARCELAR: sus pedidos ya NO nacen 'Pendiente de
-- aprobación' aunque el cliente sea nuevo (sin pedidos previos en el
-- holding). Decisión del usuario (2026-09-24): quitar la exigencia de
-- aprobación previa de Cartera/administración solo para la empresa
-- PARCELAR DE COLOMBIA SAS; el resto de empresas del holding conserva
-- la regla tal cual (ver add_aprobacion_pedido_cliente_nuevo.sql y
-- fix_aprobacion_pedido_cliente_sin_pedidos_previos.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_pedido_pendiente_aprobacion_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nit text;
BEGIN
  IF COALESCE(NEW."Estado_2", 'Abierto') <> 'Abierto' THEN
    RETURN NEW;
  END IF;

  IF NEW."Nombre_Empresa" = 'PARCELAR DE COLOMBIA SAS' THEN
    RETURN NEW;
  END IF;

  -- (1) Línea nueva de un pedido que ya está pendiente: se une a él.
  IF EXISTS (
    SELECT 1 FROM "Pedidos" p
     WHERE p."Nombre_Empresa" = NEW."Nombre_Empresa"
       AND p."Consecutivo"    = NEW."Consecutivo"
       AND p."Cliente" IS NOT DISTINCT FROM NEW."Cliente"
       AND p."Estado_2" = 'Pendiente de aprobación'
  ) THEN
    NEW."Estado_2" := 'Pendiente de aprobación';
    RETURN NEW;
  END IF;

  -- (2) Primer registro de un pedido manual cuyo cliente (por NIT, en
  --     todo el holding) nunca ha tenido un pedido antes.
  IF NEW."Archivo_Fuente" = 'Ingreso manual'
     AND NEW."Bodega_Consignacion_Id" IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM "Pedidos" p
        WHERE p."Nombre_Empresa" = NEW."Nombre_Empresa"
          AND p."Consecutivo"    = NEW."Consecutivo"
          AND p."Cliente" IS NOT DISTINCT FROM NEW."Cliente"
     )
  THEN
    v_nit := public.nit_normalizado(NEW."NIT");
    IF length(COALESCE(v_nit, '')) >= 5
       AND NOT EXISTS (
         SELECT 1 FROM "Pedidos" p
          WHERE public.nit_normalizado(p."NIT") = v_nit
       )
    THEN
      NEW."Estado_2" := 'Pendiente de aprobación';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
