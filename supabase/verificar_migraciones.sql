-- Diagnóstico: verifica qué migraciones de esta serie están aplicadas.
-- Correr en Supabase SQL Editor. Devuelve una fila por migración con
-- ✅ OK / ❌ FALTA + detalle. No modifica nada.

WITH checks AS (

  -- 1. add_aprobacion_muestras.sql
  SELECT
    1 AS n,
    'add_aprobacion_muestras' AS migracion,
    (
      EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='SolicitudMuestras' AND column_name='Estado_Aprobacion')
      AND EXISTS(SELECT 1 FROM pg_constraint
                  WHERE conname='sm_despacho_requiere_aprobacion')
    ) AS ok,
    'Columna SolicitudMuestras.Estado_Aprobacion + check sm_despacho_requiere_aprobacion' AS detalle

  UNION ALL

  -- 2. notif_permitir_sin_pdf.sql
  SELECT
    2, 'notif_permitir_sin_pdf',
    COALESCE((SELECT is_nullable = 'YES'
                FROM information_schema.columns
               WHERE table_name='notificaciones' AND column_name='storage_path'), false),
    'notificaciones.storage_path debe ser NULLABLE'

  UNION ALL

  -- 3. add_modulo_muestras_aprobar.sql
  SELECT
    3, 'add_modulo_muestras_aprobar',
    EXISTS(
      SELECT 1 FROM pg_constraint
       WHERE conname = 'usuario_modulos_modulo_check'
         AND pg_get_constraintdef(oid) LIKE '%muestras_aprobar%'
    ),
    'CHECK de usuario_modulos debe permitir muestras_aprobar'

  UNION ALL

  -- 4. add_aprobacion_ordenes.sql (agrega columnas + módulo ordenes_aprobar)
  SELECT
    4, 'add_aprobacion_ordenes',
    (
      EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='OrdenesCompra' AND column_name='Estado_Aprobacion')
      AND EXISTS(SELECT 1 FROM pg_constraint
                  WHERE conname='oc_legalizacion_requiere_aprobacion')
      AND EXISTS(
        SELECT 1 FROM pg_constraint
         WHERE conname='usuario_modulos_modulo_check'
           AND pg_get_constraintdef(oid) LIKE '%ordenes_aprobar%'
      )
    ),
    'OrdenesCompra.Estado_Aprobacion + check oc_legalizacion_requiere_aprobacion + ordenes_aprobar en usuario_modulos'

  UNION ALL

  -- 5. add_comercial_pedidos.sql
  SELECT
    5, 'add_comercial_pedidos',
    (
      EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='Pedidos' AND column_name='comercial_id')
      AND EXISTS(
        SELECT 1 FROM pg_constraint
         WHERE conname='usuarios_rol_check'
           AND pg_get_constraintdef(oid) LIKE '%comercial%'
      )
      AND EXISTS(
        SELECT 1 FROM pg_policies
         WHERE tablename='Pedidos' AND policyname='Pedidos_select'
           AND qual LIKE '%comercial_id%'
      )
    ),
    'Pedidos.comercial_id + rol comercial en usuarios + Pedidos_select con comercial_id'

  UNION ALL

  -- 6. add_comercial_entregas_pedido.sql
  SELECT
    6, 'add_comercial_entregas_pedido',
    EXISTS(
      SELECT 1 FROM pg_policies
       WHERE tablename='EntregasPedido' AND policyname='EntregasPedido_select'
         AND qual LIKE '%comercial_id%'
    ),
    'EntregasPedido_select debe referenciar Pedidos.comercial_id'

  UNION ALL

  -- 7. add_comercial_codigo_usuarios.sql
  SELECT
    7, 'add_comercial_codigo_usuarios',
    (
      EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name='usuarios' AND column_name='comercial_codigo')
      AND EXISTS(SELECT 1 FROM pg_indexes
                  WHERE indexname='ux_usuarios_comercial_codigo')
      AND EXISTS(SELECT 1 FROM pg_proc p
                  JOIN pg_type t ON t.oid = p.prorettype
                  WHERE p.proname='list_usuarios_directorio'
                    AND pg_get_function_result(p.oid) LIKE '%comercial_codigo%')
    ),
    'usuarios.comercial_codigo + unique index + list_usuarios_directorio devuelve el campo'

)
SELECT
  n           AS "#",
  migracion   AS "Migración",
  CASE WHEN ok THEN '✅ OK' ELSE '❌ FALTA' END AS "Estado",
  detalle     AS "Verifica"
FROM checks
ORDER BY n;
