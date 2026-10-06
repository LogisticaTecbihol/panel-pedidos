-- ============================================================
-- BAJA del CRM de Mercadeo en panel-pedidos  —  NO APLICADA TODAVÍA
--
-- El CRM (Leads, Actividades, Presupuesto, Indicadores) se migró a panel-pqrs
-- (proyecto Supabase kvfqcymeihglohkcckdp, migraciones 0012-0014 de ese repo) y
-- su código se retiró de este panel. Este script elimina lo que quedó en la
-- BD de ESTE proyecto (opghwfuxrvjpbuxeykxn).
--
-- NO se aplica solo: ejecutarlo con apply_migration (MCP) únicamente cuando el
-- usuario lo confirme de forma explícita. Es destructivo; las 5 tablas estaban
-- VACÍAS al 2026-10-06 (0 filas) — verificar de nuevo antes de aplicar.
--
-- Qué hace:
--   1. Quita el cron 'crm-cerrar-leads-inactivos' y las 2 funciones del CRM.
--   2. Elimina las 5 tablas (orden por dependencias de FK).
--   3. Limpia filas huérfanas: usuario_modulos 'crm', notificaciones 'crm' y
--      las entradas de audit_log de esas tablas (todas de prueba).
--   4. Recrea los CHECK de usuario_modulos y notificaciones SIN 'crm',
--      conservando el resto de claves vigentes (leídas de la BD el 2026-10-06).
--
-- Qué NO hace (a propósito):
--   - No toca el rol 'mercadeo' de usuarios_rol_check ni a los usuarios que lo
--     tengan (hay un usuario de prueba, prueba_parcelar). El rol quedó inerte:
--     ya no concede nada en este panel. Quitarlo exige reasignar antes a esos
--     usuarios; decidirlo aparte.
--
-- Idempotente. Aplicar con apply_migration (MCP).
-- ============================================================

-- ── 0. Salvaguarda: aborta si las tablas ya tienen datos ──────
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT (SELECT count(*) FROM public."Leads")
       + (SELECT count(*) FROM public."LeadsSeguimiento")
       + (SELECT count(*) FROM public."ActividadesMercadeo")
       + (SELECT count(*) FROM public."PresupuestoMercadeo")
       + (SELECT count(*) FROM public."PresupuestoMercadeoGastos")
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Las tablas del CRM tienen % fila(s): no se eliminan. Revisar/exportar antes de continuar.', n;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL; -- ya se eliminaron (re-ejecución)
END $$;

-- ── 1. Cron y funciones ───────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm-cerrar-leads-inactivos';
END $$;

-- ── 2. Tablas (hijas primero) ─────────────────────────────────
DROP TABLE IF EXISTS public."PresupuestoMercadeoGastos";
DROP TABLE IF EXISTS public."PresupuestoMercadeo";
DROP TABLE IF EXISTS public."LeadsSeguimiento";
DROP TABLE IF EXISTS public."Leads";
DROP TABLE IF EXISTS public."ActividadesMercadeo";

DROP FUNCTION IF EXISTS public.cerrar_leads_inactivos();
DROP FUNCTION IF EXISTS public.touch_lead_on_seguimiento();

-- ── 3. Filas huérfanas ────────────────────────────────────────
DELETE FROM public.usuario_modulos WHERE modulo = 'crm';
DELETE FROM public.notificaciones WHERE modulo = 'crm';
DELETE FROM public.audit_log
 WHERE tabla IN ('Leads','LeadsSeguimiento','ActividadesMercadeo','PresupuestoMercadeo','PresupuestoMercadeoGastos');

-- ── 4. CHECK sin 'crm' ────────────────────────────────────────
ALTER TABLE public.usuario_modulos DROP CONSTRAINT IF EXISTS usuario_modulos_modulo_check;
ALTER TABLE public.usuario_modulos ADD CONSTRAINT usuario_modulos_modulo_check
  CHECK (modulo IN (
    'pedidos','ingresos','ordenes','devoluciones',
    'inventario','kardex','muestras','reenvases',
    'lista_precios','reportes','dashboard',
    'muestras_aprobar','ordenes_aprobar',
    'pedidos_editar_cantidad','notificaciones','clientes',
    'productos','reabastecimiento','bodegas_consignacion',
    'cartera','legalizacion_gastos','legalizacion_gastos_aprobar'
  ));

ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_modulo_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_modulo_check
  CHECK (modulo IN (
    'pedidos','devoluciones','cambios','muestras','ordenes',
    'ingresos','reenvases','kardex','reportes'
  ));

NOTIFY pgrst, 'reload schema';
