-- Agrega el rol 'despachador' para conductores/despachadores.
-- Este rol permite ver la pestaña "Despachos" en pedidos y adjuntar
-- soportes de remisión firmados por el cliente.
-- No puede crear, editar ni eliminar pedidos.

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador'));
