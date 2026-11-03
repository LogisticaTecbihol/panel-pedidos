-- ============================================================
-- Pedidos: resumen de adjuntos en UNA sola llamada (get_adjuntos_pedidos_resumen)
--
-- Al abrir Pedidos (y tras cada guardado) loadAdjuntosIndex() / loadAdjuntosUploaders()
-- (js/pedidos.js) pedían a Storage la lista de CADA carpeta con adjuntos: 5 listados por
-- empresa + uno por carpeta (394 el 2026-11-03) = ~399 POST /storage/v1/object/list por
-- carga. Cada uno corre storage.search (~70 ms de BD): ~27 s de BD por carga, ~49.000 al
-- día, y con varios usuarios la BD se saturaba → «canceling statement due to statement
-- timeout» al cargar Pedidos.
--
-- Esta función devuelve lo mismo que esos listados en una consulta: una fila por
-- (empresa, carpeta del pedido, quien subió) de los archivos de las carpetas
-- <sigla>/<consecutivo_cliente>/<archivo>. Quedan fuera notificaciones/* y los archivos
-- sueltos a nivel de empresa (p. ej. IAS/.emptyFolderPlaceholder), igual que el código anterior.
--
-- SECURITY INVOKER: aplican las políticas de storage.objects (pedidos_adj_select), o sea
-- ve exactamente lo que veía con list(). owner_id es el uuid de quien subió (texto).
-- Solo lectura. Aplicar con apply_migration (MCP) + NOTIFY pgrst al final.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_adjuntos_pedidos_resumen()
RETURNS TABLE (sigla text, carpeta text, owner_id text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT split_part(o.name, '/', 1),
         split_part(o.name, '/', 2),
         COALESCE(o.owner_id, o.owner::text)
  FROM storage.objects o
  WHERE o.bucket_id = 'pedidos-adjuntos'
    AND split_part(o.name, '/', 1) <> 'notificaciones'
    AND split_part(o.name, '/', 3) <> ''
  GROUP BY 1, 2, 3;
$function$;

REVOKE ALL ON FUNCTION public.get_adjuntos_pedidos_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_adjuntos_pedidos_resumen() TO authenticated;

COMMENT ON FUNCTION public.get_adjuntos_pedidos_resumen() IS
  'Carpetas de pedidos-adjuntos con archivos (sigla, carpeta, quién subió) en una sola consulta; reemplaza ~399 listados de Storage por carga de Pedidos.';

NOTIFY pgrst, 'reload schema';
