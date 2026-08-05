-- Flujo de aprobación para SolicitudMuestras
-- Estado_Aprobacion: 'Por aprobar' | 'Aprobada' | 'Rechazada'
-- Solo usuarios con rol 'admin' pueden aprobar/rechazar (validación en cliente y RLS opcional).

-- 1. Agregar columnas. Default temporal 'Aprobada' para no romper filas existentes.
ALTER TABLE "SolicitudMuestras"
  ADD COLUMN IF NOT EXISTS "Estado_Aprobacion" text NOT NULL DEFAULT 'Aprobada',
  ADD COLUMN IF NOT EXISTS "Aprobada_Por"      text,
  ADD COLUMN IF NOT EXISTS "Fecha_Aprobacion"  timestamptz,
  ADD COLUMN IF NOT EXISTS "Motivo_Rechazo"    text;

-- 2. Cambiar default a 'Por aprobar' para toda nueva solicitud.
ALTER TABLE "SolicitudMuestras"
  ALTER COLUMN "Estado_Aprobacion" SET DEFAULT 'Por aprobar';

-- 3. Restringir valores válidos.
ALTER TABLE "SolicitudMuestras"
  DROP CONSTRAINT IF EXISTS sm_estado_aprobacion_valido;
ALTER TABLE "SolicitudMuestras"
  ADD  CONSTRAINT sm_estado_aprobacion_valido
       CHECK ("Estado_Aprobacion" IN ('Por aprobar','Aprobada','Rechazada'));

-- 4. No permitir despachar sin aprobación previa.
ALTER TABLE "SolicitudMuestras"
  DROP CONSTRAINT IF EXISTS sm_despacho_requiere_aprobacion;
ALTER TABLE "SolicitudMuestras"
  ADD  CONSTRAINT sm_despacho_requiere_aprobacion
       CHECK ("Estado" <> 'Despachada' OR "Estado_Aprobacion" = 'Aprobada');
