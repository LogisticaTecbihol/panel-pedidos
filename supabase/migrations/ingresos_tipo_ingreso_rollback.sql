-- ============================================================
-- Rollback de ingresos_tipo_ingreso.sql
-- Quita el trigger, las dos funciones, el CHECK y la columna. Se pierde el
-- tipo guardado (el JS anterior no lo usa, así que no afecta lo demás).
-- Publicar el JS anterior ANTES de ejecutarlo: el nuevo pide la columna.
-- ============================================================

DROP TRIGGER IF EXISTS trg_ingresos_tipo_defecto ON public."Ingresos";
DROP FUNCTION IF EXISTS public.fn_ingresos_tipo_defecto();
DROP FUNCTION IF EXISTS public._ingreso_tipo_sugerido(text, text, text, text);
ALTER TABLE public."Ingresos" DROP CONSTRAINT IF EXISTS ingresos_tipo_ingreso_check;
ALTER TABLE public."Ingresos" DROP COLUMN IF EXISTS "Tipo_Ingreso";

NOTIFY pgrst, 'reload schema';
