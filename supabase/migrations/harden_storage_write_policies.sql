-- ============================================================
-- Endurecer políticas de ESCRITURA de Storage a usuarios del panel
-- Paso 1 del plan "Panel Chía Abago" — redactada y APLICADA 2026-10-27 (apply_migration del MCP)
--
-- Problema: en storage.objects, las políticas de subir/modificar/borrar de los
-- buckets cambios-adjuntos, ingresos-adjuntos, muestras-adjuntos y
-- pedidos-adjuntos solo exigen auth.role() = 'authenticated'. Cualquier
-- usuario con sesión válida del proyecto (aunque no exista en public.usuarios)
-- podría subir, sobrescribir o BORRAR adjuntos del holding por la API.
--
-- Cambio: se añade `AND (SELECT public.get_user_role()) IS NOT NULL` a cada una
-- (solo usuarios activos de public.usuarios). Los usuarios actuales del
-- holding no ven diferencia.
--
-- NO se tocan en este paso:
--   • Las políticas de LECTURA de los buckets públicos (cambios/ingresos/muestras)
--     ni el flag `public` de los buckets: los enlaces de adjuntos del panel
--     dependen de ello. Quitar la lectura pública exige pasar a URLs firmadas en
--     el front: es una decisión aparte.
--   • Las políticas de borrado con rol de pedidos-adjuntos, de legalización y de
--     notificaciones (SELECT/DELETE), que ya validan rol o usuario.
--
-- Reversión: harden_storage_write_policies_rollback.sql
-- Aplicar con apply_migration del MCP (el push a GitHub NO la aplica).
-- ============================================================

-- cambios-adjuntos
ALTER POLICY "Usuarios autenticados suben a cambios-adjuntos" ON storage.objects
  WITH CHECK ((bucket_id = 'cambios-adjuntos'::text) AND (auth.role() = 'authenticated'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));
ALTER POLICY "Usuarios autenticados actualizan cambios-adjuntos" ON storage.objects
  USING ((bucket_id = 'cambios-adjuntos'::text) AND (auth.role() = 'authenticated'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));
ALTER POLICY "Usuarios autenticados eliminan de cambios-adjuntos" ON storage.objects
  USING ((bucket_id = 'cambios-adjuntos'::text) AND (auth.role() = 'authenticated'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));

-- ingresos-adjuntos
ALTER POLICY "ing_adjuntos_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'ingresos-adjuntos'::text) AND (auth.role() = 'authenticated'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));
ALTER POLICY "ing_adjuntos_delete" ON storage.objects
  USING ((bucket_id = 'ingresos-adjuntos'::text) AND (auth.role() = 'authenticated'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));

-- muestras-adjuntos
ALTER POLICY "mu_adjuntos_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'muestras-adjuntos'::text) AND (auth.role() = 'authenticated'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));
ALTER POLICY "mu_adjuntos_delete" ON storage.objects
  USING ((bucket_id = 'muestras-adjuntos'::text) AND (auth.role() = 'authenticated'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));

-- pedidos-adjuntos (carpetas de pedidos/despachos y carpeta notificaciones)
ALTER POLICY "pedidos_adj_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'pedidos-adjuntos'::text) AND ((storage.foldername(name))[1] <> 'notificaciones'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));
ALTER POLICY "pedidos_adj_select" ON storage.objects
  USING ((bucket_id = 'pedidos-adjuntos'::text) AND ((storage.foldername(name))[1] <> 'notificaciones'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));
ALTER POLICY "notif_storage_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'pedidos-adjuntos'::text) AND ((storage.foldername(name))[1] = 'notificaciones'::text) AND ((SELECT public.get_user_role()) IS NOT NULL));

-- Salvaguarda: las 10 políticas deben mencionar get_user_role(); si no, se revierte todo.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN (
      'Usuarios autenticados suben a cambios-adjuntos',
      'Usuarios autenticados actualizan cambios-adjuntos',
      'Usuarios autenticados eliminan de cambios-adjuntos',
      'ing_adjuntos_insert', 'ing_adjuntos_delete',
      'mu_adjuntos_insert', 'mu_adjuntos_delete',
      'pedidos_adj_insert', 'pedidos_adj_select', 'notif_storage_insert')
    AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%get_user_role%';
  IF n <> 10 THEN
    RAISE EXCEPTION 'Se esperaban 10 políticas de Storage con get_user_role() y hay %', n;
  END IF;
END $$;
