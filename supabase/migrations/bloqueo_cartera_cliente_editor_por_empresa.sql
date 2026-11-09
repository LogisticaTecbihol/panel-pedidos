-- ============================================================
-- Migración: bloqueo_cartera_cliente_editor_por_empresa — el rol «editor»
--            solo puede bloquear / suspender / liberar clientes (y editar sus
--            observaciones de cartera) de SUS empresas asignadas.
--
-- Problema: guard_bloqueo_cartera_cliente() dejaba a admin, editor y cartera
-- cambiar el estado «Bloqueado por cartera» / «Suspendido» de CUALQUIER registro
-- de ClientesUnicos. Para admin y cartera (que ven todo el holding) está bien,
-- pero un editor asignado a una sola empresa (p. ej. Carlos Ramirez → PARCELAR)
-- podía bloquear clientes de IASO, IAS, GREEN o RESO.
--
-- Solución: en el MISMO trigger, para rol 'editor', si el UPDATE/INSERT
--   · cambia hacia/desde 'Bloqueado por cartera' o 'Suspendido', o
--   · cambia Observaciones_Cartera, o
--   · mueve de empresa un registro que está (o queda) en uno de esos estados,
-- la empresa del registro (la de antes y la de después) debe estar en
-- usuario_empresas del usuario. Un registro SIN empresa no cuenta (no pertenece
-- a ninguna empresa del editor; cliente_estado_pedido() tampoco lo mira). Es
-- más estricto que user_has_company(), que deja pasar el texto vacío.
--
-- Qué NO cambia:
--   · admin y cartera: sin restricción (como hasta ahora).
--   · Roles distintos de admin/editor/cartera: mismas dos reglas de antes.
--   · Editar cualquier otro campo del cliente (teléfono, cupo, documentación…)
--     o pasar a 'Activo'/'Inactivo' un registro que no está restringido.
--   · Editores con todas las empresas (los demás editores): sin efecto práctico.
--   · Llamadas sin sesión (v_rol NULL: SQL editor / service_role): sin candado.
--
-- Aplica a TODA escritura sobre ClientesUnicos (Editar cliente, Cartera →
-- Liberar/Reactivar, RPC bloquear_cliente_por_nit): el trigger corre con el
-- auth.uid() de quien llama aunque la RPC sea SECURITY DEFINER.
--
-- Idempotente. Aplicar con apply_migration del MCP de Supabase (no se aplica
-- con el push). Rollback: bloqueo_cartera_cliente_editor_por_empresa_rollback.sql
-- Fecha: 2026-11-09
-- ============================================================

-- ── 1. ¿La empresa está entre las asignadas del usuario que llama? ──
-- Estricto: texto vacío/NULL = false. Acepta nombre completo o sigla; solo
-- empresas activas (igual que get_user_companies()). No expuesta a clientes.
CREATE OR REPLACE FUNCTION public._usuario_tiene_empresa_estricto(p_empresa text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_empresas ue
    JOIN public.empresas e ON e.sigla = ue.empresa_sigla
    WHERE ue.usuario_id = auth.uid()
      AND e.activa = true
      AND btrim(COALESCE(p_empresa, '')) <> ''
      AND (e.nombre_completo = btrim(p_empresa) OR e.sigla = btrim(p_empresa))
  );
$function$;

REVOKE ALL ON FUNCTION public._usuario_tiene_empresa_estricto(text) FROM public, anon, authenticated;

-- ── 2. Candado del trigger ──
CREATE OR REPLACE FUNCTION public.guard_bloqueo_cartera_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol        text := get_user_role();
  v_old_estado text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Estado" ELSE NULL END;
  v_old_obs    text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Observaciones_Cartera" ELSE NULL END;
  v_old_emp    text := CASE WHEN TG_OP = 'UPDATE' THEN OLD."Nombre_Empresa" ELSE NULL END;
  v_toca_estado boolean;   -- entra o sale de 'Bloqueado por cartera' / 'Suspendido'
  v_toca_obs    boolean;   -- cambia Observaciones_Cartera
  v_toca_empresa boolean;  -- cambia de empresa un registro restringido
  v_fuera       boolean;
  v_empresas    text;
BEGIN
  v_toca_estado := NEW."Estado" IS DISTINCT FROM v_old_estado
    AND (COALESCE(v_old_estado,'') IN ('Bloqueado por cartera','Suspendido')
         OR COALESCE(NEW."Estado",'') IN ('Bloqueado por cartera','Suspendido'));
  v_toca_obs := NEW."Observaciones_Cartera" IS DISTINCT FROM COALESCE(v_old_obs, '');
  v_toca_empresa := TG_OP = 'UPDATE'
    AND NEW."Nombre_Empresa" IS DISTINCT FROM v_old_emp
    AND (COALESCE(v_old_estado,'') IN ('Bloqueado por cartera','Suspendido')
         OR COALESCE(NEW."Estado",'') IN ('Bloqueado por cartera','Suspendido'));

  IF v_rol IS NOT NULL AND v_rol NOT IN ('admin','editor','cartera') THEN
    -- Roles sin permiso de cartera: igual que antes.
    IF v_toca_estado THEN
      RAISE EXCEPTION 'Solo Cartera, edición o administración pueden marcar o liberar el estado "%" en un cliente', COALESCE(NEW."Estado", v_old_estado);
    END IF;
    IF v_toca_obs THEN
      RAISE EXCEPTION 'Solo Cartera, edición o administración pueden editar las observaciones de cartera de un cliente';
    END IF;

  ELSIF v_rol = 'editor' AND (v_toca_estado OR v_toca_obs OR v_toca_empresa) THEN
    -- Editor: solo en las empresas que tiene asignadas (la de antes y la de después).
    v_fuera := NOT public._usuario_tiene_empresa_estricto(NEW."Nombre_Empresa");
    IF TG_OP = 'UPDATE' THEN
      v_fuera := v_fuera OR NOT public._usuario_tiene_empresa_estricto(v_old_emp);
    END IF;
    IF v_fuera THEN
      SELECT string_agg(ue.empresa_sigla, ', ' ORDER BY ue.empresa_sigla)
        INTO v_empresas
      FROM public.usuario_empresas ue
      WHERE ue.usuario_id = auth.uid();
      RAISE EXCEPTION 'Como editor solo puedes bloquear, suspender o liberar clientes (y editar sus observaciones de cartera) de tus empresas: %', COALESCE(v_empresas, 'ninguna asignada');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_bloqueo_cartera_cliente() FROM public, anon, authenticated;

-- El trigger trg_guard_bloqueo_cartera_cliente (BEFORE INSERT OR UPDATE) ya
-- existe y apunta a esta función: no hay que recrearlo.

-- ── 3. Refrescar la caché de esquema de PostgREST ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- FIN migración bloqueo_cartera_cliente_editor_por_empresa
-- ============================================================
