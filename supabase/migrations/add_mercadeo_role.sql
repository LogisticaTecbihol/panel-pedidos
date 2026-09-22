-- Rol 'mercadeo': acceso total al nuevo CRM de Mercadeo (Leads, Actividades,
-- Presupuesto). No se toca user_has_company(): el CRM no se filtra por
-- empresa, cada policy se resuelve solo por rol (igual que hace 'cartera'
-- para Pedidos/ClientesUnicos, pero sin tocar la función compartida).
--
-- Idempotente. Aplicar con apply_migration (MCP) antes de publicar el frontend.

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador',
                 'contabilidad','gerente_iaso','remisionador','cartera',
                 'produccion','mercadeo'));

NOTIFY pgrst, 'reload schema';
