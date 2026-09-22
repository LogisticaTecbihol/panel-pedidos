-- CRM de Mercadeo — permite borrar un lead cargado por error.
--
-- Hasta ahora Leads_delete solo dejaba borrar a admin/editor/mercadeo. Se
-- amplía para que 'comercial' también pueda borrar, pero SOLO los leads que
-- él mismo creó (creado_por = auth.uid()) — no los que le asignó otra
-- persona, para no darle a un comercial la posibilidad de borrar el trabajo
-- de otro. LeadsSeguimiento ya tiene ON DELETE CASCADE sobre Lead_Id, así
-- que sus seguimientos se limpian solos.
--
-- Idempotente. Aplicar con apply_migration (MCP).

DROP POLICY IF EXISTS "Leads_delete" ON public."Leads";
CREATE POLICY "Leads_delete" ON public."Leads" FOR DELETE TO authenticated
  USING (
    get_user_role() = ANY (ARRAY['admin','editor','mercadeo'])
    OR (get_user_role() = 'comercial' AND "creado_por" = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
