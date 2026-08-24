-- Agregar rol 'remisionador' al CHECK constraint de usuarios.
-- Permisos: igual que editor + acceso al consecutivo automático de remisiones.

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador','contabilidad','gerente_iaso','remisionador'));
