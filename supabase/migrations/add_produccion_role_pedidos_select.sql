-- Permite al rol 'produccion' consultar (solo lectura) la tabla Pedidos.
-- Motivo: usuarios con este rol (p.ej. Camila Sanchez) ya tenían el módulo
-- "pedidos" asignado en usuario_modulos, pero la policy Pedidos_select no
-- incluía 'produccion' en el array de roles permitidos, así que la consulta
-- devolvía 0 filas pese a tener acceso a las empresas.
-- Alcance: solo SELECT. No se toca Pedidos_insert/update/delete.

DROP POLICY IF EXISTS "Pedidos_select" ON public."Pedidos";

CREATE POLICY "Pedidos_select" ON public."Pedidos"
FOR SELECT
TO authenticated
USING (
  (user_has_company("Nombre_Empresa") OR (get_user_role() = 'gerente_iaso'::text))
  AND (
    (get_user_role() = ANY (ARRAY['admin'::text, 'editor'::text, 'lector'::text, 'contabilidad'::text, 'gerente_iaso'::text, 'despachador'::text, 'remisionador'::text, 'cartera'::text, 'produccion'::text]))
    OR (
      (get_user_role() = 'comercial'::text)
      AND ((comercial_id = (SELECT auth.uid())) OR (creado_por = (SELECT auth.uid())))
    )
  )
);
