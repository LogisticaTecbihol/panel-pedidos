-- Flujo de aprobación para OrdenesCompra (mismo patrón que SolicitudMuestras).
-- Estado_Aprobacion: 'Por aprobar' | 'Aprobada' | 'Rechazada'
-- Aprobadores: rol admin OR usuario con módulo 'ordenes_aprobar' asignado
-- (validación en cliente por AUTH.canApproveOC()).

-- 1. Columnas nuevas. Default temporal 'Aprobada' para no romper filas existentes.
ALTER TABLE "OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "Estado_Aprobacion" text NOT NULL DEFAULT 'Aprobada',
  ADD COLUMN IF NOT EXISTS "Aprobada_Por"      text,
  ADD COLUMN IF NOT EXISTS "Fecha_Aprobacion"  timestamptz,
  ADD COLUMN IF NOT EXISTS "Motivo_Rechazo"    text;

-- 2. Default a 'Por aprobar' para toda nueva OC.
ALTER TABLE "OrdenesCompra"
  ALTER COLUMN "Estado_Aprobacion" SET DEFAULT 'Por aprobar';

-- 3. Restringir valores válidos.
ALTER TABLE "OrdenesCompra"
  DROP CONSTRAINT IF EXISTS oc_estado_aprobacion_valido;
ALTER TABLE "OrdenesCompra"
  ADD  CONSTRAINT oc_estado_aprobacion_valido
       CHECK ("Estado_Aprobacion" IN ('Por aprobar','Aprobada','Rechazada'));

-- 4. No permitir cargar Remisión Destino ni Origen sin aprobación previa
--    (equivalente al bloqueo de "Despachada" en SolicitudMuestras).
ALTER TABLE "OrdenesCompra"
  DROP CONSTRAINT IF EXISTS oc_legalizacion_requiere_aprobacion;
ALTER TABLE "OrdenesCompra"
  ADD  CONSTRAINT oc_legalizacion_requiere_aprobacion
       CHECK (
         "Estado_Aprobacion" = 'Aprobada'
         OR (
           ("Remision"        IS NULL OR "Remision"        = '')
           AND ("Remision_Origen" IS NULL OR "Remision_Origen" = '')
         )
       );

-- 5. Nuevo módulo 'ordenes_aprobar' en usuario_modulos (permiso independiente del rol admin).
ALTER TABLE usuario_modulos
  DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;

ALTER TABLE usuario_modulos
  ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar'
  ));
