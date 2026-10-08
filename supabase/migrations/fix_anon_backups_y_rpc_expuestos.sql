-- Corregir hallazgos del advisor de seguridad (2026-10-01)
--
-- 1) Seis tablas de respaldo en public sin RLS: el rol anon (la llave pública
--    incrustada en el JS del panel) tenía arwdDxtm → podía LEER, modificar,
--    borrar y vaciar copias con NIT/teléfonos de clientes. Se activa RLS (sin
--    políticas) y se revocan los permisos de anon y authenticated. Nada del
--    panel las usa; quedan accesibles solo para postgres/service_role.
--
-- 2) Tres RPC SECURITY DEFINER ejecutables sin sesión. Dos de ellas
--    (cliente_estado_pedido, get_bitacora_contacto_cliente) además tenían
--    EXECUTE a PUBLIC, por lo que revocar solo de anon no bastaba. Se revoca
--    de PUBLIC y anon; authenticated y service_role conservan el acceso
--    (el panel solo las llama con sesión: js/shared.js, js/ordenes.js).
--
-- Ejecutado en producción el 2026-10-01. Se versiona como documentación del
-- estado real de la BD; no re-ejecutar a ciegas.

-- ── 1. Tablas de respaldo ──
ALTER TABLE public._backup_identificacion_20260903        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_telefono_20260903              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_fecha_pedido_20260904          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_nit_pedidos_20260904           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_pedidos_estado_entrega_20260916 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_oc_pedido_id_20260908             ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public._backup_identificacion_20260903         FROM anon, authenticated;
REVOKE ALL ON public._backup_telefono_20260903               FROM anon, authenticated;
REVOKE ALL ON public._backup_fecha_pedido_20260904           FROM anon, authenticated;
REVOKE ALL ON public._backup_nit_pedidos_20260904            FROM anon, authenticated;
REVOKE ALL ON public._backup_pedidos_estado_entrega_20260916 FROM anon, authenticated;
REVOKE ALL ON public._bkp_oc_pedido_id_20260908              FROM anon, authenticated;

-- ── 2. RPC sin sesión ──
REVOKE EXECUTE ON FUNCTION public.cliente_estado_pedido(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_bitacora_contacto_cliente(text)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pedido_estado_despacho(bigint)          FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.cliente_estado_pedido(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bitacora_contacto_cliente(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pedido_estado_despacho(bigint)          TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
