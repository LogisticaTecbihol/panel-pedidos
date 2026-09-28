-- ============================================================
-- Agrega "Tipo" (Ruta / Mantenimiento) a la cabecera de Legalización de
-- Gastos, para distinguir las legalizaciones de ruta de conductor (con
-- remisiones/clientes/recorrido) de las de mantenimiento de vehículo
-- (sin esos campos, con un detalle de mantenimiento por línea de gasto).
-- Ambos tipos comparten el mismo flujo de reparto entre empresas y
-- conciliación de saldo.
-- ============================================================

ALTER TABLE public."LegalizacionGastos"
  ADD COLUMN IF NOT EXISTS "Tipo" text NOT NULL DEFAULT 'Ruta';

ALTER TABLE public."LegalizacionGastos"
  DROP CONSTRAINT IF EXISTS legalizacion_gastos_tipo_valido;
ALTER TABLE public."LegalizacionGastos"
  ADD  CONSTRAINT legalizacion_gastos_tipo_valido
       CHECK ("Tipo" IN ('Ruta','Mantenimiento'));

NOTIFY pgrst, 'reload schema';
