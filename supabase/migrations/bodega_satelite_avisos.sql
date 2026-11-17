-- ════════════════════════════════════════════════════════════════════════════
-- Bodegas satélite / consignación — PARTE 2 de 5: avisos a la campanita de la principal
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere: bodega_satelite_tablas.sql (solo para el orden; no depende de sus tablas en tiempo de creación).
--
-- QUÉ HACE:
--   1. Amplía notificaciones_modulo_check con 'bodegas' (solo AGREGA un valor: ningún aviso
--      existente cambia). Es lo único que toca de objetos existentes en esta parte.
--   2. Crea _bodega_avisar(): inserta un aviso en `notificaciones` (módulo 'bodegas') para la
--      contabilidad ACTIVA de la empresa de la bodega y para los administradores. Mismo patrón
--      que _oc_avisar_contabilidad (avisar_contabilidad_oc.sql): la campanita lo recibe por
--      Realtime y NOTIF.destino lo enruta a bodegas-consignacion.html (js/notificaciones.js).
--   3. NUNCA bloquea la operación de la bodega: cualquier fallo queda como WARNING.
--   4. No se avisa dos veces lo mismo: el mismo título + referencia a la misma persona se omite.
--
-- Se usa para: recepción con diferencia (de la principal o entre bodegas). Solicitudes y
-- devoluciones (fase 2) reutilizarán esta misma función.
--
-- Idempotente. Rollback: bodega_satelite_avisos_rollback.sql (no borra los avisos ya enviados,
-- pero SÍ los borra si hay filas con módulo 'bodegas' para poder restaurar el CHECK anterior).
-- Aplicar con apply_migration del MCP ANTES de publicar el código.
-- Fecha: 2026-11-17
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. CHECK del módulo: + 'bodegas' ────────────────────────────────────────
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_modulo_check CHECK (
  modulo = ANY (ARRAY['pedidos', 'devoluciones', 'cambios', 'muestras', 'ordenes', 'ingresos',
                      'reenvases', 'kardex', 'reportes', 'crm', 'solicitudes_mercadeo', 'bodegas']::text[])
);

-- ── 2. _bodega_avisar ───────────────────────────────────────────────────────
-- Destinatarios: contabilidad activa de la empresa de la bodega + administradores activos.
-- Devuelve cuántos avisos insertó.
CREATE OR REPLACE FUNCTION public._bodega_avisar(
  p_bodega  bigint,
  p_titulo  text,
  p_mensaje text,
  p_ref     text
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp text;
  v_ins integer := 0;
BEGIN
  SELECT btrim(b."Nombre_Empresa") INTO v_emp FROM "BodegasConsignacion" b WHERE b.id = p_bodega;
  IF v_emp IS NULL OR NULLIF(btrim(COALESCE(p_titulo, '')), '') IS NULL THEN RETURN 0; END IF;

  INSERT INTO notificaciones (para_usuario_id, de_usuario_id, modulo, referencia, titulo, mensaje, storage_path)
  SELECT d.usuario_id, NULL, 'bodegas', p_ref, p_titulo, p_mensaje, NULL
    FROM (
      SELECT x.usuario_id FROM public._oc_contabilidad_destinatarios(v_emp, v_emp) x
      UNION
      SELECT u.id FROM usuarios u WHERE u.rol = 'admin' AND u.activo
    ) d
   WHERE NOT EXISTS (
     SELECT 1 FROM notificaciones n
      WHERE n.para_usuario_id = d.usuario_id
        AND n.modulo = 'bodegas'
        AND n.referencia IS NOT DISTINCT FROM p_ref
        AND n.titulo = p_titulo
   );
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RETURN v_ins;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_bodega_avisar(bodega %): %', p_bodega, SQLERRM;
  RETURN 0;
END;
$function$;

-- Interna: no llamable por clientes.
REVOKE ALL ON FUNCTION public._bodega_avisar(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
