-- ============================================================
-- REVERSIÓN de harden_storage_write_policies.sql
-- Restaura las 10 políticas de Storage a su definición anterior
-- (solo auth.role() = 'authenticated', sin exigir fila en public.usuarios).
-- ============================================================

ALTER POLICY "Usuarios autenticados suben a cambios-adjuntos" ON storage.objects
  WITH CHECK ((bucket_id = 'cambios-adjuntos'::text) AND (auth.role() = 'authenticated'::text));
ALTER POLICY "Usuarios autenticados actualizan cambios-adjuntos" ON storage.objects
  USING ((bucket_id = 'cambios-adjuntos'::text) AND (auth.role() = 'authenticated'::text));
ALTER POLICY "Usuarios autenticados eliminan de cambios-adjuntos" ON storage.objects
  USING ((bucket_id = 'cambios-adjuntos'::text) AND (auth.role() = 'authenticated'::text));

ALTER POLICY "ing_adjuntos_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'ingresos-adjuntos'::text) AND (auth.role() = 'authenticated'::text));
ALTER POLICY "ing_adjuntos_delete" ON storage.objects
  USING ((bucket_id = 'ingresos-adjuntos'::text) AND (auth.role() = 'authenticated'::text));

ALTER POLICY "mu_adjuntos_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'muestras-adjuntos'::text) AND (auth.role() = 'authenticated'::text));
ALTER POLICY "mu_adjuntos_delete" ON storage.objects
  USING ((bucket_id = 'muestras-adjuntos'::text) AND (auth.role() = 'authenticated'::text));

ALTER POLICY "pedidos_adj_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'pedidos-adjuntos'::text) AND ((storage.foldername(name))[1] <> 'notificaciones'::text));
ALTER POLICY "pedidos_adj_select" ON storage.objects
  USING ((bucket_id = 'pedidos-adjuntos'::text) AND ((storage.foldername(name))[1] <> 'notificaciones'::text));
ALTER POLICY "notif_storage_insert" ON storage.objects
  WITH CHECK ((bucket_id = 'pedidos-adjuntos'::text) AND ((storage.foldername(name))[1] = 'notificaciones'::text));
