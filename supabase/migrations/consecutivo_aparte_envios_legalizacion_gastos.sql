-- ============================================================
-- Consecutivo propio para los envíos de Legalización de Gastos.
--
-- Antes "Consecutivo" era una columna GENERADA ('LEG-' || id), así que los
-- envíos (Tipo = 'Envio') compartían numeración con las legalizaciones y les
-- abrían huecos. Ahora cada tipo tiene su contador:
--   * Envios:         ENV-00001, ENV-00002, ...   (legalizacion_gastos_env_seq)
--   * Resto (Ruta y Mantenimiento): LEG-000nn     (legalizacion_gastos_leg_seq)
--
-- - "Consecutivo" pasa a columna normal (DROP EXPRESSION conserva los valores
--   actuales de las legalizaciones existentes: no se renumera nada).
-- - Un trigger BEFORE INSERT asigna el número (el cliente no lo manda) y otro
--   paso BEFORE UPDATE lo mantiene inmutable (antes lo garantizaba ser columna
--   generada); si el Tipo cambiara, se re-asigna con el contador del nuevo tipo.
-- - El contador LEG continúa desde el mayor id usado (16), sin reutilizar
--   ningún número. El envío existente (era LEG-00016) pasa a ENV-00001.
--
-- Aplicar con apply_migration (MCP). Los cambios de datos van ANTES de crear
-- el trigger de UPDATE para que el relleno no quede bloqueado por él.
-- ============================================================

-- 1. La columna deja de ser generada (conserva los valores).
ALTER TABLE public."LegalizacionGastos" ALTER COLUMN "Consecutivo" DROP EXPRESSION;

-- 2. Contadores propios.
CREATE SEQUENCE IF NOT EXISTS public.legalizacion_gastos_leg_seq;
CREATE SEQUENCE IF NOT EXISTS public.legalizacion_gastos_env_seq;

-- LEG continúa después del mayor id existente (el id era el número).
SELECT setval('public.legalizacion_gastos_leg_seq',
              GREATEST((SELECT COALESCE(MAX(id), 0) FROM public."LegalizacionGastos"),
                       (SELECT last_value FROM public."LegalizacionGastos_id_seq")),
              true);

-- 3. Relleno: los envíos existentes toman ENV-00001... por orden de creación.
UPDATE public."LegalizacionGastos" g
   SET "Consecutivo" = 'ENV-' || lpad(n.rn::text, 5, '0')
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn
          FROM public."LegalizacionGastos" WHERE "Tipo" = 'Envio') n
 WHERE g.id = n.id;

SELECT setval('public.legalizacion_gastos_env_seq',
              GREATEST((SELECT COUNT(*) FROM public."LegalizacionGastos" WHERE "Tipo" = 'Envio'), 1),
              (SELECT COUNT(*) > 0 FROM public."LegalizacionGastos" WHERE "Tipo" = 'Envio'));

-- 4. Integridad: único y obligatorio.
ALTER TABLE public."LegalizacionGastos" ALTER COLUMN "Consecutivo" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS legalizacion_gastos_consecutivo_uq
  ON public."LegalizacionGastos" ("Consecutivo");

-- 5. Trigger: asigna el consecutivo al insertar y lo mantiene inmutable.
CREATE OR REPLACE FUNCTION public.set_consecutivo_legalizacion_gastos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."Tipo" IS NOT DISTINCT FROM OLD."Tipo" THEN
    NEW."Consecutivo" := OLD."Consecutivo";   -- inmutable
    RETURN NEW;
  END IF;

  IF NEW."Tipo" = 'Envio' THEN
    NEW."Consecutivo" := 'ENV-' || lpad(nextval('public.legalizacion_gastos_env_seq')::text, 5, '0');
  ELSE
    NEW."Consecutivo" := 'LEG-' || lpad(nextval('public.legalizacion_gastos_leg_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_consecutivo_legalizacion_gastos() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_00_consecutivo_ins ON public."LegalizacionGastos";
CREATE TRIGGER trg_00_consecutivo_ins
  BEFORE INSERT ON public."LegalizacionGastos"
  FOR EACH ROW EXECUTE FUNCTION public.set_consecutivo_legalizacion_gastos();

DROP TRIGGER IF EXISTS trg_00_consecutivo_upd ON public."LegalizacionGastos";
CREATE TRIGGER trg_00_consecutivo_upd
  BEFORE UPDATE ON public."LegalizacionGastos"
  FOR EACH ROW EXECUTE FUNCTION public.set_consecutivo_legalizacion_gastos();

NOTIFY pgrst, 'reload schema';
