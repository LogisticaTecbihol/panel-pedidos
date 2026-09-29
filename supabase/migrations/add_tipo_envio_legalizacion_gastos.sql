-- ============================================================
-- Agrega el tipo "Envio" a Legalización de Gastos.
--
-- Un envío es el pago de un flete/mensajería de mercancía: una sola línea de
-- gasto (proveedor, NIT, valor) ligada a remisiones, con reparto entre
-- empresas por litros/kilos. Comparte tabla, consecutivo LEG-, reparto,
-- soportes y PDF con Ruta y Mantenimiento, pero NO pasa por conciliación: se
-- guarda con Estado_Conciliacion = 'Por conciliar' (así sigue editable y
-- eliminable por RLS) y la interfaz lo muestra como "Registrado", fuera de
-- los contadores de pendientes/conciliadas.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

ALTER TABLE public."LegalizacionGastos"
  DROP CONSTRAINT IF EXISTS legalizacion_gastos_tipo_valido;
ALTER TABLE public."LegalizacionGastos"
  ADD  CONSTRAINT legalizacion_gastos_tipo_valido
       CHECK ("Tipo" IN ('Ruta','Mantenimiento','Envio'));

NOTIFY pgrst, 'reload schema';
