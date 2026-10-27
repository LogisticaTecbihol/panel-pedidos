-- ============================================================
-- Legalización › Envíos › Detalle de productos: cliente de las remisiones propias
-- ============================================================
-- Problema: el usuario restringido a una empresa cuyo rol NO lee Pedidos (ej. 'mercadeo'
-- solo-PARCELAR) ve el Detalle de productos con la columna Cliente vacía: el cliente de
-- una remisión de Pedidos solo sale de Pedidos, y get_prorrateo_legalizacion_fuentes()
-- (la RPC que le trae las fuentes completas) entregaba los Pedidos sin Cliente.
--
-- Solución: la RPC agrega 'Cliente' a cada fila de 'pedidos', pero SOLO cuando la fila es
-- de una empresa del usuario (user_has_company: admin y cartera ven todas; el resto, las
-- suyas). Para las demás empresas 'Cliente' viaja null, así que el navegador de un usuario
-- restringido nunca recibe clientes de otras empresas. Devoluciones y Cambios ya traen su
-- cliente por la lectura normal (su RLS deja ver las filas de la empresa del usuario).
--
-- Es el único cambio respecto a la definición vigente (add_tramite_parcial_cambios.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_prorrateo_legalizacion_fuentes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.user_has_module('legalizacion_gastos') OR public.user_has_module('legalizacion_gastos_aprobar')) THEN
    RAISE EXCEPTION 'Sin permiso para el módulo de Legalización de gastos' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    -- Cliente solo en las filas de las empresas del usuario (null en las demás).
    'pedidos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'Remisiones', p."Remisiones", 'Estado_2', p."Estado_2", 'Producto', p."Producto",
               'Presentacion', p."Presentacion", 'Nombre_Empresa', p."Nombre_Empresa",
               'Cliente', CASE WHEN public.user_has_company(p."Nombre_Empresa") THEN p."Cliente" END) ORDER BY p.id), '[]'::jsonb)
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
               'Movs_Ingreso', c."Movs_Ingreso", 'Movs_Salida', c."Movs_Salida",
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
$function$;

REVOKE ALL ON FUNCTION public.get_prorrateo_legalizacion_fuentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prorrateo_legalizacion_fuentes() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración
-- ============================================================
