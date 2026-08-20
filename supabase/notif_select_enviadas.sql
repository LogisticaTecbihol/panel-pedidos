-- Permitir que un usuario vea también las notificaciones que ENVIÓ
-- (antes solo veía las recibidas: para_usuario_id = auth.uid()).
DROP POLICY IF EXISTS "notif_select_own" ON notificaciones;

CREATE POLICY "notif_select_own"
  ON notificaciones FOR SELECT
  TO authenticated
  USING (
    para_usuario_id = auth.uid()
    OR de_usuario_id = auth.uid()
    OR get_user_role() = 'admin'
  );
