-- Permite notificaciones sin PDF adjunto (avisos de flujo, p. ej. aprobación de muestras)
-- Antes: storage_path era NOT NULL (asumía que toda notificación llevaba un PDF).
-- Ahora: puede ser NULL; el cliente sólo intenta abrir el PDF si existe.

ALTER TABLE notificaciones
  ALTER COLUMN storage_path DROP NOT NULL;
