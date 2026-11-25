-- ============================================================
-- Dashboard → «Rentabilidad IASO»: CLASIFICACIÓN por producto (Fungicida, Insecticida, Bioestimulante…)
--
-- Pedido 2026-11-25. La pestaña de rentabilidad muestra una columna «Clasificación», ordena los productos
-- por ella y calcula la rentabilidad POR clasificación. La lista inicial viene de categorias.xlsx
-- (63 productos con clasificación; los demás —los 9 en blanco del archivo y los que no figuran en él—
-- quedan como «Otros», que NO se guarda: «Otros» = no hay fila). Se edita desde la pestaña.
--
-- Modelo: tabla ClasificacionProducto — UNA clasificación por producto (global, no por empresa: un
-- producto es el mismo en todas).
--   * "Producto": el nombre como viene en Pedidos (con presentación: «NEEM GREEN X LITRO»).
--   * "Producto_Clave": columna GENERADA = nombre sin tildes, en minúsculas y con espacios colapsados.
--     Es la clave de unicidad y con la que se empareja el producto de los pedidos (mismo criterio que
--     CostosProducto, dNormLp y Rentabilidad.clave).
--   * "Clasificacion": texto libre de 2 a 60 caracteres, NUNCA «Otros» (el CHECK lo impide; para dejar un
--     producto en «Otros» se borra su fila). El trigger conserva la grafía ya usada si la misma
--     clasificación llega escrita distinto («fungicida» → «Fungicida»), para no partirla en dos.
--   Los cambios quedan en audit_log (quién, cuándo y valor anterior). La carga inicial se hace ANTES de
--   crear los triggers de auditoría, para no llenar audit_log con 63 filas de una carga.
--
-- Permisos (RLS): SOLO administrador (ver, crear, editar y borrar), igual que CostosProducto.
--
-- Aplicar con apply_migration (MCP) ANTES de publicar el código (la pestaña lee la tabla; si falta, avisa
-- «aplica la migración», muestra todo como «Otros» y no deja editar; el resto sigue igual).
-- Reversión: create_clasificacion_producto_rollback.sql
-- ============================================================

-- ── 1. Tabla ──
CREATE TABLE IF NOT EXISTS public."ClasificacionProducto" (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "Producto"               text NOT NULL,
  "Producto_Clave"         text GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(translate("Producto", 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))
  ) STORED,
  "Clasificacion"          text NOT NULL,
  "creado_por"             uuid,
  "creado_por_nombre"      text,
  "creado_en"              timestamptz,
  "modificado_por"         uuid,
  "modificado_por_nombre"  text,
  "modificado_en"          timestamptz,
  CONSTRAINT clasificacion_producto_producto_valido CHECK (btrim("Producto") <> '' AND length("Producto") <= 200),
  CONSTRAINT clasificacion_producto_clasif_valida   CHECK (length(btrim("Clasificacion")) BETWEEN 2 AND 60),
  CONSTRAINT clasificacion_producto_no_otros        CHECK (lower(btrim("Clasificacion")) <> 'otros')
);

COMMENT ON TABLE public."ClasificacionProducto" IS
  'Clasificación (Fungicida, Insecticida…) por producto para la pestaña Rentabilidad del Dashboard. Una por producto; «Otros» = sin fila. Los cambios quedan en audit_log. Solo administrador.';

-- Una sola clasificación por producto (sin importar mayúsculas, tildes ni espacios repetidos).
CREATE UNIQUE INDEX IF NOT EXISTS clasificacion_producto_clave_unico
  ON public."ClasificacionProducto" ("Producto_Clave");

-- ── 2. Carga inicial (categorias.xlsx, 2026-11-25): 63 productos con clasificación ──
-- Antes de los triggers: no genera audit_log. Repetir la migración no pisa lo que ya se haya editado.
INSERT INTO public."ClasificacionProducto" ("Producto", "Clasificacion", "creado_por_nombre", "creado_en")
SELECT btrim(regexp_replace(v.p, '\s+', ' ', 'g')), v.c, 'Carga inicial (categorias.xlsx)', now()
FROM (VALUES
    ('ACTIV CEL X LITRO', 'Bioestimulante'),
    ('AFINADOR CAB X BIDON 20 LITROS', 'Bioestimulante'),
    ('AFINADOR CAB X GALON', 'Bioestimulante'),
    ('AFINADOR CAB X LITRO', 'Bioestimulante'),
    ('AGROHUMICOL X BIDON 20 LITROS', 'Abono orgánico'),
    ('AGROHUMICOL X GALON', 'Abono orgánico'),
    ('AGROHUMICOL X LITRO', 'Abono orgánico'),
    ('AJO AJI ORTIGA X 250 ML', 'Insecticida'),
    ('AJO AJI ORTIGA X LITRO', 'Insecticida'),
    ('BA-BOR-ZINC X 250 ML', 'Molusquicida'),
    ('BA-BOR-ZINC X BIDON 20 LITROS', 'Molusquicida'),
    ('BA-BOR-ZINC X GALON', 'Molusquicida'),
    ('BA-BOR-ZINC X LITRO', 'Molusquicida'),
    ('BORCAMAG X GALON', 'Bioestimulante'),
    ('BORCAMAG X LITRO', 'Bioestimulante'),
    ('CALIMAN X CANECA 20 LITROS', 'Enmienda líquida'),
    ('CALIMAN X GALON', 'Enmienda líquida'),
    ('CALIMAN X LITRO', 'Enmienda líquida'),
    ('CREOLINA X 250 ML', 'Desinfectante'),
    ('CREOLINA X 500 ML', 'Desinfectante'),
    ('CREOLINA X GALON', 'Desinfectante'),
    ('CREOLINA X LITRO', 'Desinfectante'),
    ('ENMIENDA AGRICOLA BULTO X 50 K', 'Enmienda sólida'),
    ('GENIUS-TECH X BIDON 20 LITROS', 'Nano menores'),
    ('GEON3 X 250 ML', 'Nematicida'),
    ('GEON3 X BIDON 20 LITROS', 'Nematicida'),
    ('GEON3 X LITRO', 'Nematicida'),
    ('GREEN 40F X 250 ML', 'Fungicida'),
    ('GREEN 40F X LITRO', 'Fungicida'),
    ('GREEN AMINO X BIDON 20 LITROS', 'Bioestimulante'),
    ('GREEN AMINO X GALON', 'Bioestimulante'),
    ('GREEN AMINO X LITRO', 'Bioestimulante'),
    ('GREEN CORRECTOR X LITRO', 'Coadyuvante'),
    ('GREEN FOS X LITRO', 'Bioestimulante'),
    ('GREEN FUNGY-BAC X LITRO', 'Fungicida'),
    ('GREEN K X LITRO', 'Bioestimulante'),
    ('GREEN MOLUS-KILL X GALON', 'Molusquicida'),
    ('GREEN VAX X LITRO', 'Fungicida'),
    ('GROW GREEN X 250 ML', 'Fungicida'),
    ('GROW GREEN X GALON', 'Fungicida'),
    ('GROW GREEN X LITRO', 'Fungicida'),
    ('IKASOL X 250 ML', 'Inductor de resistencia'),
    ('IKASOL X LITRO', 'Inductor de resistencia'),
    ('JABOTAN EXPORTACION X LITRO', 'Insecticida'),
    ('JABOTAN X GALON', 'Insecticida'),
    ('JABOTAN X LITRO', 'Insecticida'),
    ('MICROZUL FZ&V LOMBRI-CROP  X LITRO', 'Biorremediación'),
    ('NEEM GREEN X 250 ML', 'Insecticida'),
    ('NEEM GREEN X LITRO', 'Insecticida'),
    ('NUTRI ROOTS X LITRO', 'Bioestimulante'),
    ('NUTRICEL K50 X BIDON 20 LITROS', 'Bioestimulante'),
    ('NUTRICEL K50 X LITRO', 'Bioestimulante'),
    ('OXICLORURO DE COBRE X KILO', 'Fungicida'),
    ('PEGASSO OIL X LITRO', 'Tensoactivo'),
    ('PEGASSO PH X LITRO', 'Tensoactivo'),
    ('SHARCYALOTRINA 5 % EC', 'Insecticida'),
    ('SHARDIZOL 250 EC X LITRO', 'Fungicida'),
    ('SHAZUGAMYCIN 2 % SL', 'Fungicida'),
    ('TABUS 50 WG X 40 GR CV', 'Fungicida'),
    ('THYME GREEN X BIDON 20 LITROS', 'Fungicida'),
    ('YODO X 250 ML', 'Fungicida'),
    ('YODO X GALON', 'Fungicida'),
    ('YODO X LITRO', 'Fungicida')
) AS v(p, c)
ON CONFLICT ("Producto_Clave") DO NOTHING;

-- ── 3. Normalización de lo que escribe el cliente ──
CREATE OR REPLACE FUNCTION public.fn_clasificacion_producto_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existente text;
BEGIN
  NEW."Producto"      := btrim(regexp_replace(NEW."Producto", '\s+', ' ', 'g'));
  NEW."Clasificacion" := btrim(regexp_replace(NEW."Clasificacion", '\s+', ' ', 'g'));

  -- La misma clasificación escrita de otra forma (mayúsculas/tildes): se usa la grafía que ya existe.
  SELECT c."Clasificacion" INTO v_existente
    FROM public."ClasificacionProducto" c
   WHERE lower(translate(c."Clasificacion", 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
         = lower(translate(NEW."Clasificacion", 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
     AND c."Clasificacion" <> NEW."Clasificacion"
     AND (TG_OP = 'INSERT' OR c.id <> NEW.id)
   ORDER BY c.id
   LIMIT 1;
  IF v_existente IS NOT NULL THEN
    NEW."Clasificacion" := v_existente;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_clasificacion_producto_guard() FROM PUBLIC, anon, authenticated;

-- ── 4. Triggers (mismo orden que el resto de tablas: normalizar, auditoría de fila, audit_log) ──
DROP TRIGGER IF EXISTS trg_clasificacion_producto_guard ON public."ClasificacionProducto";
CREATE TRIGGER trg_clasificacion_producto_guard
  BEFORE INSERT OR UPDATE ON public."ClasificacionProducto"
  FOR EACH ROW EXECUTE FUNCTION public.fn_clasificacion_producto_guard();

DROP TRIGGER IF EXISTS trg_auditoria_row ON public."ClasificacionProducto";
CREATE TRIGGER trg_auditoria_row
  BEFORE INSERT OR UPDATE ON public."ClasificacionProducto"
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_row();

DROP TRIGGER IF EXISTS trg_audit_log ON public."ClasificacionProducto";
CREATE TRIGGER trg_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public."ClasificacionProducto"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ── 5. RLS: solo administrador ──
ALTER TABLE public."ClasificacionProducto" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ClasificacionProducto_select" ON public."ClasificacionProducto";
CREATE POLICY "ClasificacionProducto_select" ON public."ClasificacionProducto" FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "ClasificacionProducto_insert" ON public."ClasificacionProducto";
CREATE POLICY "ClasificacionProducto_insert" ON public."ClasificacionProducto" FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "ClasificacionProducto_update" ON public."ClasificacionProducto";
CREATE POLICY "ClasificacionProducto_update" ON public."ClasificacionProducto" FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "ClasificacionProducto_delete" ON public."ClasificacionProducto";
CREATE POLICY "ClasificacionProducto_delete" ON public."ClasificacionProducto" FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

REVOKE ALL ON public."ClasificacionProducto" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ClasificacionProducto" TO authenticated;
GRANT ALL ON public."ClasificacionProducto" TO service_role;

-- ── 6. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
