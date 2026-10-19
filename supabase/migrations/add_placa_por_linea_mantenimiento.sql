-- ============================================================
-- Varias placas en una misma legalización de mantenimiento
--
-- Una factura de un proveedor puede aplicar a varios vehículos, así que el
-- formulario de Mantenimiento ahora tiene un bloque por placa, cada uno con
-- sus líneas de gasto y valor. Para guardarlo:
--
--   - LegalizacionGastosItems."Placa": placa a la que pertenece la línea.
--     Vacía en Ruta y Envío (ahí la placa sigue siendo la de la cabecera).
--   - LegalizacionGastosItems."Km_Placa": odómetro de esa placa (piloto de
--     kilometraje, JRM295 / LJT165). Se repite en todas las líneas de la
--     misma placa; NULL si la placa no es piloto o no se registró.
--   - LegalizacionGastos."Placa" (cabecera) pasa a guardar las placas juntas
--     ("JRM295, LJT165") para buscar y listar; con una sola placa no cambia.
--   - LegalizacionGastos."Km_Llegada" (cabecera) queda solo cuando la
--     legalización tiene UNA placa (compatibilidad); con varias va en NULL y
--     el kilometraje de cada placa sale de Km_Placa.
--
-- El trigger de bitácora continua (Vehiculos.Km_Actual) solo miraba la
-- cabecera; se agrega uno equivalente sobre las líneas para que cada placa
-- piloto actualice su propio odómetro.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final. Aplicarla ANTES
-- de publicar el JS nuevo (el JS nuevo escribe estas columnas).
-- ============================================================

-- ── 1. Columnas nuevas ──
ALTER TABLE public."LegalizacionGastosItems"
  ADD COLUMN IF NOT EXISTS "Placa"    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Km_Placa" numeric;

COMMENT ON COLUMN public."LegalizacionGastosItems"."Placa" IS
  'Placa del vehículo a la que pertenece la línea (solo Mantenimiento; vacía en Ruta y Envío).';
COMMENT ON COLUMN public."LegalizacionGastosItems"."Km_Placa" IS
  'Odómetro de la placa de la línea (piloto de kilometraje). Se repite en todas las líneas de la misma placa.';

-- ── 2. Relleno de lo ya guardado: cada línea de un mantenimiento hereda la
--    placa y el kilometraje de su cabecera. Es un relleno mecánico (no lo
--    hizo ningún usuario), así que se apagan los triggers de auditoría para
--    no registrar "modificaciones" falsas en las líneas. ──
ALTER TABLE public."LegalizacionGastosItems" DISABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."LegalizacionGastosItems" DISABLE TRIGGER trg_audit_log;

UPDATE public."LegalizacionGastosItems" i
   SET "Placa"    = btrim(l."Placa"),
       "Km_Placa" = l."Km_Llegada"
  FROM public."LegalizacionGastos" l
 WHERE l.id = i."Legalizacion_Id"
   AND l."Tipo" = 'Mantenimiento'
   AND NULLIF(btrim(l."Placa"), '') IS NOT NULL;

ALTER TABLE public."LegalizacionGastosItems" ENABLE TRIGGER trg_auditoria_row;
ALTER TABLE public."LegalizacionGastosItems" ENABLE TRIGGER trg_audit_log;

-- ── 3. Bitácora continua por placa: Km_Actual avanza (ratchet hacia
--    adelante) cuando una línea trae Km_Placa mayor al último conocido de su
--    placa. SECURITY DEFINER por la misma razón que fn_actualizar_km_vehiculo
--    (el RLS de LegalizacionGastos filtra por empresa). ──
CREATE OR REPLACE FUNCTION public.fn_actualizar_km_vehiculo_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fecha date;
BEGIN
  IF NEW."Km_Placa" IS NOT NULL AND NULLIF(btrim(NEW."Placa"), '') IS NOT NULL THEN
    SELECT COALESCE("Fecha_Llegada", "Fecha") INTO v_fecha
      FROM "LegalizacionGastos" WHERE id = NEW."Legalizacion_Id";
    UPDATE "Vehiculos"
       SET "Km_Actual" = NEW."Km_Placa",
           "Km_Actual_Fecha" = v_fecha,
           "Km_Actual_Legalizacion_Id" = NEW."Legalizacion_Id"
     WHERE "Placa" = NEW."Placa" AND NEW."Km_Placa" > "Km_Actual";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_actualizar_km_vehiculo_item ON public."LegalizacionGastosItems";
CREATE TRIGGER trg_actualizar_km_vehiculo_item
  AFTER INSERT OR UPDATE ON public."LegalizacionGastosItems"
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_km_vehiculo_item();

-- ── 4. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
