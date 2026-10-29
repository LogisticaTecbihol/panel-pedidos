-- ============================================================
-- Verificación de add_oc_fecha_legalizacion_rpc.sql (solo lectura).
-- Correr DESPUÉS de aplicar la migración, como service_role / SQL Editor.
-- Desde el SQL Editor auth.uid() es NULL y user_has_company() no deja ver
-- filas; por eso las pruebas 2 y 3 comparan contra la misma consulta sin
-- ese filtro. Las pruebas con un usuario real (remisionador) se hacen
-- desde el panel.
-- ============================================================

-- 1) La función existe, es SECURITY DEFINER y solo la ejecutan usuarios autenticados.
SELECT p.proname,
       p.prosecdef                                   AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_ejecuta,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_ejecuta   -- debe ser false
FROM pg_proc p
WHERE p.proname = 'oc_fecha_legalizacion'
  AND p.pronamespace = 'public'::regnamespace;

-- 2) Toda OC de traslado legalizada tiene hora de legalización (esperado: sin_hora = 0).
WITH leg AS (
  SELECT o.id,
         COALESCE((SELECT min(a.created_at) FROM audit_log a
                    WHERE a.tabla = 'OrdenesCompra' AND a.registro_id = o.id::text
                      AND a.accion IN ('INSERT','UPDATE')
                      AND (COALESCE(a.datos_despues->>'Remision','') <> ''
                        OR COALESCE(a.datos_despues->>'Remision_Origen','') <> '')),
                  o.creado_en) AS legalizada_en
  FROM "OrdenesCompra" o
  WHERE o."Tipo" = 'Traslado'
    AND (COALESCE(o."Remision",'') <> '' OR COALESCE(o."Remision_Origen",'') <> '')
)
SELECT count(*) AS legalizadas, count(*) FILTER (WHERE legalizada_en IS NULL) AS sin_hora FROM leg;

-- 3) La hora nunca es posterior a la última modificación de la OC (esperado: 0 filas).
SELECT o.id, o."Consecutivo", o.modificado_en
FROM "OrdenesCompra" o
WHERE o."Tipo" = 'Traslado'
  AND (COALESCE(o."Remision",'') <> '' OR COALESCE(o."Remision_Origen",'') <> '')
  AND COALESCE((SELECT min(a.created_at) FROM audit_log a
                 WHERE a.tabla = 'OrdenesCompra' AND a.registro_id = o.id::text
                   AND a.accion IN ('INSERT','UPDATE')
                   AND (COALESCE(a.datos_despues->>'Remision','') <> ''
                     OR COALESCE(a.datos_despues->>'Remision_Origen','') <> '')),
               o.creado_en) > COALESCE(o.modificado_en, now());
