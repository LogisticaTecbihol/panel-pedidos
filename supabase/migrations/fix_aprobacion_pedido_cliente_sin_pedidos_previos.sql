-- ============================================================
-- Fix: la aprobación previa de Cartera/administración debía activarse
-- para el primer pedido REAL de un cliente, no solo para el pedido que
-- lo da de alta en ClientesUnicos.
--
-- Caso detectado: BASIL FARM SAS (NIT 901245586-4, empresa IASO,
-- pedido Consecutivo 20, 2026-09-22) ya estaba en ClientesUnicos desde
-- la carga inicial de datos (2026-09-02) sin haber tenido nunca un
-- pedido. Como la regla original solo miraba "¿el NIT existe en
-- ClientesUnicos?", este pedido nació 'Abierto' sin pasar por
-- aprobación, aunque era su primera compra real.
--
-- Nuevo criterio: el pedido manual queda 'Pendiente de aprobación' si
-- ese NIT no tiene NINGÚN pedido previo en todo el holding (cualquier
-- empresa, cualquier Estado_2 — incluye Anulados: si ya pasó una vez
-- por el proceso, no se le vuelve a exigir). Reemplaza el chequeo
-- contra ClientesUnicos, que no distinguía clientes precargados sin
-- historial de compra real.
--
-- Se mantienen las mismas exclusiones de antes: no aplica a carga por
-- Excel/PDF (Archivo_Fuente <> 'Ingreso manual'), a traslados a bodega
-- en consignación (Bodega_Consignacion_Id) ni a NIT inválidos (< 5
-- dígitos).
--
-- No se modifican pedidos ya existentes (p.ej. el Consecutivo 20 de
-- BASIL FARM SAS queda como está); la regla nueva solo rige pedidos
-- que se creen de aquí en adelante.
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
