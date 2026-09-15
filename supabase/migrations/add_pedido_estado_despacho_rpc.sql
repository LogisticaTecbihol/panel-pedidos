-- ============================================================
-- Migración: RPC de solo lectura para saber si un pedido ya tenía
-- una entrega registrada (paquete ya despachado) al momento de
-- legalizar una OC de traslado ligada a él.
--
-- Caso real (IASO-RS-0059, 2026-09-15): el pedido se despachó y su
-- paquete se envió automático a contabilidad ANTES de que la OC de
-- traslado que lo reabastecía (RESO->IASO) se legalizara — el
-- paquete enviado no pudo incluir esa remisión de traslado porque
-- todavía no existía. Este RPC permite detectar ese caso desde
-- ordenes.js al momento de legalizar, para reenviar un complemento.
--
-- SECURITY DEFINER: la lectura no depende del rol de quien legaliza
-- la OC (ej. 'contabilidad', 'remisionador') ni de si ese rol tiene
-- visibilidad amplia sobre Pedidos — solo se exige pertenecer a la
-- empresa del pedido (user_has_company), igual que el resto del panel.
--
-- Ejecutar con apply_migration del MCP de Supabase (no se aplica con
-- el push a GitHub) + NOTIFY pgrst, 'reload schema'.
-- Fecha: 2026-09-15
-- ============================================================

CREATE OR REPLACE FUNCTION pedido_estado_despacho(p_pedido_id bigint)
RETURNS TABLE (
  ya_despachado boolean,
  empresa       text,
  consecutivo   text,
  cliente       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM "Pedidos" p2
      WHERE lower(trim(p2."Nombre_Empresa")) = lower(trim(p1."Nombre_Empresa"))
        AND trim(p2."Consecutivo") = trim(p1."Consecutivo")
        AND lower(trim(p2."Cliente")) = lower(trim(p1."Cliente"))
        AND COALESCE(p2."Cant_Entregada", 0) > 0
    ) AS ya_despachado,
    p1."Nombre_Empresa" AS empresa,
    p1."Consecutivo"    AS consecutivo,
    p1."Cliente"        AS cliente
  FROM "Pedidos" p1
  WHERE p1.id = p_pedido_id
    AND public.user_has_company(p1."Nombre_Empresa");
$$;

REVOKE ALL ON FUNCTION pedido_estado_despacho(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pedido_estado_despacho(bigint) TO authenticated;

-- ============================================================
-- FIN migración
-- ============================================================
