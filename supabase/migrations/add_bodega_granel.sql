-- ============================================================
-- Bodega GRANEL (2026-09-21)
-- Bodega de bidones de segunda de las plantas de producción (materia prima
-- intermedia). Se modela como una "empresa" más en la tabla `empresas` para
-- reutilizar permisos (usuario_empresas / user_has_company), RLS y el RPC de
-- consecutivos de remisión: GRANEL-RE-0001 (entrada) / GRANEL-RS-0001 (salida).
--
-- En el front, GRANEL NO forma parte de EMPRESAS_HOLDING (ventas, dashboard,
-- consolidados): vive en EMPRESA_GRANEL / EMPRESAS_TODAS (js/shared.js).
--
-- Incluye además el rol `produccion` (solo recibe remisiones; sin RLS de
-- escritura porque las políticas listan los roles con permiso explícito).
--
-- Aplicar con apply_migration del MCP (el push a GitHub NO la aplica).
-- ============================================================

-- 1. Empresa GRANEL (sigla = nombre_completo para que el fallback getSigla(n)||n
--    de las copias locales de SIGLAS en el front ya devuelva 'GRANEL').
INSERT INTO empresas (sigla, nombre_completo, activa)
VALUES ('GRANEL', 'GRANEL', true)
ON CONFLICT (sigla) DO NOTHING;

-- 2. Contadores de remisión propios.
INSERT INTO "consecutivos_remisiones" (empresa, tipo, ultimo_numero)
VALUES ('GRANEL', 'ENTRADA', 0), ('GRANEL', 'SALIDA', 0)
ON CONFLICT (empresa, tipo) DO NOTHING;

-- 3. generar_remision: rama GRANEL en el CASE de sigla.
CREATE OR REPLACE FUNCTION public.generar_remision(p_empresa_nombre text, p_tipo text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sigla TEXT;
  v_nuevo_numero INT;
  v_sufijo TEXT;
BEGIN
  IF NOT (public.user_has_company(p_empresa_nombre)
          AND public.get_user_role() = ANY(ARRAY['admin','editor','despachador','remisionador'])) THEN
    RAISE EXCEPTION 'No autorizado';
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
    WHEN UPPER(TRIM(p_empresa_nombre)) = 'GRANEL' THEN 'GRANEL'
    ELSE NULL
  END;

  IF v_sigla IS NULL THEN
    RAISE EXCEPTION 'Empresa no reconocida: %', p_empresa_nombre;
  END IF;

  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RAISE EXCEPTION 'Tipo invalido: %. Debe ser ENTRADA o SALIDA', p_tipo;
  END IF;

  v_sufijo := CASE WHEN p_tipo = 'ENTRADA' THEN 'RE' ELSE 'RS' END;

  UPDATE "consecutivos_remisiones"
  SET ultimo_numero = ultimo_numero + 1
  WHERE empresa = v_sigla AND tipo = p_tipo
  RETURNING ultimo_numero INTO v_nuevo_numero;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consecutivo no encontrado para empresa=%, tipo=%', v_sigla, p_tipo;
  END IF;

  RETURN v_sigla || '-' || v_sufijo || '-' || LPAD(v_nuevo_numero::TEXT, 4, '0');
END;
$function$;

-- 4. liberar_remision: misma rama GRANEL (el CASE está duplicado).
CREATE OR REPLACE FUNCTION public.liberar_remision(p_empresa_nombre text, p_tipo text, p_remision text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHEN UPPER(TRIM(p_empresa_nombre)) = 'GRANEL' THEN 'GRANEL'
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
$function$;

-- 5. Rol `produccion`: recibe las remisiones de GRANEL (solo lectura).
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin','editor','lector','comercial','despachador','contabilidad','gerente_iaso','remisionador','cartera','produccion'));

NOTIFY pgrst, 'reload schema';
