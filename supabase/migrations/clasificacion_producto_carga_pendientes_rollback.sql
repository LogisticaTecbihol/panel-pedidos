-- ============================================================
-- Reversión de clasificacion_producto_carga_pendientes.sql
-- Quita SOLO las filas que esa carga creó y que nadie ha editado desde entonces (siguen con el nombre de la
-- carga en creado_por_nombre y sin modificado_en). Las que ya se cambiaron a mano se conservan.
-- ============================================================
DELETE FROM public."ClasificacionProducto"
 WHERE "creado_por_nombre" = 'Carga asistida 2026-11-25 (por nombre o presentación)'
   AND "modificado_en" IS NULL;
