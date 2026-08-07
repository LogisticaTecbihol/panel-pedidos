-- Agrega el rol 'despachador' para conductores/despachadores.
-- Este rol permite ver la pestaña "Despachos" en pedidos y adjuntar
-- soportes de remisión firmados por el cliente.
-- No puede crear, editar ni eliminar pedidos.

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador'));

-- ══════════════════════════════════════════════════════════════
-- RLS: permitir al despachador leer Pedidos (filtrado por empresa)
-- Redefine la política SELECT para incluir 'despachador'
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Pedidos_select" ON "Pedidos";

CREATE POLICY "Pedidos_select" ON "Pedidos" FOR SELECT TO authenticated
  USING (
    user_has_company("Nombre_Empresa")
    AND (
      get_user_role() IN ('admin','editor','lector','despachador')
      OR (
        get_user_role() = 'comercial'
        AND ("comercial_id" = auth.uid() OR "creado_por" = auth.uid())
      )
    )
  );
