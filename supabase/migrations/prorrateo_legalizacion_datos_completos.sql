-- ============================================================
-- Legalización de Gastos: Prorrateo con datos completos para usuarios de UNA
-- sola empresa (p. ej. Parcelar)
--
-- El Prorrateo (js/legalizacion-prorrateo.js) reparte el gasto de cada viaje
-- entre los productos de TODAS sus remisiones, y de ahí saca el gasto de cada
-- empresa. El RLS le oculta a un usuario de una empresa los pedidos, ingresos,
-- etc. de las demás, así que calculado con lo que él ve da una cifra distinta
-- (por ejemplo, para Parcelar en septiembre de 2026 solo resolvía 53 de las 72
-- remisiones de sus viajes) y no coincide con la del administrador.
--
-- Esta función entrega, SOLO a un usuario de una sola empresa con el módulo de
-- legalizaciones, los datos completos (sin RLS) que necesita ese cálculo, con
-- las mismas columnas y el mismo orden por id que pide hoy el panel. El panel
-- (legalizacion-gastos.js) hace el mismo cálculo del administrador, filtrado a
-- la empresa del usuario, y muestra únicamente esa parte.
--
-- Qué viaja al navegador de ese usuario (aunque no se muestre): de todas las
-- legalizaciones, su consecutivo, fecha, tipo, estado, remisiones relacionadas,
-- los conceptos y valores de sus líneas de gasto (sin proveedor ni NIT) y su
-- reparto entre empresas; y de las remisiones, producto / presentación /
-- cantidad / empresa. De Pedidos el nombre del cliente solo viaja en los de su
-- propia empresa.
--
-- Depende de legalizacion_empresa_restringida()
-- (legalizacion_gastos_empresa_unica.sql, ya aplicada).
--
-- Aplicar con apply_migration (MCP) o en el SQL Editor + NOTIFY pgrst.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_prorrateo_legalizacion_datos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.user_has_module('legalizacion_gastos')
          OR public.user_has_module('legalizacion_gastos_aprobar')) THEN
    RAISE EXCEPTION 'Sin permiso para consultar el prorrateo de legalizaciones';
  END IF;
  -- El resto de usuarios lee las tablas directamente (su RLS ya les basta).
  IF public.legalizacion_empresa_restringida() IS NULL THEN
    RAISE EXCEPTION 'Solo para usuarios de una sola empresa';
  END IF;

  RETURN jsonb_build_object(
    'legalizaciones', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Consecutivo", "Fecha", "Tipo", "Estado_Conciliacion", "Remisiones_Relacionadas"
          FROM "LegalizacionGastos") t),
    'items', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Legalizacion_Id", "Concepto", "Valor"
          FROM "LegalizacionGastosItems") t),
    'empresas', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Legalizacion_Id", "Empresa", "Monto"
          FROM "LegalizacionGastosEmpresas") t),
    'pedidos', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id,
               CASE WHEN public.user_has_company("Nombre_Empresa") THEN "Cliente" ELSE '' END AS "Cliente",
               "Remisiones", "Estado_2", "Producto", "Presentacion", "Nombre_Empresa"
          FROM "Pedidos") t),
    'ingresos', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Producto", "Presentacion", "Cantidad", "Remision_Destino", "Remision_Origen",
               "Empresa_Destino", "Empresa_Origen"
          FROM "Ingresos") t),
    'muestras', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision", "Empresa", "Producto", "Presentacion", "Cantidad", "Cant_Entregada", "Tipo_Solicitud"
          FROM "SolicitudMuestras") t),
    'devoluciones', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision", "Remision_Ingreso", "Remision_Salida", "Empresa", "Producto", "Presentacion",
               "Cantidad", "Cant_Entregada", "Estado"
          FROM "Devoluciones") t),
    'cambios', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Tipo_Linea", "Cantidad", "Estado", "Remision_Salida", "Remision_Ingreso", "Consecutivo",
               "Empresa", "Producto"
          FROM "CambiosMercancia") t),
    'ext', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision", "Fecha", "Tipo", "Proveedor", "Planta"
          FROM "RemisionesExternas") t),
    'extItems', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM (
        SELECT id, "Remision_Id", "Producto", "Presentacion", "Cantidad", "Unidad"
          FROM "RemisionesExternasItems") t)
  );
END;
$$;

COMMENT ON FUNCTION public.get_prorrateo_legalizacion_datos() IS
  'Datos completos (sin RLS) del Prorrateo de Legalización de Gastos para un usuario de una sola empresa; ver prorrateo_legalizacion_datos_completos.sql.';

REVOKE ALL ON FUNCTION public.get_prorrateo_legalizacion_datos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prorrateo_legalizacion_datos() TO authenticated;

NOTIFY pgrst, 'reload schema';
