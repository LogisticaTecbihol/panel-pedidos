-- ═══════════════════════════════════════════════════════════════════════════
-- Comprobación de legalizacion_gastos_lector_solo_lectura.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Correr DESPUÉS de aplicar la migración. No escribe nada: la parte C simula la
-- sesión de cada usuario con set_config local y todo termina en ROLLBACK.
-- Esperado: todas las filas dicen OK.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- A. Ninguna política de escritura de Legalización de Gastos usa ya user_has_module
SELECT 'A. políticas de escritura sin migrar' AS prueba,
       count(*) AS cantidad,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FALLA' END AS resultado
FROM pg_policies
WHERE cmd <> 'SELECT'
  AND (coalesce(qual, '') LIKE '%user_has_module(''legalizacion_gastos%'
    OR coalesce(with_check, '') LIKE '%user_has_module(''legalizacion_gastos%');

-- B. Las 22 políticas de escritura usan la función nueva
SELECT 'B. políticas de escritura con user_can_write_module (22)' AS prueba,
       count(*) AS cantidad,
       CASE WHEN count(*) = 22 THEN 'OK' ELSE 'FALLA' END AS resultado
FROM pg_policies
WHERE cmd <> 'SELECT'
  AND (coalesce(qual, '') LIKE '%user_can_write_module(%'
    OR coalesce(with_check, '') LIKE '%user_can_write_module(%');

-- C. La función por usuario: el lector no escribe; los demás con el módulo, sí
CREATE TEMP TABLE _res (prueba text, esperado boolean, obtenido boolean);
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT u.id, u.rol, u.nombre FROM usuarios u
    WHERE u.activo
      AND (u.rol = 'admin'
           OR EXISTS (SELECT 1 FROM usuario_modulos m
                       WHERE m.usuario_id = u.id AND m.modulo = 'legalizacion_gastos'))
  LOOP
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    INSERT INTO _res VALUES ('C. ' || r.rol || ' – ' || r.nombre,
                             r.rol <> 'lector',
                             public.user_can_write_module('legalizacion_gastos'));
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
SELECT prueba, esperado AS "¿debe poder escribir?", obtenido AS "¿puede?",
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
FROM _res ORDER BY prueba;

-- D. Sin sesión (anon / sin usuario) no escribe
SELECT 'D. sin sesión' AS prueba, public.user_can_write_module('legalizacion_gastos') AS "¿puede?",
       CASE WHEN NOT public.user_can_write_module('legalizacion_gastos') THEN 'OK' ELSE 'FALLA' END AS resultado;

ROLLBACK;
