-- Agregar columna Departamento a SolicitudMuestras
ALTER TABLE "SolicitudMuestras" ADD COLUMN IF NOT EXISTS "Departamento" text DEFAULT '';
