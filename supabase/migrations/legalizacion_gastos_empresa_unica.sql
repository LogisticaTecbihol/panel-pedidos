-- ============================================================
-- Legalización de Gastos: usuarios de UNA sola empresa (p. ej. Parcelar)
--
-- El RLS ya recorta QUÉ legalizaciones ve cada usuario (legalizacion_gastos_visible:
-- solo las que reparten gasto a alguna de sus empresas). Aquí se completa el
-- recorte para el usuario que tiene asignada UNA sola empresa (admin y cartera
-- quedan fuera: ven todo):
--
--   1. legalizacion_empresa_restringida()  -> sigla de su única empresa, o NULL.
--   2. legalizacion_gastos_compartida(id)  -> true si el usuario es de una sola
--      empresa y el reparto del viaje incluye alguna otra (o un grupo externo
--      como CHIA ABAGO / MATERIAS PRIMAS).
--   3. Esos viajes compartidos quedan de SOLO LECTURA para ese usuario: el
--      formulario de edición reescribe el reparto completo (borra e inserta las
--      filas), así que dejarlo editar uno compartido le haría ver —y pisar— el
--      reparto de las demás empresas. Se aplica a UPDATE/DELETE de
--      LegalizacionGastos y a INSERT/UPDATE/DELETE de Items y Empresas. Crear una
--      legalización nueva no cambia (aún no tiene reparto).
--   4. get_auditoria_consecutivo_legalizacion_gastos() se niega a ese usuario:
--      lista números de TODAS las empresas (tipo, fecha, estado) y la pestaña
--      Consecutivo no se le muestra.
--
-- Lo que SE VE de los viajes compartidos (solo la fila de su empresa en el
-- reparto, Prorrateo filtrado a su empresa) lo resuelve el cliente
-- (js/legalizacion-gastos.js): el cálculo del Prorrateo necesita el reparto
-- completo de cada viaje, así que SELECT no se recorta aquí.
--
-- Para quien NO es de una sola empresa los helpers devuelven NULL / false y las
-- políticas quedan igual que antes.
--
-- Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

-- ── 1. Empresa única del usuario ──
CREATE OR REPLACE FUNCTION public.legalizacion_empresa_restringida()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN u.rol IN ('admin', 'cartera') THEN NULL
           WHEN (SELECT count(*) FROM usuario_empresas ue WHERE ue.usuario_id = u.id) = 1
             THEN (SELECT ue.empresa_sigla FROM usuario_empresas ue WHERE ue.usuario_id = u.id)
         END
    FROM usuarios u
   WHERE u.id = auth.uid() AND u.activo = true;
$$;

COMMENT ON FUNCTION public.legalizacion_empresa_restringida() IS
  'Sigla de la única empresa asignada al usuario actual (admin y cartera no cuentan); NULL si tiene varias, ninguna o es admin/cartera.';

-- ── 2. ¿Viaje compartido con otras empresas? (solo para usuarios de una empresa) ──
CREATE OR REPLACE FUNCTION public.legalizacion_gastos_compartida(p_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.legalizacion_empresa_restringida() IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM "LegalizacionGastosEmpresas" e
            WHERE e."Legalizacion_Id" = p_id
              AND NOT public.user_has_company(e."Empresa"));
$$;

COMMENT ON FUNCTION public.legalizacion_gastos_compartida(bigint) IS
  'true si el usuario actual es de una sola empresa y el reparto de la legalización incluye otra empresa o un grupo externo. Siempre false para el resto de usuarios.';

REVOKE ALL ON FUNCTION public.legalizacion_empresa_restringida()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.legalizacion_gastos_compartida(bigint)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legalizacion_empresa_restringida()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legalizacion_gastos_compartida(bigint) TO authenticated, service_role;

-- ── 3. Viajes compartidos: solo lectura para el usuario de una empresa ──
-- LegalizacionGastos
DROP POLICY IF EXISTS "LegalizacionGastos_update" ON public."LegalizacionGastos";
CREATE POLICY "LegalizacionGastos_update" ON public."LegalizacionGastos" FOR UPDATE TO authenticated
  USING (public.user_has_module('legalizacion_gastos') AND "Estado_Conciliacion" = 'Por conciliar'
         AND NOT public.legalizacion_gastos_compartida(id))
  WITH CHECK (public.user_has_module('legalizacion_gastos') AND "Estado_Conciliacion" = 'Por conciliar'
         AND NOT public.legalizacion_gastos_compartida(id));

DROP POLICY IF EXISTS "LegalizacionGastos_delete" ON public."LegalizacionGastos";
CREATE POLICY "LegalizacionGastos_delete" ON public."LegalizacionGastos" FOR DELETE TO authenticated
  USING (public.user_has_module('legalizacion_gastos') AND "Estado_Conciliacion" = 'Por conciliar'
         AND NOT public.legalizacion_gastos_compartida(id));

-- LegalizacionGastosItems
DROP POLICY IF EXISTS "LegalizacionGastosItems_insert" ON public."LegalizacionGastosItems";
CREATE POLICY "LegalizacionGastosItems_insert" ON public."LegalizacionGastosItems" FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosItems_update" ON public."LegalizacionGastosItems";
CREATE POLICY "LegalizacionGastosItems_update" ON public."LegalizacionGastosItems" FOR UPDATE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  )
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosItems_delete" ON public."LegalizacionGastosItems";
CREATE POLICY "LegalizacionGastosItems_delete" ON public."LegalizacionGastosItems" FOR DELETE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

-- LegalizacionGastosEmpresas (mismas reglas que Items)
DROP POLICY IF EXISTS "LegalizacionGastosEmpresas_insert" ON public."LegalizacionGastosEmpresas";
CREATE POLICY "LegalizacionGastosEmpresas_insert" ON public."LegalizacionGastosEmpresas" FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosEmpresas_update" ON public."LegalizacionGastosEmpresas";
CREATE POLICY "LegalizacionGastosEmpresas_update" ON public."LegalizacionGastosEmpresas" FOR UPDATE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  )
  WITH CHECK (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

DROP POLICY IF EXISTS "LegalizacionGastosEmpresas_delete" ON public."LegalizacionGastosEmpresas";
CREATE POLICY "LegalizacionGastosEmpresas_delete" ON public."LegalizacionGastosEmpresas" FOR DELETE TO authenticated
  USING (
    public.user_has_module('legalizacion_gastos')
    AND NOT public.legalizacion_gastos_compartida("Legalizacion_Id")
    AND EXISTS (SELECT 1 FROM public."LegalizacionGastos" lg
                 WHERE lg.id = "Legalizacion_Id" AND lg."Estado_Conciliacion" = 'Por conciliar')
  );

-- ── 4. Consecutivo: no para el usuario de una sola empresa ──
-- Se parcha la definición vigente (en vez de copiarla entera) para no arrastrar
-- ningún cambio posterior de la función; si el punto de inserción no existe se
-- aborta la migración.
DO $$
DECLARE
  v_def   text;
  v_ancla text := E'  IF NOT (public.user_has_module(''legalizacion_gastos'')';
  v_guard text := E'  IF public.legalizacion_empresa_restringida() IS NOT NULL THEN\n'
               || E'    RAISE EXCEPTION ''Sin permiso para consultar el consecutivo de legalizaciones'';\n'
               || E'  END IF;\n';
BEGIN
  SELECT pg_get_functiondef('public.get_auditoria_consecutivo_legalizacion_gastos()'::regprocedure) INTO v_def;
  IF position('legalizacion_empresa_restringida' IN v_def) > 0 THEN
    RETURN; -- ya parchada
  END IF;
  IF position(v_ancla IN v_def) = 0 THEN
    RAISE EXCEPTION 'No se encontró el punto de inserción en get_auditoria_consecutivo_legalizacion_gastos()';
  END IF;
  EXECUTE replace(v_def, v_ancla, v_guard || v_ancla);
END $$;

REVOKE ALL ON FUNCTION public.get_auditoria_consecutivo_legalizacion_gastos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auditoria_consecutivo_legalizacion_gastos() TO authenticated;

-- ── 5. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
