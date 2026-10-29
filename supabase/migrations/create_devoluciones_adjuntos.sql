-- ============================================================
-- Adjuntos de soporte de Devoluciones (devoluciones.html)
-- ============================================================
-- Bucket NO público (como legalizacion-gastos-adjuntos; los de pedidos/ingresos/
-- muestras/cambios son públicos): el detalle de la devolución pide URL firmada.
-- Mismos tipos y tope que el resto de adjuntos del panel, también a nivel de bucket
-- (defensa en profundidad además de la validación en js/adjuntos-soporte.js).
-- Quién puede leer / subir / borrar: cualquier usuario autenticado CON rol en el panel
-- (get_user_role() no nulo), igual que las políticas endurecidas de cambios-adjuntos
-- (harden_storage_write_policies.sql). La pantalla además limita borrar a
-- AUTH.canUploadAdjuntos() y subir desde el detalle a AUTH.canEdit().
-- Ruta de los objetos: <SIGLA>/<consecutivo>_<cliente>/<marca de tiempo>_<nombre>.
-- Idempotente. Rollback al final.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'devoluciones-adjuntos', 'devoluciones-adjuntos', false,
  5242880, ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "dev_adjuntos_select" ON storage.objects;
CREATE POLICY "dev_adjuntos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'devoluciones-adjuntos'
    AND (SELECT public.get_user_role()) IS NOT NULL
  );

DROP POLICY IF EXISTS "dev_adjuntos_insert" ON storage.objects;
CREATE POLICY "dev_adjuntos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'devoluciones-adjuntos'
    AND (SELECT public.get_user_role()) IS NOT NULL
  );

DROP POLICY IF EXISTS "dev_adjuntos_delete" ON storage.objects;
CREATE POLICY "dev_adjuntos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'devoluciones-adjuntos'
    AND (SELECT public.get_user_role()) IS NOT NULL
  );

-- ── ROLLBACK (solo si el bucket está vacío; Storage no deja borrar un bucket con objetos) ──
-- DROP POLICY IF EXISTS "dev_adjuntos_select" ON storage.objects;
-- DROP POLICY IF EXISTS "dev_adjuntos_insert" ON storage.objects;
-- DROP POLICY IF EXISTS "dev_adjuntos_delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'devoluciones-adjuntos';
