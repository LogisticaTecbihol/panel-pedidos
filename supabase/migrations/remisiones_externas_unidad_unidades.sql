-- ============================================================
-- Remisiones externas de materia prima: agrega la unidad "Unidades" (UND)
--
-- RemisionesExternasItems.Unidad solo admitía 'KG' | 'L' (o NULL en las de Chia
-- Abago). Ahora el formulario de remisión de materia prima ofrece también
-- "Unidades": 'UND'. Una línea en UND se trata como las de Chia Abago: la cantidad
-- son unidades y solo entra al reparto/Prorrateo por litros o kilos si el nombre
-- del producto trae la presentación (ej. "SULFATO X 25 KILOS"); si no, queda sin
-- conversión (ver _litKiloDeLinea en js/legalizacion-gastos.js).
--
-- Solo se amplía el CHECK: las filas existentes (KG, L, NULL) siguen válidas.
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

ALTER TABLE public."RemisionesExternasItems"
  DROP CONSTRAINT IF EXISTS remisiones_externas_items_unidad_valida;
ALTER TABLE public."RemisionesExternasItems"
  ADD CONSTRAINT remisiones_externas_items_unidad_valida CHECK ("Unidad" IS NULL OR "Unidad" IN ('KG', 'L', 'UND'));

COMMENT ON COLUMN public."RemisionesExternasItems"."Unidad" IS
  'Solo materia prima: KG o L (Cantidad es el total en esa unidad) o UND (unidades por presentación, como Abago). NULL en remisiones de Abago.';

NOTIFY pgrst, 'reload schema';
