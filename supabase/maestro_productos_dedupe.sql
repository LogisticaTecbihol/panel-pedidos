-- ══════════════════════════════════════════════════════════════
-- Migración: maestro_productos → dedup por Producto y quitar
--            columnas Empresa y Presentacion.
--
-- Ejecutar UNA sola vez en el SQL Editor de Supabase.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Deduplicar: conservar el registro con menor id por cada
--    Producto (comparación normalizada: trim + lower).
DELETE FROM maestro_productos a
USING maestro_productos b
WHERE a.id > b.id
  AND btrim(lower(a."Producto")) = btrim(lower(b."Producto"));

-- 2. Quitar filas con Producto vacío o nulo (basura previa).
DELETE FROM maestro_productos
WHERE "Producto" IS NULL
   OR btrim("Producto") = '';

-- 3. Quitar columnas ya no usadas.
ALTER TABLE maestro_productos
  DROP COLUMN IF EXISTS "Empresa",
  DROP COLUMN IF EXISTS "Presentacion";

-- 4. Garantizar unicidad futura por Producto.
ALTER TABLE maestro_productos
  ADD CONSTRAINT maestro_productos_producto_unique UNIQUE ("Producto");

COMMIT;
