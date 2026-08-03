-- ============================================================
-- FASE 4: Notificaciones in-app (envío de PDFs entre usuarios)
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- SEGURO: sólo crea la tabla notificaciones, sus índices/políticas
-- y las políticas de Storage sobre el bucket ya existente
-- `pedidos-adjuntos` bajo el prefijo notificaciones/.
--
-- Requiere: función get_user_role() (creada en auth_migration.sql)
--           tabla usuarios (creada en auth_migration.sql)
--           bucket `pedidos-adjuntos` (privado, ya existente).
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. TABLA: notificaciones
--    Una fila = un aviso in-app para un destinatario.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notificaciones (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  para_usuario_id   uuid        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  de_usuario_id     uuid        NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  modulo            text        NOT NULL
                    CHECK (modulo IN ('pedidos','devoluciones','cambios','muestras')),
  referencia        text,
  titulo            text        NOT NULL,
  mensaje           text,
  storage_path      text        NOT NULL,
  leida             boolean     NOT NULL DEFAULT false,
  leida_at          timestamptz
);

-- Para el dropdown (últimas no leídas del usuario actual).
CREATE INDEX IF NOT EXISTS idx_notif_para_leida_created
  ON notificaciones (para_usuario_id, leida, created_at DESC);


-- ══════════════════════════════════════════════════════════════
-- 2. ROW LEVEL SECURITY
--    - Un usuario sólo ve/actualiza sus propias notificaciones.
--    - Cualquier autenticado puede crear una notificación siempre
--      que la firme con su propio uid (de_usuario_id = auth.uid()).
--    - Sólo admin puede borrar.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_select_own"    ON notificaciones;
DROP POLICY IF EXISTS "notif_insert_authed" ON notificaciones;
DROP POLICY IF EXISTS "notif_update_own"    ON notificaciones;
DROP POLICY IF EXISTS "notif_delete_admin"  ON notificaciones;

CREATE POLICY "notif_select_own"
  ON notificaciones FOR SELECT
  TO authenticated
  USING (para_usuario_id = auth.uid() OR get_user_role() = 'admin');

CREATE POLICY "notif_insert_authed"
  ON notificaciones FOR INSERT
  TO authenticated
  WITH CHECK (de_usuario_id = auth.uid());

CREATE POLICY "notif_update_own"
  ON notificaciones FOR UPDATE
  TO authenticated
  USING (para_usuario_id = auth.uid())
  WITH CHECK (para_usuario_id = auth.uid());

CREATE POLICY "notif_delete_admin"
  ON notificaciones FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 3. GRANTS
-- ══════════════════════════════════════════════════════════════

GRANT ALL ON notificaciones TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 4. REALTIME
--    Habilitar la publicación de cambios para el canal Realtime
--    (así el cliente puede suscribirse con postgres_changes).
-- ══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notificaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notificaciones;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 5. STORAGE: políticas para el bucket `pedidos-adjuntos` bajo
--    el prefijo notificaciones/<para_usuario_id>/...
--
--    - INSERT: cualquier autenticado puede subir (el emisor).
--    - SELECT: sólo el destinatario cuya UID matchea la segunda
--              carpeta del path, o admin.
--    - DELETE: sólo admin.
--
--    NOTA: estas políticas se suman a las existentes del bucket;
--    no reemplazan las políticas ya activas para otros prefijos.
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "notif_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "notif_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "notif_storage_delete" ON storage.objects;

CREATE POLICY "notif_storage_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pedidos-adjuntos'
    AND (storage.foldername(name))[1] = 'notificaciones'
  );

CREATE POLICY "notif_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pedidos-adjuntos'
    AND (storage.foldername(name))[1] = 'notificaciones'
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR get_user_role() = 'admin'
    )
  );

CREATE POLICY "notif_storage_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pedidos-adjuntos'
    AND (storage.foldername(name))[1] = 'notificaciones'
    AND get_user_role() = 'admin'
  );


-- ══════════════════════════════════════════════════════════════
-- FIN FASE 4
-- ══════════════════════════════════════════════════════════════
