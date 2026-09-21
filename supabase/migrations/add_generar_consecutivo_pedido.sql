-- ============================================================
-- Migración: consecutivo de Pedidos asignado por el servidor al guardar
--
-- Problema (2026-09-21): "Nuevo Pedido" calculaba el N° en el navegador
-- (nextConsecutivoPorComercial, MAX+1 sobre los pedidos cargados en la
-- pestaña) y nunca lo verificaba al guardar. Con una pestaña desactualizada
-- dos pedidos de clientes distintos del mismo comercial salieron con el
-- mismo N° (IASO ISO-C05 #16: BODEGA COATOL y UNION DE ARROCEROS).
--
-- Esta función devuelve el siguiente N° del comercial leyendo la tabla
-- Pedidos en el momento de guardar. Mismo criterio que el cliente
-- (por comercial, sin distinguir mayúsculas/espacios; no por empresa) pero
-- con la visión completa (SECURITY DEFINER: un comercial solo ve sus filas
-- por RLS) y con lock por comercial para serializar llamadas simultáneas.
-- Método MAX+1, sin tabla de contadores: si el guardado falla el número no
-- se "quema". Mismo patrón que generar_consecutivo_muestra /
-- generar_consecutivo_orden_compra.
--
-- La usa js/pedidos.js -> guardarNuevoPedido() antes de agregarPedido.
-- ============================================================

CREATE OR REPLACE FUNCTION public.generar_consecutivo_pedido(
  p_empresa   text,
  p_comercial text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nuevo int;
BEGIN
  IF p_empresa IS NULL OR btrim(p_empresa) = '' THEN
    RAISE EXCEPTION 'Empresa requerida';
  END IF;
  IF p_comercial IS NULL OR btrim(p_comercial) = '' THEN
    RAISE EXCEPTION 'Comercial requerido';
  END IF;

  -- Mismo criterio que la política RLS Pedidos_insert
  IF NOT (public.user_has_company(p_empresa)
          AND public.get_user_role() = ANY (ARRAY['admin','editor','contabilidad','gerente_iaso','remisionador','comercial'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Serializa las llamadas simultáneas del mismo comercial. Se libera al
  -- terminar la transacción del RPC.
  PERFORM pg_advisory_xact_lock(hashtext('pedido_consec:' || lower(btrim(p_comercial))));

  SELECT COALESCE(MAX("Consecutivo"::int), 0) + 1
    INTO v_nuevo
    FROM "Pedidos"
   WHERE lower(btrim("Comercial")) = lower(btrim(p_comercial))
     AND "Consecutivo" ~ '^[0-9]{1,9}$';

  RETURN v_nuevo::text;
END;
$$;

REVOKE ALL ON FUNCTION public.generar_consecutivo_pedido(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generar_consecutivo_pedido(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.generar_consecutivo_pedido(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
