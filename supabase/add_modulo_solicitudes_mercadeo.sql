-- Módulo "Solicitudes a Mercadeo": formulario en panel-pedidos cuya gestión la hace
-- el equipo de Mercadeo en panel-pqrs (otro proyecto Supabase) vía las Edge Functions
-- `solicitud-mercadeo` (este proyecto) y `solicitud-mercadeo-pedidos` (pqrs).
--
-- 1. Agrega 'solicitudes_mercadeo' al CHECK de usuario_modulos. La lista es la que
--    tiene producción hoy (incluye 'crm', que ya no tiene módulo pero conserva una
--    fila de usuario_modulos: quitarlo del CHECK haría fallar la validación).
-- 2. Asigna el módulo de entrada a los usuarios ACTIVOS con rol comercial,
--    gerente_iaso, editor o remisionador (los roles que definió la usuaria).
--    Admin no necesita fila (hasModule/user_has_module le abren todo). Quien se
--    cree después se habilita con la casilla en Usuarios.
--
-- Idempotente. Aplicar como migración remota: add_modulo_solicitudes_mercadeo

ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'lista_precios','reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad','notificaciones','clientes',
    'productos','reabastecimiento','bodegas_consignacion',
    'cartera','crm',
    'legalizacion_gastos','legalizacion_gastos_aprobar',
    'solicitudes_mercadeo'
  ));

INSERT INTO usuario_modulos (usuario_id, modulo)
SELECT u.id, 'solicitudes_mercadeo'
FROM usuarios u
WHERE u.activo = true
  AND u.rol IN ('comercial', 'gerente_iaso', 'editor', 'remisionador')
ON CONFLICT (usuario_id, modulo) DO NOTHING;
