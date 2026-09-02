-- ============================================================
-- Migración: consecutivo automático para Órdenes de Compra
--
-- El formulario "Nueva Orden de Compra" (js/ordenes.js) deja de
-- pedir el N° de OC a mano. El número se asigna por el par
-- (Empresa Destino, Empresa Origen) y el cliente lo formatea como
--   OC-<siglaDestino>-<siglaOrigen>-<n>   (ej: OC-RESO-GREEN-1)
--
-- Esta función devuelve solo el entero <n> (como texto), con lock
-- por par comprador/proveedor, ignorando lo que mande el cliente.
-- Mismo método MAX+1 que generar_consecutivo_muestra: no usa tabla
-- de contadores, así que si el guardado falla el número NO se
-- "quema" (el siguiente intento vuelve a leer el mismo máximo).
--
-- La usa js/ordenes.js -> saveOC() antes de llamar a
-- apiPost('agregarOrdenCompra').
--
-- Fecha: 2026-09-02
-- ============================================================

CREATE OR REPLACE FUNCTION public.generar_consecutivo_orden_compra(
  p_empresa_destino text,
  p_empresa_origen  text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo int;
BEGIN
  IF p_empresa_destino IS NULL OR btrim(p_empresa_destino) = '' THEN
    RAISE EXCEPTION 'Empresa Destino requerida';
  END IF;
  IF p_empresa_origen IS NULL OR btrim(p_empresa_origen) = '' THEN
    RAISE EXCEPTION 'Empresa Origen requerida';
  END IF;

  -- Mismo criterio que la política RLS OrdenesCompra_insert
  IF NOT (public.get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador'])
          AND (public.user_has_company(p_empresa_origen) OR public.user_has_company(p_empresa_destino))) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Serializa las creaciones simultáneas del mismo par comprador/proveedor
  -- para que dos llamadas seguidas no lean el mismo máximo. Se libera al
  -- terminar la transacción del RPC.
  PERFORM pg_advisory_xact_lock(
    hashtext('oc_consec:' || btrim(p_empresa_destino) || '|' || btrim(p_empresa_origen))
  );

  SELECT COALESCE(MAX(substring("Consecutivo" from '^OC-.+-([0-9]+)$')::int), 0) + 1
    INTO v_nuevo
    FROM "OrdenesCompra"
   WHERE COALESCE("Tipo", 'Compra') = 'Compra'
     AND btrim("Empresa_Destino") = btrim(p_empresa_destino)
     AND btrim("Empresa_Origen")  = btrim(p_empresa_origen)
     AND "Consecutivo" ~ '^OC-.+-[0-9]+$';

  RETURN v_nuevo::text;
END;
$$;

REVOKE ALL ON FUNCTION public.generar_consecutivo_orden_compra(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generar_consecutivo_orden_compra(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.generar_consecutivo_orden_compra(text, text) TO authenticated;

-- ============================================================
-- FIN migración
-- ============================================================
