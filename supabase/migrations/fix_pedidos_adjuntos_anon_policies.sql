-- Corregir hallazgo crítico: bucket pedidos-adjuntos con policies anónimas
-- Las 3 policies originales usaban roles {public} (incluye anon),
-- permitiendo subir/leer/borrar archivos SIN autenticación.
-- Ejecutado en producción el 2026-08-29. Se versiona como documentación del
-- estado real de la BD (fuera del historial de migraciones de Supabase); no
-- re-ejecutar a ciegas.

DROP POLICY IF EXISTS "Permitir subir archivos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir eliminar archivos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir lectura publica" ON storage.objects;

CREATE POLICY "pedidos_adj_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'pedidos-adjuntos' AND (storage.foldername(name))[1] <> 'notificaciones');

CREATE POLICY "pedidos_adj_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pedidos-adjuntos' AND (storage.foldername(name))[1] <> 'notificaciones');
