-- ============================================================
-- Remisiones externas: agrega el tipo "Materia prima" de la planta de producción
--
-- remisiones_externas_legalizacion_gastos.sql creó RemisionesExternas (+Items)
-- para remisiones de Chia Abago que no están en el sistema. Las remisiones de
-- materias primas de la planta de producción tampoco están y se manejan igual,
-- con dos diferencias:
--   * Cantidades en kilos o litros directos (columna Unidad 'KG' | 'L' de cada
--     línea), no unidades por presentación. Las líneas de Abago dejan Unidad NULL.
--   * Se cargan a un grupo aparte "MATERIAS PRIMAS" (como "CHIA ABAGO", no es
--     empresa del holding) en el reparto y en Prorrateo.
--
-- Tipo: 'ABAGO' (por defecto: conserva las remisiones ya registradas) |
-- 'MATERIA_PRIMA'. Proveedor guarda el proveedor de la materia prima (texto libre).
--
-- Además legalizacion_gastos_visible ignora también la fila 'MATERIAS PRIMAS'
-- del reparto (igual que 'CHIA ABAGO'): un reparto solo de grupos externos lo
-- ven todos los usuarios del módulo; si no, decide por las empresas del holding.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

ALTER TABLE public."RemisionesExternas"
  ADD COLUMN IF NOT EXISTS "Tipo" text NOT NULL DEFAULT 'ABAGO';

ALTER TABLE public."RemisionesExternas"
  DROP CONSTRAINT IF EXISTS remisiones_externas_tipo_valido;
ALTER TABLE public."RemisionesExternas"
  ADD CONSTRAINT remisiones_externas_tipo_valido CHECK ("Tipo" IN ('ABAGO', 'MATERIA_PRIMA'));

ALTER TABLE public."RemisionesExternasItems"
  ADD COLUMN IF NOT EXISTS "Unidad" text;

ALTER TABLE public."RemisionesExternasItems"
  DROP CONSTRAINT IF EXISTS remisiones_externas_items_unidad_valida;
ALTER TABLE public."RemisionesExternasItems"
  ADD CONSTRAINT remisiones_externas_items_unidad_valida CHECK ("Unidad" IS NULL OR "Unidad" IN ('KG', 'L'));

COMMENT ON COLUMN public."RemisionesExternas"."Tipo" IS
  'ABAGO = remisión de Chia Abago (unidades por presentación); MATERIA_PRIMA = remisión de materia prima de la planta de producción (kilos/litros directos).';
COMMENT ON COLUMN public."RemisionesExternasItems"."Unidad" IS
  'Solo materia prima: KG o L, y Cantidad es el total en esa unidad. NULL en remisiones de Abago.';

CREATE OR REPLACE FUNCTION public.legalizacion_gastos_visible(p_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM "LegalizacionGastosEmpresas" e
                 WHERE e."Legalizacion_Id" = p_id AND e."Empresa" NOT IN ('CHIA ABAGO', 'MATERIAS PRIMAS'))
    OR EXISTS (
      SELECT 1 FROM "LegalizacionGastosEmpresas" e
       WHERE e."Legalizacion_Id" = p_id AND e."Empresa" NOT IN ('CHIA ABAGO', 'MATERIAS PRIMAS')
         AND user_has_company(e."Empresa")
    );
$$;

NOTIFY pgrst, 'reload schema';
