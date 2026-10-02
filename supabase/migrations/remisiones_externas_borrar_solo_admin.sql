-- ============================================================
-- Remisiones externas (Chia Abago / materia prima): borrar es solo del administrador
--
-- Antes: RemisionesExternas_delete dejaba borrar a cualquier usuario con el
-- módulo 'legalizacion_gastos'. Ahora solo el administrador (usuarios.rol =
-- 'admin', vía get_user_role()), igual que el botón 🗑 de la pestaña
-- "Remisiones externas" y el de la ventana ✎, que solo ven los admin.
--
-- Una excepción acotada: quien creó la remisión puede borrar SU cabecera si aún
-- no tiene productos y la creó hace menos de 5 minutos. Es la limpieza del "alta
-- a medias" de guardarRemisionExterna (shared.js): se inserta la cabecera, luego
-- las líneas, y si las líneas fallan la cabecera vacía se borra para no dejar el
-- número ocupado. Sin esta excepción esa limpieza fallaría en silencio para un
-- usuario que no es admin.
--
-- No cambia:
--   * RemisionesExternasItems_delete: editar una remisión reemplaza sus líneas
--     (inserta las nuevas y borra las viejas), así que sigue abierto al módulo.
--   * El trigger proteger_remision_externa_en_uso: ni siquiera el admin puede
--     borrar o renumerar una remisión que esté en una legalización/envío no
--     rechazado.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

DROP POLICY IF EXISTS "RemisionesExternas_delete" ON public."RemisionesExternas";
CREATE POLICY "RemisionesExternas_delete" ON public."RemisionesExternas" FOR DELETE TO authenticated
  USING (
    public.get_user_role() = 'admin'
    OR (
      public.user_has_module('legalizacion_gastos')
      AND creado_por = auth.uid()
      AND creado_en > now() - interval '5 minutes'
      AND NOT EXISTS (SELECT 1 FROM public."RemisionesExternasItems" i WHERE i."Remision_Id" = "RemisionesExternas".id)
    )
  );

NOTIFY pgrst, 'reload schema';
