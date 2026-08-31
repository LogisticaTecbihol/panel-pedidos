-- Permitir que cualquier usuario con permiso para adjuntar archivos
-- pueda tambien eliminar adjuntos del bucket pedidos-adjuntos
-- (p. ej. si se equivoco de archivo al subirlo).
--
-- Antes: solo admin, editor y comercial.
-- Ahora: el mismo conjunto de roles que AUTH.canUploadAdjuntos() en el frontend:
--   admin, editor, contabilidad, gerente_iaso, comercial, despachador, remisionador.
--
-- Los buckets ingresos-adjuntos, muestras-adjuntos y cambios-adjuntos ya
-- permiten DELETE a cualquier usuario autenticado, por lo que no requieren cambios.
-- El prefijo notificaciones/ conserva su politica propia (notif_storage_delete, admin).

DROP POLICY IF EXISTS "adjuntos_pedidos_delete" ON storage.objects;

CREATE POLICY "adjuntos_pedidos_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pedidos-adjuntos'
    AND (storage.foldername(name))[1] <> 'notificaciones'
    AND get_user_role() IN (
      'admin', 'editor', 'contabilidad', 'gerente_iaso',
      'comercial', 'despachador', 'remisionador'
    )
  );
