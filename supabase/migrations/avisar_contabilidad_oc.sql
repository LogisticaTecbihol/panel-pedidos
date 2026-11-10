-- ============================================================
-- Migración: avisar_contabilidad_oc — la contabilidad de las empresas de una
--            Orden de Compra se entera EN EL MOMENTO de que se aprueba, se
--            rechaza o se legaliza (antes solo se enteraba al despachar el pedido).
--
-- Problema: al aprobar una OC, ordenes.js solo avisaba a quien la creó
-- (_notifyCreadorAprobacionOC) y al crearla, a los aprobadores de la empresa
-- ORIGEN (find_oc_approvers). La contabilidad de la empresa DESTINO (la que
-- recibe el stock) no recibía nada hasta que se despachaba el pedido (paquete de
-- remisiones de pedidos.js) o, si la OC se legalizaba después, el «complemento
-- tardío» (_avisarContabilidadTrasladoTardio). Caso real: OC 621 (IASO ← PARCELAR),
-- aprobada el 29/10 y legalizada el 05/11 sin que la contabilidad de IASO lo supiera.
--
-- Solución: un trigger AFTER INSERT/UPDATE sobre "OrdenesCompra" que inserta un
-- aviso en `notificaciones` (módulo 'ordenes'; la campanita ya lo recibe por
-- Realtime con sonido y contador, y al hacer clic abre Órdenes en esa OC) para la
-- contabilidad activa de la empresa destino Y de la origen. Vive en la base para
-- que funcione sin importar quién ni desde qué pantalla se apruebe, y sin depender
-- del navegador del aprobador.
--
-- Eventos (uno por OC, no por línea):
--   • aprobada    Estado_Aprobacion pasa a 'Aprobada' (o la OC nace ya aprobada).
--   • rechazada   Estado_Aprobacion pasa a 'Rechazada' (incluye el motivo).
--   • legalizada  Remision (entrada) o Remision_Origen (salida) pasa de vacío a lleno
--                 en una OC aprobada y no anulada.
--
-- Reglas:
--   • No se avisa a quien ejecutó la acción (auth.uid()), igual que NOTIF.notifyUsers.
--   • En aprobada / rechazada tampoco al creador de la OC: ya recibe su propio aviso
--     desde ordenes.js («Tu OC fue aprobada…»), así no le llegan dos.
--   • Sin duplicados: aprobada/rechazada no repiten el mismo aviso dentro de 10 min
--     (una aprobación actualiza todas las líneas de golpe); legalizada y pendiente
--     solo una vez por OC y persona (la legalización actualiza línea por línea).
--   • OC sin Consecutivo (filas históricas) no avisan.
--   • Quién es «contabilidad de una empresa»: usuarios activos con rol 'contabilidad'
--     y esa empresa en usuario_empresas (misma regla que list_contabilidad_por_empresa).
--     Empresas que no son del holding (CHIA ABAGO) no tienen contabilidad: no avisan.
--   • NUNCA bloquea aprobar / rechazar / legalizar: cualquier fallo queda como WARNING.
--   • Las funciones no son llamables por clientes (REVOKE a public/anon/authenticated).
--
-- Aviso único (final del archivo): las OC ya aprobadas y aún sin legalizar (con
-- consecutivo y fecha de aprobación; las filas históricas sin consecutivo se omiten)
-- avisan una vez a su contabilidad con el evento 'pendiente'. Idempotente: volver a
-- correr la migración no repite avisos.
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase ANTES de documentar
-- el cambio. No requiere cambios en el frontend.
-- Fecha: 2026-11-10
-- ============================================================


-- ── 1. Destinatarios: contabilidad activa de las empresas destino y origen ──
CREATE OR REPLACE FUNCTION public._oc_contabilidad_destinatarios(p_destino text, p_origen text)
RETURNS TABLE (usuario_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ue.usuario_id
    FROM usuario_empresas ue
    JOIN usuarios u ON u.id = ue.usuario_id
    JOIN empresas e ON e.sigla = ue.empresa_sigla
   WHERE u.rol = 'contabilidad'
     AND u.activo
     AND (e.nombre_completo IN (p_destino, p_origen) OR e.sigla IN (p_destino, p_origen));
$function$;


-- ── 2. Avisa de UN evento de UNA OC (grupo Destino+Origen+Consecutivo) ──
--    Devuelve cuántos avisos insertó.
CREATE OR REPLACE FUNCTION public._oc_avisar_contabilidad(
  p_evento      text,          -- 'aprobada' | 'rechazada' | 'legalizada' | 'pendiente'
  p_destino     text,
  p_origen      text,
  p_consecutivo text,
  p_actor       uuid DEFAULT NULL,   -- quien ejecutó la acción (no se le avisa)
  p_excluir     uuid DEFAULT NULL    -- otra persona a omitir (el creador de la OC)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g        record;
  v_sd     text;
  v_so     text;
  v_titulo text;
  v_msg    text;
  v_ref    text;
  v_ins    integer := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_consecutivo, '')), '') IS NULL THEN RETURN 0; END IF;
  IF p_evento NOT IN ('aprobada', 'rechazada', 'legalizada', 'pendiente') THEN RETURN 0; END IF;

  SELECT COUNT(*)                                   AS n,
         MAX(NULLIF(btrim("Ref_Pedido"), ''))       AS ref,
         MAX(NULLIF(btrim("Aprobada_Por"), ''))     AS aprobada_por,
         MAX("Fecha_Aprobacion")                    AS fecha_apr,
         MAX(NULLIF(btrim("Motivo_Rechazo"), ''))   AS motivo,
         MAX(NULLIF(btrim("Remision"), ''))         AS rem_e,
         MAX(NULLIF(btrim("Remision_Origen"), ''))  AS rem_s
    INTO g
    FROM "OrdenesCompra"
   WHERE "Empresa_Destino" IS NOT DISTINCT FROM p_destino
     AND "Empresa_Origen"  IS NOT DISTINCT FROM p_origen
     AND "Consecutivo" = p_consecutivo;
  IF g.n = 0 THEN RETURN 0; END IF;

  v_sd := COALESCE((SELECT sigla FROM empresas WHERE nombre_completo = p_destino OR sigla = p_destino LIMIT 1), p_destino, '?');
  v_so := COALESCE((SELECT sigla FROM empresas WHERE nombre_completo = p_origen  OR sigla = p_origen  LIMIT 1), p_origen,  '?');
  v_ref := COALESCE(' · Ref: ' || g.ref, '');

  IF p_evento = 'aprobada' THEN
    v_titulo := '✅ OC aprobada: ' || v_sd || ' ← ' || v_so || ' #' || p_consecutivo;
    v_msg    := g.n || ' línea(s)' || v_ref ||
                COALESCE(' · Aprobó: ' || g.aprobada_por, '') ||
                CASE WHEN g.rem_e IS NULL THEN ' · Falta legalizar' ELSE '' END;
  ELSIF p_evento = 'rechazada' THEN
    v_titulo := '❌ OC rechazada: ' || v_sd || ' ← ' || v_so || ' #' || p_consecutivo;
    v_msg    := 'Motivo: ' || COALESCE(g.motivo, 'sin motivo') || ' · ' || g.n || ' línea(s)' || v_ref;
  ELSIF p_evento = 'legalizada' THEN
    v_titulo := '📦 OC legalizada: ' || v_sd || ' ← ' || v_so || ' #' || p_consecutivo;
    v_msg    := g.n || ' línea(s)' || v_ref ||
                COALESCE(' · Remisión entrada: ' || g.rem_e, '') ||
                COALESCE(' · Remisión salida: ' || g.rem_s, '');
  ELSE  -- 'pendiente' (aviso único de las ya aprobadas sin legalizar)
    v_titulo := '⏳ OC aprobada sin legalizar: ' || v_sd || ' ← ' || v_so || ' #' || p_consecutivo;
    v_msg    := g.n || ' línea(s)' || v_ref ||
                COALESCE(' · Aprobada el ' || to_char(g.fecha_apr AT TIME ZONE 'America/Bogota', 'DD/MM'), '') ||
                COALESCE(' por ' || g.aprobada_por, '') || ' · Aviso único: falta legalizarla';
  END IF;

  INSERT INTO notificaciones (para_usuario_id, de_usuario_id, modulo, referencia, titulo, mensaje, storage_path)
  SELECT d.usuario_id,
         (SELECT u.id FROM usuarios u WHERE u.id = p_actor),   -- solo si existe en usuarios (FK)
         'ordenes', p_consecutivo, v_titulo, v_msg, NULL
    FROM public._oc_contabilidad_destinatarios(p_destino, p_origen) d
   WHERE d.usuario_id IS DISTINCT FROM p_actor
     AND d.usuario_id IS DISTINCT FROM p_excluir
     AND NOT EXISTS (
       SELECT 1 FROM notificaciones n
        WHERE n.para_usuario_id = d.usuario_id
          AND n.modulo = 'ordenes'
          AND n.referencia = p_consecutivo
          AND n.titulo = v_titulo
          AND (p_evento IN ('legalizada', 'pendiente')
               OR n.created_at > now() - interval '10 minutes')
     );
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RETURN v_ins;
END;
$function$;


-- ── 3. Trigger sobre OrdenesCompra ──
CREATE OR REPLACE FUNCTION public.fn_oc_avisar_contabilidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NULLIF(btrim(COALESCE(NEW."Consecutivo", '')), '') IS NULL THEN RETURN NEW; END IF;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW."Estado_Aprobacion" = 'Aprobada' THEN
        PERFORM public._oc_avisar_contabilidad('aprobada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                               NEW."Consecutivo", v_actor, NEW."creado_por");
      END IF;
    ELSE
      IF NEW."Estado_Aprobacion" IS DISTINCT FROM OLD."Estado_Aprobacion" THEN
        IF NEW."Estado_Aprobacion" = 'Aprobada' THEN
          PERFORM public._oc_avisar_contabilidad('aprobada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                                 NEW."Consecutivo", v_actor, NEW."creado_por");
        ELSIF NEW."Estado_Aprobacion" = 'Rechazada' THEN
          PERFORM public._oc_avisar_contabilidad('rechazada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                                 NEW."Consecutivo", v_actor, NEW."creado_por");
        END IF;
      END IF;

      IF NEW."Estado_Aprobacion" = 'Aprobada'
         AND COALESCE(NEW."Estado", '') <> 'Anulada'
         AND ( (COALESCE(btrim(OLD."Remision"), '')        = '' AND COALESCE(btrim(NEW."Remision"), '')        <> '')
            OR (COALESCE(btrim(OLD."Remision_Origen"), '') = '' AND COALESCE(btrim(NEW."Remision_Origen"), '') <> '') ) THEN
        PERFORM public._oc_avisar_contabilidad('legalizada', NEW."Empresa_Destino", NEW."Empresa_Origen",
                                               NEW."Consecutivo", v_actor, NULL);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_oc_avisar_contabilidad(OC id %): %', NEW."id", SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_oc_avisar_contabilidad ON "OrdenesCompra";
CREATE TRIGGER trg_oc_avisar_contabilidad
  AFTER INSERT OR UPDATE OF "Estado_Aprobacion", "Remision", "Remision_Origen" ON "OrdenesCompra"
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_avisar_contabilidad();


-- ── 4. Permisos: nada de esto se llama desde el cliente ──
REVOKE ALL ON FUNCTION public._oc_contabilidad_destinatarios(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._oc_avisar_contabilidad(text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_oc_avisar_contabilidad() FROM PUBLIC, anon, authenticated;


-- ── 5. Aviso único: OC ya aprobadas y aún sin legalizar ──
DO $$
DECLARE
  g record;
  v_total integer := 0;
BEGIN
  FOR g IN
    SELECT DISTINCT "Empresa_Destino" AS d, "Empresa_Origen" AS o, "Consecutivo" AS c
      FROM "OrdenesCompra"
     WHERE "Estado_Aprobacion" = 'Aprobada'
       AND "Estado" = 'Abierta'
       AND COALESCE(btrim("Remision"), '') = ''
       AND NULLIF(btrim(COALESCE("Consecutivo", '')), '') IS NOT NULL
       AND "Fecha_Aprobacion" IS NOT NULL
  LOOP
    v_total := v_total + public._oc_avisar_contabilidad('pendiente', g.d, g.o, g.c, NULL, NULL);
  END LOOP;
  RAISE NOTICE 'avisar_contabilidad_oc: % aviso(s) único(s) de OC aprobadas sin legalizar', v_total;
END $$;
