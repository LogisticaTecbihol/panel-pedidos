-- Fase 1 (OTD) — Cumplimiento de entrega.
-- Fecha prometida de entrega a nivel de pedido.
--
-- Tipo: text ISO 'YYYY-MM-DD', consistente con Fecha_Pedido / Fecha_Ult_Entrega /
-- EntregasPedido.fecha (todo el panel compara fechas por prefijo de string).
-- NOT NULL DEFAULT '' → los ~1.250 pedidos historicos leen '' = "sin compromiso"
-- (excluidos del % OTD; sin backfill, por decision de negocio).
--
-- Los triggers de auditoria (set_auditoria_row, fn_audit_log) son dinamicos y
-- absorben la columna nueva sin cambios. apiGet('getPedidos') de pedidos.js usa
-- select('*'); dashboard.js y reportes.js usan listas de columnas explicitas
-- (se agrega Fecha_Compromiso a ambas en el frontend).
--
-- Aplicar con apply_migration del MCP de Supabase (no se aplica con el push).

ALTER TABLE public."Pedidos"
  ADD COLUMN IF NOT EXISTS "Fecha_Compromiso" text NOT NULL DEFAULT '';

COMMENT ON COLUMN public."Pedidos"."Fecha_Compromiso" IS
  'Fase 1 OTD. Fecha prometida de entrega (YYYY-MM-DD). Se calcula al crear el pedido como Fecha_Pedido + N dias habiles y es editable. Vacio = sin compromiso (pedido historico, fuera del % OTD).';

NOTIFY pgrst, 'reload schema';
