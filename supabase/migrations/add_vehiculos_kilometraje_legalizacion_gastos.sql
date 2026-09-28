-- ============================================================
-- Kilometraje de vehículos en Legalización de Gastos
--
-- Piloto (solo placas JRM295 / LJT165 muestran los campos nuevos en el
-- panel; el gate vive en JS como KM_PILOTO_PLACAS, no aquí — el resto de
-- la flota sigue funcionando exactamente igual que antes):
--
--   - Vehiculos: catálogo real de placas (reemplaza la lista fija
--     PLACAS_FIJAS que vivía en legalizacion-gastos.js), con rendimiento
--     esperado (km/galón) y el último odómetro conocido (bitácora
--     continua, ver trigger más abajo).
--   - LegalizacionGastos: Km_Salida/Km_Llegada y Hora_Salida/Hora_Llegada
--     por viaje (Tipo='Ruta'), todos opcionales.
--   - LegalizacionGastosItems: Galones comprados por línea de gasto
--     (relevante solo cuando Concepto='Combustible').
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

-- ── 1. Tabla Vehiculos (catálogo) ──
CREATE TABLE IF NOT EXISTS public."Vehiculos" (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Placa"                     text NOT NULL,
  "Descripcion"               text NOT NULL DEFAULT '',
  "Rendimiento_Esperado"      numeric,
  "Km_Actual"                 numeric NOT NULL DEFAULT 0,
  "Km_Actual_Fecha"           date,
  "Km_Actual_Legalizacion_Id" bigint,
  "Activo"                    boolean NOT NULL DEFAULT true,
  "creado_por"                uuid,
  "creado_por_nombre"         text,
  "creado_en"                 timestamptz,
  "modificado_por"            uuid,
  "modificado_por_nombre"     text,
  "modificado_en"             timestamptz
);

ALTER TABLE public."Vehiculos" DROP CONSTRAINT IF EXISTS vehiculos_placa_unica;
ALTER TABLE public."Vehiculos" ADD CONSTRAINT vehiculos_placa_unica UNIQUE ("Placa");

COMMENT ON TABLE public."Vehiculos" IS
  'Catálogo de vehículos de la flota (placa, descripción, rendimiento esperado km/galón, último odómetro conocido). Reemplaza la lista fija PLACAS_FIJAS de legalizacion-gastos.js.';

-- Placas ya hardcodeadas en legalizacion-gastos.js, para no perder el
-- dropdown de Placa al migrar. Rendimiento_Esperado solo se precarga para
-- el piloto (JRM295/LJT165); el resto queda NULL.
INSERT INTO public."Vehiculos" ("Placa", "Descripcion", "Rendimiento_Esperado") VALUES
  ('JRM295', 'Camión Blanco', 30),
  ('LJT165', 'Camión Azúl', 30),
  ('BTI756', 'Luv Blanca', NULL),
  ('DBN900', 'Mazda', NULL),
  ('SWS985', 'Carri Blanca', NULL),
  ('UVS68H', 'Moto', NULL)
ON CONFLICT ("Placa") DO NOTHING;

-- ── 2. Kilometraje y hora por viaje (LegalizacionGastos, Tipo='Ruta') ──
ALTER TABLE public."LegalizacionGastos"
  ADD COLUMN IF NOT EXISTS "Km_Salida"    numeric,
  ADD COLUMN IF NOT EXISTS "Km_Llegada"   numeric,
  ADD COLUMN IF NOT EXISTS "Hora_Salida"  time,
  ADD COLUMN IF NOT EXISTS "Hora_Llegada" time;

-- ── 3. Galones comprados (LegalizacionGastosItems, Concepto='Combustible') ──
ALTER TABLE public."LegalizacionGastosItems"
  ADD COLUMN IF NOT EXISTS "Galones" numeric;

-- ── 4. Auditoría (trigger genérico ya existente, mismo patrón que las
--    demás tablas de este módulo) ──
DROP TRIGGER IF EXISTS trg_auditoria_row ON public."Vehiculos";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."Vehiculos"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."Vehiculos";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."Vehiculos"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 5. Bitácora continua: Km_Actual se actualiza solo (ratchet hacia
--    adelante) cada vez que se guarda un viaje con Km_Llegada mayor al
--    último conocido de esa placa. SECURITY DEFINER para que no dependa
--    de qué legalizaciones puede ver el usuario que guarda (RLS filtra
--    LegalizacionGastos por empresa). Mejor esfuerzo: si se edita/borra
--    una legalización hacia atrás, Km_Actual no se recalcula
--    retroactivamente (es un dato de referencia, no algo que se reparte). ──
CREATE OR REPLACE FUNCTION public.fn_actualizar_km_vehiculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW."Tipo" = 'Ruta' AND NEW."Km_Llegada" IS NOT NULL AND NULLIF(btrim(NEW."Placa"), '') IS NOT NULL THEN
    UPDATE "Vehiculos"
       SET "Km_Actual" = NEW."Km_Llegada",
           "Km_Actual_Fecha" = COALESCE(NEW."Fecha_Llegada", NEW."Fecha"),
           "Km_Actual_Legalizacion_Id" = NEW.id
     WHERE "Placa" = NEW."Placa" AND NEW."Km_Llegada" > "Km_Actual";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_actualizar_km_vehiculo ON public."LegalizacionGastos";
CREATE TRIGGER trg_actualizar_km_vehiculo
  AFTER INSERT OR UPDATE ON public."LegalizacionGastos"
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_km_vehiculo();

-- ── 6. RLS ──
ALTER TABLE public."Vehiculos" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vehiculos_select" ON public."Vehiculos";
CREATE POLICY "Vehiculos_select" ON public."Vehiculos" FOR SELECT TO authenticated
  USING (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar'));

-- Permite el alta automática de una placa nueva al guardar una
-- legalización (mismo patrón que "cliente nuevo desde pedido").
DROP POLICY IF EXISTS "Vehiculos_insert" ON public."Vehiculos";
CREATE POLICY "Vehiculos_insert" ON public."Vehiculos" FOR INSERT TO authenticated
  WITH CHECK (public.user_has_module('legalizacion_gastos'));

-- Editar Descripción/Rendimiento esperado/Activo queda reservado a quien
-- concilia (mismo criterio que quien aprueba/rechaza gastos).
DROP POLICY IF EXISTS "Vehiculos_update" ON public."Vehiculos";
CREATE POLICY "Vehiculos_update" ON public."Vehiculos" FOR UPDATE TO authenticated
  USING (public.user_has_module('legalizacion_gastos_aprobar'))
  WITH CHECK (public.user_has_module('legalizacion_gastos_aprobar'));

-- Sin DELETE: baja lógica con Activo=false (igual que ClientesUnicos.Estado).

GRANT ALL ON public."Vehiculos" TO anon, authenticated, service_role;

-- ── 7. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
