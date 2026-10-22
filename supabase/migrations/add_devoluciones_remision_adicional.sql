-- ============================================================
-- Migración: remisiones ADICIONALES de ingreso / salida en una
-- devolución ya tramitada (botón «↩ Reabrir» en devoluciones.html).
--
-- Cada remisión adicional es una FILA NUEVA de "Devoluciones" con UN solo
-- lado (Remision_Ingreso/Remision, o Remision_Salida) y su propia cantidad
-- en Cant_Entregada. kardex.js, existencias.js y la función _kx_movs ya
-- descartan todo movimiento sin número de remisión ("sin remisión solo se
-- admite Saldo Inicial"), así que una fila con solo RS no genera entrada y
-- una con solo RE no genera salida: NO hay que tocar Kardex ni saldos.
--
--   Tipo_Adicional   NULL = fila normal de la devolución.
--                    'Ingreso' | 'Salida' = remisión adicional de ese lado.
--   Linea_Origen_Id  id de la línea ORIGINAL de la devolución a la que se
--                    suma (para el tope: devuelto vigente ≤ solicitado).
--                    Sin FK a propósito: borrar la línea original no debe
--                    arrastrar movimientos de stock ya emitidos.
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase.
-- Fecha: 2026-10-22
-- ============================================================

ALTER TABLE public."Devoluciones"
  ADD COLUMN IF NOT EXISTS "Tipo_Adicional"  text,
  ADD COLUMN IF NOT EXISTS "Linea_Origen_Id" bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'devoluciones_tipo_adicional_check'
      AND conrelid = 'public."Devoluciones"'::regclass
  ) THEN
    ALTER TABLE public."Devoluciones"
      ADD CONSTRAINT devoluciones_tipo_adicional_check
      CHECK ("Tipo_Adicional" IS NULL OR "Tipo_Adicional" IN ('Ingreso', 'Salida'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_devoluciones_linea_origen
  ON public."Devoluciones" ("Linea_Origen_Id")
  WHERE "Linea_Origen_Id" IS NOT NULL;

NOTIFY pgrst, 'reload schema';
