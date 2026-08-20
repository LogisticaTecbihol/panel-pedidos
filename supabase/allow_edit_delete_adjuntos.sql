-- Permitir que usuarios con rol de edición (admin, editor, comercial)
-- puedan eliminar archivos adjuntos del bucket pedidos-adjuntos.
-- Aplica solo a rutas fuera del prefijo notificaciones/ (que tiene su propia política).

DROP POLICY IF EXISTS "adjuntos_pedidos_delete" ON storage.objects;

CREATE POLICY "adjuntos_pedidos_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pedidos-adjuntos'
    AND (storage.foldername(name))[1] != 'notificaciones'
    AND get_user_role() IN ('admin','editor','comercial')
  );
