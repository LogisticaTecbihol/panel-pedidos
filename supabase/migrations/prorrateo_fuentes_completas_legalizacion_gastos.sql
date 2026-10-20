-- ============================================================
-- Prorrateo de gastos (Legalización): fuentes COMPLETAS para el cálculo
-- ============================================================
-- Problema: el prorrateo por producto convierte las remisiones de cada viaje a
-- litros/kilos leyendo Pedidos, Ingresos, Muestras, Devoluciones y Cambios, y
-- reparte el gasto entre TODAS las empresas del viaje. Esas tablas tienen RLS por
-- empresa/rol, así que un usuario restringido (ej. rol 'mercadeo' solo-PARCELAR,
-- que ni siquiera puede leer Pedidos) recibe un mapa incompleto: sus remisiones no
-- se resuelven (caen en "Sin identificar") y en viajes mixtos las remisiones de otras
-- empresas faltan, por lo que su monto no coincide con el del admin.
--
-- Solución: esta RPC (SECURITY DEFINER) entrega, solo a quien tiene el módulo
-- 'legalizacion_gastos' / 'legalizacion_gastos_aprobar' (admin pasa), lo MÍNIMO que
-- necesita LegProrrateo.calcular() de TODAS las empresas:
--   · remisión → producto, presentación, cantidad y empresa (sin Cliente, sin precios);
--   · de TODAS las legalizaciones: solo concepto, valor y reparto por empresa (sin
--     proveedor, NIT, responsable, placa, adjuntos), para que el total del grupo y
--     los % coincidan con los que ve el admin.
-- La pantalla solo muestra al usuario las filas de sus empresas (AUTH.hasCompany).
-- Las columnas coinciden con las de apiGet() en legalizacion-gastos.js y van
-- ordenadas por id (el orden de suma afecta los decimales).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_prorrateo_legalizacion_fuentes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar')) THEN
    RAISE EXCEPTION 'Sin permiso para el módulo de Legalización de gastos' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    -- Solo las filas con entregas estructuradas ("REM|cant|fecha"): el resto no aporta al prorrateo.
    'pedidos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Remisiones', p."Remisiones", 'Estado_2', p."Estado_2", 'Producto', p."Producto",
               'Presentacion', p."Presentacion", 'Nombre_Empresa', p."Nombre_Empresa") ORDER BY p.id), '[]'::jsonb)
        FROM "Pedidos" p
       WHERE p."Remisiones" LIKE '%|%'
    ),
    'ingresos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Producto', i."Producto", 'Presentacion', i."Presentacion", 'Cantidad', i."Cantidad",
               'Remision_Destino', i."Remision_Destino", 'Remision_Origen', i."Remision_Origen",
               'Empresa_Destino', i."Empresa_Destino", 'Empresa_Origen', i."Empresa_Origen") ORDER BY i.id), '[]'::jsonb)
        FROM "Ingresos" i
       WHERE COALESCE(TRIM(i."Remision_Destino"), '') <> '' OR COALESCE(TRIM(i."Remision_Origen"), '') <> ''
    ),
    'muestras', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Remision', m."Remision", 'Empresa', m."Empresa", 'Producto', m."Producto",
               'Presentacion', m."Presentacion", 'Cantidad', m."Cantidad", 'Cant_Entregada', m."Cant_Entregada",
               'Tipo_Solicitud', m."Tipo_Solicitud") ORDER BY m.id), '[]'::jsonb)
        FROM "SolicitudMuestras" m
       WHERE COALESCE(TRIM(m."Remision"), '') <> ''
    ),
    'devoluciones', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Remision', d."Remision", 'Remision_Ingreso', d."Remision_Ingreso", 'Remision_Salida', d."Remision_Salida",
               'Empresa', d."Empresa", 'Producto', d."Producto", 'Presentacion', d."Presentacion",
               'Cantidad', d."Cantidad", 'Cant_Entregada', d."Cant_Entregada", 'Estado', d."Estado") ORDER BY d.id), '[]'::jsonb)
        FROM "Devoluciones" d
       WHERE COALESCE(TRIM(d."Remision"), '') <> '' OR COALESCE(TRIM(d."Remision_Ingreso"), '') <> ''
          OR COALESCE(TRIM(d."Remision_Salida"), '') <> ''
    ),
    'cambios', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', c.id, 'Tipo_Linea', c."Tipo_Linea", 'Cantidad', c."Cantidad", 'Estado', c."Estado",
               'Remision_Salida', c."Remision_Salida", 'Remision_Ingreso', c."Remision_Ingreso",
               'Consecutivo', c."Consecutivo", 'Empresa', c."Empresa", 'Producto', c."Producto") ORDER BY c.id), '[]'::jsonb)
        FROM "CambiosMercancia" c
    ),
    'legalizaciones', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', l.id, 'Consecutivo', l."Consecutivo", 'Fecha', l."Fecha", 'Tipo', l."Tipo",
               'Estado_Conciliacion', l."Estado_Conciliacion", 'Remisiones_Relacionadas', l."Remisiones_Relacionadas") ORDER BY l.id), '[]'::jsonb)
        FROM "LegalizacionGastos" l
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', it.id, 'Legalizacion_Id', it."Legalizacion_Id", 'Concepto', it."Concepto", 'Valor', it."Valor") ORDER BY it.id), '[]'::jsonb)
        FROM "LegalizacionGastosItems" it
    ),
    'empresas', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', e.id, 'Legalizacion_Id', e."Legalizacion_Id", 'Empresa', e."Empresa", 'Monto', e."Monto") ORDER BY e.id), '[]'::jsonb)
        FROM "LegalizacionGastosEmpresas" e
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_prorrateo_legalizacion_fuentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prorrateo_legalizacion_fuentes() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
