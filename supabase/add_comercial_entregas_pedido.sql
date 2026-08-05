-- Cerrar EntregasPedido para el rol 'comercial'.
--
-- Sin esta migración, un comercial (que tiene empresas asignadas) podría leer
-- filas de EntregasPedido cuyo pedido_id corresponde a pedidos que él NO
-- puede ver por la RLS de Pedidos — filtración parcial de datos (empresa
-- de stock, producto, cantidad, remisión) aunque no del pedido cliente en sí.
--
-- Ahora el SELECT exige, además del match de empresa habitual, que el pedido
-- padre le pertenezca cuando el rol es 'comercial'.
--
-- INSERT/UPDATE/DELETE ya restringen a admin/editor, así que no se tocan
-- (comerciales no operan entregas; solo leen las de sus propios pedidos).

DROP POLICY IF EXISTS "EntregasPedido_select" ON "EntregasPedido";

CREATE POLICY "EntregasPedido_select" ON "EntregasPedido"
  FOR SELECT TO authenticated
  USING (
    (user_has_company("empresa_pedido") OR user_has_company("empresa_stock"))
    AND (
      get_user_role() IN ('admin','editor','lector')
      OR (
        get_user_role() = 'comercial'
        AND EXISTS (
          SELECT 1 FROM "Pedidos" p
          WHERE p.id = "EntregasPedido"."pedido_id"
            AND (p."comercial_id" = auth.uid() OR p."creado_por" = auth.uid())
        )
      )
    )
  );
