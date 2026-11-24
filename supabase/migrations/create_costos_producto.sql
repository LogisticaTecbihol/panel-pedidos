-- ============================================================
-- Dashboard → pestaña «Rentabilidad IASO»: COSTO UNITARIO MANUAL por producto
--
-- Pedido 2026-11-24. La pestaña estima la rentabilidad bruta de lo remisionado por IASO
-- (precio de venta del pedido vs. costo = precio Mayorista de la proveedora). Cuando el costo
-- automático no existe o no es el correcto, un administrador digita el costo unitario a mano.
--
-- Modelo: tabla CostosProducto — UN costo vigente por (empresa, producto). Sin fechas de vigencia:
-- el costo se aplica a todo el período que se consulte; los cambios quedan en audit_log (quién y
-- cuándo, con el valor anterior). «Restablecer» (volver al costo automático) borra la fila.
--   * "Empresa": nombre completo de una empresa del holding (hoy solo se usa IASO, pero la tabla
--     queda lista para otras).
--   * "Producto": el nombre como viene en Pedidos (con presentación: «NEEM GREEN X LITRO»).
--   * "Producto_Clave": columna GENERADA = nombre sin tildes, en minúsculas y con espacios
--     colapsados. Es la clave de unicidad y con la que se empareja el producto de los pedidos
--     (mismo criterio que dNormLp en dashboard.js y _normStr en pedidos.js).
--   * "Costo_Unitario": costo por unidad (> 0). «Sin costo» = no hay fila.
--
-- Permisos (RLS): SOLO administrador (ver, crear, editar y borrar). Decisión del usuario.
--
-- Aplicar con apply_migration (MCP) ANTES de publicar el código (la pestaña lee la tabla; si
-- falta, avisa «aplica la migración» y no deja editar, pero el resto del Dashboard sigue igual).
-- Reversión: create_costos_producto_rollback.sql
-- ============================================================

-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."CostosProducto" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Empresa"                text NOT NULL,
  "Producto"               text NOT NULL,
  "Producto_Clave"         text GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(translate("Producto", 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))
  ) STORED,
  "Costo_Unitario"         numeric NOT NULL,
  "Nota"                   text NOT NULL DEFAULT '',
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz,
  CONSTRAINT costos_producto_empresa_valida CHECK ("Empresa" IN (
    'PARCELAR DE COLOMBIA SAS', 'GREEN AGROSOLUCIONES DE COLOMBIA SAS', 'SOLUCIONES INTEGRALES RESO SAS',
    'INSUMOS AGROPECUARIOS SOSTENIBLES SAS', 'INSUMOS AGROPECUARIOS DE LA SABANA SAS')),
  CONSTRAINT costos_producto_producto_valido CHECK (btrim("Producto") <> '' AND length("Producto") <= 200),
  CONSTRAINT costos_producto_costo_valido    CHECK ("Costo_Unitario" > 0 AND "Costo_Unitario" < 1000000000000),
  CONSTRAINT costos_producto_nota_corta      CHECK (length("Nota") <= 300)
);

COMMENT ON TABLE public."CostosProducto" IS
  'Costo unitario MANUAL por (empresa, producto) para la pestaña Rentabilidad del Dashboard. Un valor vigente por producto; los cambios quedan en audit_log. Solo administrador.';

-- Un solo costo por empresa y producto (sin importar mayúsculas, tildes ni espacios repetidos).
CREATE UNIQUE INDEX IF NOT EXISTS costos_producto_empresa_clave_unico
  ON public."CostosProducto" ("Empresa", "Producto_Clave");

-- ── 2. Normalización de lo que escribe el cliente ──
CREATE OR REPLACE FUNCTION public.fn_costos_producto_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW."Empresa"  := btrim(NEW."Empresa");
  NEW."Producto" := btrim(regexp_replace(NEW."Producto", '\s+', ' ', 'g'));
  NEW."Nota"     := btrim(COALESCE(NEW."Nota", ''));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_costos_producto_guard() FROM PUBLIC, anon, authenticated;

-- ── 3. Triggers (mismo orden que el resto de tablas: normalizar, auditoría de fila, audit_log) ──
DROP TRIGGER IF EXISTS trg_costos_producto_guard ON public."CostosProducto";
CREATE TRIGGER trg_costos_producto_guard
  BEFORE INSERT OR UPDATE ON public."CostosProducto"
  FOR EACH ROW EXECUTE FUNCTION public.fn_costos_producto_guard();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."CostosProducto";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."CostosProducto"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."CostosProducto";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."CostosProducto"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 4. RLS: solo administrador ──
ALTER TABLE public."CostosProducto" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CostosProducto_select" ON public."CostosProducto";
CREATE POLICY "CostosProducto_select" ON public."CostosProducto" FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "CostosProducto_insert" ON public."CostosProducto";
CREATE POLICY "CostosProducto_insert" ON public."CostosProducto" FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "CostosProducto_update" ON public."CostosProducto";
CREATE POLICY "CostosProducto_update" ON public."CostosProducto" FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "CostosProducto_delete" ON public."CostosProducto";
CREATE POLICY "CostosProducto_delete" ON public."CostosProducto" FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

REVOKE ALL ON public."CostosProducto" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CostosProducto" TO authenticated;
GRANT ALL ON public."CostosProducto" TO service_role;

-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
