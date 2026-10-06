-- ============================================================
-- Migración: estado intermedio "Revisado – en espera" para el pedido de un
-- cliente nuevo pendiente de aprobación.
--
-- Cartera revisa el pedido pero todavía no puede aprobarlo ni rechazarlo
-- (falta un documento, una referencia, el cupo, etc.). En vez de dejarlo igual
-- que uno sin mirar, lo marca "Revisado – en espera" con una observación
-- obligatoria; el comercial la ve en Pedidos.
--
-- NO es un Estado_2 nuevo: el pedido sigue siendo 'Pendiente de aprobación'
-- (mismos vetos, mismos filtros y conteos en Dashboard/Reportes). Solo se
-- anotan quién, cuándo y por qué lo dejó en espera. El estado "en espera" es:
--   Estado_2 = 'Pendiente de aprobación' AND Revision_En IS NOT NULL
-- Al aprobar/rechazar, Revision_* queda como historial (ya no aplica porque
-- el pedido deja de estar pendiente).
-- ============================================================

-- 1) Trazabilidad de la revisión (último registro; el historial completo
--    queda en audit_log)
ALTER TABLE public."Pedidos"
  ADD COLUMN IF NOT EXISTS "Revision_Por_Nombre" text,
  ADD COLUMN IF NOT EXISTS "Revision_En"         timestamptz,
  ADD COLUMN IF NOT EXISTS "Revision_Nota"       text;

-- 2) Dejar el pedido "Revisado – en espera" (Cartera y admin). Se puede volver
--    a llamar para actualizar la observación. Recibe los ids de línea del
--    pedido (empresa + consecutivo no bastan: otro cliente puede compartir el
--    N°) y marca TODAS las líneas pendientes de ese mismo pedido.
CREATE OR REPLACE FUNCTION public.marcar_revision_pedido(
  p_pedido_ids bigint[],
  p_nota       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol      text := public.get_user_role();
  v_empresa  text;
  v_consec   text;
  v_cliente  text;
  v_pedidos  int;
  v_n        int;
BEGIN
  IF COALESCE(v_rol, '') NOT IN ('admin', 'cartera') THEN
    RAISE EXCEPTION 'No autorizado: solo Cartera o administración pueden dejar un pedido en revisión';
  END IF;
  IF p_pedido_ids IS NULL OR array_length(p_pedido_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Faltan las líneas del pedido';
  END IF;
  IF btrim(COALESCE(p_nota, '')) = '' THEN
    RAISE EXCEPTION 'Indica la observación: la razón por la que todavía no se aprueba';
  END IF;

  SELECT count(DISTINCT ("Nombre_Empresa" || '||' || "Consecutivo" || '||' || COALESCE("Cliente", ''))),
         min("Nombre_Empresa"), min("Consecutivo"), min("Cliente")
    INTO v_pedidos, v_empresa, v_consec, v_cliente
    FROM "Pedidos"
   WHERE id = ANY(p_pedido_ids);

  IF v_pedidos <> 1 THEN
    RAISE EXCEPTION 'Las líneas no corresponden a un único pedido';
  END IF;

  UPDATE "Pedidos"
     SET "Revision_Por_Nombre" = public._usuario_nombre(auth.uid()),
         "Revision_En"         = now(),
         "Revision_Nota"       = btrim(p_nota),
         modificado_por        = auth.uid()
   WHERE "Nombre_Empresa" = v_empresa
     AND "Consecutivo"    = v_consec
     AND "Cliente" IS NOT DISTINCT FROM v_cliente
     AND "Estado_2" = 'Pendiente de aprobación';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'El pedido ya no está pendiente de aprobación';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_revision_pedido(bigint[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marcar_revision_pedido(bigint[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.marcar_revision_pedido(bigint[], text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
