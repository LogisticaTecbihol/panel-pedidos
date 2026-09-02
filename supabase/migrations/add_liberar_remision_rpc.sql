-- ─────────────────────────────────────────────────────────────────────────────
-- liberar_remision(): devuelve al contador un consecutivo de remisión que se
-- generó pero cuyo guardado falló, para que no quede "quemado".
--
-- Contexto: generar_remision() incrementa consecutivos_remisiones de inmediato.
-- Si el INSERT/UPDATE que debía guardar la remisión falla (bug, RLS, red...),
-- el número se pierde y aparece un salto en el listado (ej. IAS-RS-0021, que se
-- quemó al fallar Gestionar Cambio por la columna Cant_Entregada faltante).
--
-- Esta función revierte el contador SOLO si es seguro:
--   1. La remisión NO quedó en ningún registro de movimiento.
--   2. El contador sigue exactamente en ese número (nadie generó otro después).
-- Si cualquiera de las dos falla, no hace nada y devuelve false (el número
-- queda genuinamente quemado; se puede anotar a mano en Remisiones anuladas).
--
-- Autorización: mismo criterio que generar_remision (rol + empresa).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION liberar_remision(
  p_empresa_nombre text,
  p_tipo text,
  p_remision text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sigla text;
  v_num int;
  v_rem text := TRIM(COALESCE(p_remision, ''));
  v_referenciada boolean;
  v_liberada boolean := false;
BEGIN
  IF NOT (public.user_has_company(p_empresa_nombre)
          AND public.get_user_role() = ANY (ARRAY['admin','editor','despachador','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_rem = '' OR p_tipo NOT IN ('ENTRADA','SALIDA') THEN
    RETURN false;
  END IF;

  v_sigla := CASE
    WHEN TRIM(p_empresa_nombre) ILIKE '%PARCELAR%' THEN 'PARCELAR'
    WHEN TRIM(p_empresa_nombre) ILIKE '%GREEN%'    THEN 'GREEN'
    WHEN TRIM(p_empresa_nombre) ILIKE '%RESO%'     THEN 'RESO'
    WHEN TRIM(p_empresa_nombre) ILIKE '%INSUMOS AGROPECUARIOS SOSTENIBLES%' THEN 'IASO'
    WHEN TRIM(p_empresa_nombre) ILIKE '%INSUMOS AGROPECUARIOS DE LA SABANA%' THEN 'IAS'
    WHEN TRIM(p_empresa_nombre) = 'PARCELAR' THEN 'PARCELAR'
    WHEN TRIM(p_empresa_nombre) = 'GREEN'    THEN 'GREEN'
    WHEN TRIM(p_empresa_nombre) = 'RESO'     THEN 'RESO'
    WHEN TRIM(p_empresa_nombre) = 'IASO'     THEN 'IASO'
    WHEN TRIM(p_empresa_nombre) = 'IAS'      THEN 'IAS'
    ELSE NULL
  END;
  IF v_sigla IS NULL THEN
    RETURN false;
  END IF;

  -- Número final de la remisión: 'IAS-RS-0021' -> 21
  v_num := NULLIF(regexp_replace(v_rem, '\D', '', 'g'), '')::int;
  IF v_num IS NULL THEN
    RETURN false;
  END IF;

  -- Guard 1: ¿la remisión ya quedó en algún registro? Si sí, NO se libera
  -- (reutilizar el número generaría una remisión duplicada).
  SELECT EXISTS (
              SELECT 1 FROM "Pedidos"            WHERE "Remisiones"       LIKE '%' || v_rem || '%'
    UNION ALL SELECT 1 FROM "EntregasPedido"     WHERE "remision"         = v_rem
    UNION ALL SELECT 1 FROM "Ingresos"           WHERE "Remision_Origen"  = v_rem OR "Remision_Destino" = v_rem
    UNION ALL SELECT 1 FROM "OrdenesCompra"      WHERE "Remision"         = v_rem OR "Remision_Origen"  = v_rem
    UNION ALL SELECT 1 FROM "SolicitudMuestras"  WHERE "Remision"         = v_rem
    UNION ALL SELECT 1 FROM "Reenvases"          WHERE "Remision"         = v_rem OR "Remision_Destino" = v_rem
    UNION ALL SELECT 1 FROM "Devoluciones"       WHERE "Remision"         = v_rem OR "Remision_Ingreso" = v_rem OR "Remision_Salida" = v_rem
    UNION ALL SELECT 1 FROM "CambiosMercancia"   WHERE "Remision_Ingreso" = v_rem OR "Remision_Salida"  = v_rem
    UNION ALL SELECT 1 FROM "KardexNC"           WHERE "Remision"         = v_rem
    UNION ALL SELECT 1 FROM "RemisionesAnuladas" WHERE "Remision"         = v_rem
  ) INTO v_referenciada;

  IF v_referenciada THEN
    RETURN false;
  END IF;

  -- Guard 2: solo revertir si el contador sigue exactamente en ese número.
  UPDATE "consecutivos_remisiones"
  SET ultimo_numero = ultimo_numero - 1
  WHERE empresa = v_sigla AND tipo = p_tipo AND ultimo_numero = v_num
  RETURNING true INTO v_liberada;

  RETURN COALESCE(v_liberada, false);
END;
$$;

REVOKE ALL ON FUNCTION liberar_remision(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION liberar_remision(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION liberar_remision(text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
