-- ============================================================
-- MIGRACIÓN: Entregas de pedido con selección de existencias
--
-- Añade:
--   1. Tabla "EntregasPedido" (una fila por asignación de stock
--      a una entrega parcial de una línea de pedido).
--   2. Columnas "Tipo" y "Ref_Pedido" en OrdenesCompra
--      para distinguir traslados internos vs compras a proveedor.
--   3. Políticas RLS, grants y triggers de auditoría análogos
--      a los del resto del esquema.
--
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor).
-- Idempotente: se puede correr múltiples veces sin efectos.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. TABLA "EntregasPedido"
-- ══════════════════════════════════════════════════════════════
--
-- Cada fila representa una asignación de cantidad entregada
-- desde una empresa del holding hacia una línea de pedido.
--
--   pedido_id       → fk lógica a Pedidos.id (la línea concreta)
--   empresa_pedido  → Nombre_Empresa del pedido (destino real)
--   empresa_stock   → empresa desde cuya existencia sale el producto
--   producto/pres.  → replicados para poder consultar sin join
--   cantidad        → unidades descontadas
--   remision        → número de remisión (obligatorio en el flujo)
--   fecha           → fecha de la entrega (texto YYYY-MM-DD)
--   orden_compra_id → fk lógica a OrdenesCompra.id cuando hubo
--                     traslado inter-empresa; NULL si mismo origen.
--
-- Nota: se usa fk lógica (sin REFERENCES) porque el resto del
-- esquema tampoco declara FKs para permitir importaciones/limpiezas
-- sin arrastrar cascadas. La integridad se cuida desde la app.

CREATE TABLE IF NOT EXISTS "EntregasPedido" (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "pedido_id" BIGINT NOT NULL,
  "empresa_pedido" TEXT NOT NULL,
  "empresa_stock" TEXT NOT NULL,
  "producto" TEXT NOT NULL,
  "presentacion" TEXT DEFAULT '',
  "cantidad" NUMERIC NOT NULL DEFAULT 0,
  "remision" TEXT NOT NULL,
  "fecha" TEXT,
  "orden_compra_id" BIGINT,
  "observaciones" TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_entregas_pedido_pedido
  ON "EntregasPedido"("pedido_id");
CREATE INDEX IF NOT EXISTS idx_entregas_pedido_stock
  ON "EntregasPedido"("empresa_stock", "producto");
CREATE INDEX IF NOT EXISTS idx_entregas_pedido_destino
  ON "EntregasPedido"("empresa_pedido", "producto");


-- ══════════════════════════════════════════════════════════════
-- 2. COLUMNAS NUEVAS EN OrdenesCompra
-- ══════════════════════════════════════════════════════════════
--   "Tipo"       → 'Compra' (default, proveedor externo)
--                  'Traslado' (movimiento inter-empresa del holding)
--   "Ref_Pedido" → cuando "Tipo"='Traslado' generado por una entrega,
--                  guarda "<Nombre_Empresa> #<Consecutivo>" del pedido
--                  origen para trazabilidad.

ALTER TABLE "OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "Tipo" TEXT DEFAULT 'Compra';

ALTER TABLE "OrdenesCompra"
  ADD COLUMN IF NOT EXISTS "Ref_Pedido" TEXT DEFAULT '';

-- Backfill: filas existentes siguen siendo compras a proveedor
UPDATE "OrdenesCompra" SET "Tipo" = 'Compra' WHERE "Tipo" IS NULL;


-- ══════════════════════════════════════════════════════════════
-- 3. COLUMNAS DE AUDITORÍA en EntregasPedido
--    (mismo patrón que audit_trail.sql estrategia A)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "EntregasPedido"
  ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES auth.users(id);
ALTER TABLE "EntregasPedido"
  ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ DEFAULT now();
ALTER TABLE "EntregasPedido"
  ADD COLUMN IF NOT EXISTS modificado_por UUID REFERENCES auth.users(id);
ALTER TABLE "EntregasPedido"
  ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMPTZ;

-- Trigger de modificado_en (la función set_modificado_en ya existe
-- si se corrió audit_trail.sql; si no, se crea de forma segura)
CREATE OR REPLACE FUNCTION set_modificado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.modificado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_modificado_en ON "EntregasPedido";
CREATE TRIGGER trg_modificado_en
  BEFORE UPDATE ON "EntregasPedido"
  FOR EACH ROW EXECUTE FUNCTION set_modificado_en();

-- Trigger de audit_log si la función existe (audit_trail.sql ya corrido)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_log') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_log ON "EntregasPedido"';
    EXECUTE 'CREATE TRIGGER trg_audit_log
             AFTER INSERT OR UPDATE OR DELETE ON "EntregasPedido"
             FOR EACH ROW EXECUTE FUNCTION fn_audit_log()';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY en EntregasPedido
--    Visible si el usuario tiene acceso a "empresa_pedido"
--    o "empresa_stock" (mismo patrón que Ingresos/OrdenesCompra).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "EntregasPedido" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "EntregasPedido_select" ON "EntregasPedido";
DROP POLICY IF EXISTS "EntregasPedido_insert" ON "EntregasPedido";
DROP POLICY IF EXISTS "EntregasPedido_update" ON "EntregasPedido";
DROP POLICY IF EXISTS "EntregasPedido_delete" ON "EntregasPedido";

CREATE POLICY "EntregasPedido_select" ON "EntregasPedido"
  FOR SELECT TO authenticated
  USING (
    user_has_company("empresa_pedido")
    OR user_has_company("empresa_stock")
  );

CREATE POLICY "EntregasPedido_insert" ON "EntregasPedido"
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('admin','editor')
    AND (user_has_company("empresa_pedido") OR user_has_company("empresa_stock"))
  );

CREATE POLICY "EntregasPedido_update" ON "EntregasPedido"
  FOR UPDATE TO authenticated
  USING (
    get_user_role() IN ('admin','editor')
    AND (user_has_company("empresa_pedido") OR user_has_company("empresa_stock"))
  )
  WITH CHECK (
    get_user_role() IN ('admin','editor')
    AND (user_has_company("empresa_pedido") OR user_has_company("empresa_stock"))
  );

CREATE POLICY "EntregasPedido_delete" ON "EntregasPedido"
  FOR DELETE TO authenticated
  USING (
    get_user_role() IN ('admin','editor')
    AND (user_has_company("empresa_pedido") OR user_has_company("empresa_stock"))
  );


-- ══════════════════════════════════════════════════════════════
-- 5. GRANTS
-- ══════════════════════════════════════════════════════════════

GRANT ALL ON "EntregasPedido" TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- FIN MIGRACIÓN
-- ══════════════════════════════════════════════════════════════
