-- ============================================================
-- Extiende el registro de kilometraje al formulario de Mantenimiento.
--
-- Mantenimiento no es un viaje (sin salida/llegada): registra un solo
-- kilometraje puntual — el odómetro del vehículo al momento del
-- mantenimiento — reutilizando la misma columna Km_Llegada que usa Ruta
-- (Km_Salida se deja en NULL para estos registros).
--
-- El trigger de bitácora continua (fn_actualizar_km_vehiculo) solo
-- consideraba Tipo='Ruta'; se amplía para que cualquier legalización con
-- Km_Llegada (Ruta o Mantenimiento) actualice Vehiculos.Km_Actual.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_actualizar_km_vehiculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW."Km_Llegada" IS NOT NULL AND NULLIF(btrim(NEW."Placa"), '') IS NOT NULL THEN
    UPDATE "Vehiculos"
       SET "Km_Actual" = NEW."Km_Llegada",
           "Km_Actual_Fecha" = COALESCE(NEW."Fecha_Llegada", NEW."Fecha"),
           "Km_Actual_Legalizacion_Id" = NEW.id
     WHERE "Placa" = NEW."Placa" AND NEW."Km_Llegada" > "Km_Actual";
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
