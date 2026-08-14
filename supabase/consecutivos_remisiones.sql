-- ============================================================
-- Migración: Consecutivos automáticos para Remisiones
-- Tabla de contadores + funciones RPC + columna Reenvases
-- ============================================================

-- 1. Tabla de contadores
CREATE TABLE IF NOT EXISTS "consecutivos_remisiones" (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA')),
  ultimo_numero INT NOT NULL DEFAULT 0,
  UNIQUE(empresa, tipo)
);

-- Seed: 5 empresas × 2 tipos = 10 filas
INSERT INTO "consecutivos_remisiones" (empresa, tipo, ultimo_numero)
VALUES
  ('PARCELAR', 'ENTRADA', 0), ('PARCELAR', 'SALIDA', 0),
  ('GREEN',    'ENTRADA', 0), ('GREEN',    'SALIDA', 0),
  ('RESO',     'ENTRADA', 0), ('RESO',     'SALIDA', 0),
  ('IASO',     'ENTRADA', 0), ('IASO',     'SALIDA', 0),
  ('IAS',      'ENTRADA', 0), ('IAS',      'SALIDA', 0)
ON CONFLICT (empresa, tipo) DO NOTHING;

-- RLS
ALTER TABLE "consecutivos_remisiones" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consecutivos_rem_select"
  ON "consecutivos_remisiones" FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "consecutivos_rem_update"
  ON "consecutivos_remisiones" FOR UPDATE
  TO authenticated
  USING (get_user_role() IN ('admin','editor','despachador'))
  WITH CHECK (get_user_role() IN ('admin','editor','despachador'));

GRANT ALL ON "consecutivos_remisiones" TO authenticated;

-- 2. Función: generar un consecutivo individual
CREATE OR REPLACE FUNCTION generar_remision(
  p_empresa_nombre TEXT,
  p_tipo TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sigla TEXT;
  v_nuevo_numero INT;
  v_sufijo TEXT;
BEGIN
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
    RAISE EXCEPTION 'Empresa no reconocida: %', p_empresa_nombre;
  END IF;

  IF p_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
    RAISE EXCEPTION 'Tipo inválido: %. Debe ser ENTRADA o SALIDA', p_tipo;
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
$$;

-- 3. Función: generar par salida + entrada en una transacción
CREATE OR REPLACE FUNCTION generar_remision_dual(
  p_empresa_salida TEXT,
  p_empresa_entrada TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rem_salida TEXT;
  v_rem_entrada TEXT;
BEGIN
  v_rem_salida  := generar_remision(p_empresa_salida,  'SALIDA');
  v_rem_entrada := generar_remision(p_empresa_entrada, 'ENTRADA');

  RETURN jsonb_build_object(
    'remision_salida',  v_rem_salida,
    'remision_entrada', v_rem_entrada
  );
END;
$$;

-- 4. Nueva columna en Reenvases para remisión de entrada en traslados
ALTER TABLE "Reenvases"
  ADD COLUMN IF NOT EXISTS "Remision_Destino" TEXT DEFAULT '';
