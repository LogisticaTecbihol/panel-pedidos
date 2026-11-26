-- Backup de la ESTRUCTURA: todos los esquemas propios, no solo public — 2026-11-26
--
-- La exportación de estructura (exportar_estructura_bd, módulo Backup) solo leía el
-- esquema public. Quedaban fuera:
--   * prod_priv  (creado el 2026-11-24 por la migración remota prod_priv: tabla
--                orden_consumos + orden_consumos_validar; de él dependen
--                public.prod_custodia_consumos_orden y public.prod_custodia_ordenes)
--   * abago      (panel de Chía Abagó, otro repositorio: 41 tablas, 8 vistas,
--                144 funciones, 77 políticas)
--
-- Ahora la lista de esquemas se calcula en cada exportación: todo esquema cuyo dueño es
-- postgres (o pg_database_owner, el de public), que no sea de una extensión, salvo
-- extensions y supabase_migrations (los maneja Supabase). Un esquema nuevo creado por
-- una migración entra solo, sin tocar esta función.
--
-- Además, porque abago los usa (public no los tenía):
--   * CREATE SCHEMA + sus permisos (USAGE para authenticated / service_role).
--   * Vistas y vistas materializadas, con sus opciones (security_invoker), en orden de
--     dependencia, después de las funciones.
--   * Las funciones que usan las columnas (DEFAULT abago.hoy(), GENERATED con
--     abago.nit_normalizado) salen ANTES de las tablas: si no, el script fallaba al
--     restaurar.
--   * Permisos de secuencias (las de columnas serial) y comentarios de vistas,
--     funciones y esquemas.
--
-- Sigue sin incluir (lo dice el encabezado del script): datos, usuarios de Auth, archivos
-- de Storage, secretos (Vault y Edge Functions), configuración de Auth y de la API
-- (esquemas expuestos: abago debe agregarse en API → Exposed schemas al restaurar),
-- privilegios por defecto (ALTER DEFAULT PRIVILEGES) y permisos por columna.
--
-- Solo reemplaza public._estructura_bd_ddl() (el wrapper exportar_estructura_bd y sus
-- permisos no cambian). Rollback: exportar_estructura_bd_todos_esquemas_rollback.sql.

CREATE OR REPLACE FUNCTION public._estructura_bd_ddl()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v      text;
  s      text;
  v_esq  text[];   -- esquemas que se exportan (public primero)
  v_nsp  oid[];
  v_fcol oid[];    -- funciones que usan columnas (DEFAULT / GENERATED): van antes de las tablas
BEGIN
  SELECT array_agg(n.nspname ORDER BY (n.nspname <> 'public'), n.nspname),
         array_agg(n.oid     ORDER BY (n.nspname <> 'public'), n.nspname)
    INTO v_esq, v_nsp
    FROM pg_catalog.pg_namespace n
   WHERE pg_catalog.pg_get_userbyid(n.nspowner) IN ('postgres', 'pg_database_owner')
     AND n.nspname NOT IN ('extensions', 'supabase_migrations', 'information_schema')
     AND n.nspname NOT LIKE 'pg\_%'
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                      WHERE e.classid = 'pg_catalog.pg_namespace'::regclass AND e.objid = n.oid AND e.deptype = 'e');

  SELECT coalesce(array_agg(DISTINCT p.oid), '{}'::oid[])
    INTO v_fcol
    FROM pg_catalog.pg_attrdef ad
    JOIN pg_catalog.pg_class c ON c.oid = ad.adrelid
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = ad.oid
                               AND d.refclassid = 'pg_catalog.pg_proc'::regclass
    JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
   WHERE c.relnamespace = ANY (v_nsp)
     AND p.pronamespace = ANY (v_nsp)
     AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                      WHERE e.classid = 'pg_catalog.pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e');

  v := E'-- ============================================================\n'
    || E'-- ESTRUCTURA DE LA BASE DE DATOS (solo esquema, SIN datos)\n'
    || E'-- Generada: ' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') || E' (hora Colombia)\n'
    || E'-- Origen: módulo Backup del panel (exportar_estructura_bd)\n'
    || E'-- Esquemas incluidos: ' || array_to_string(v_esq, ', ') || E' (y, de storage, sus políticas y buckets)\n'
    || E'--\n'
    || E'-- NO incluye: datos (usar el backup en Excel), usuarios de Auth, archivos de\n'
    || E'-- Storage, secretos (Vault y Edge Functions), configuración de Auth ni de la API\n'
    || E'-- (esquemas expuestos: agregar los que no son public en API → Exposed schemas),\n'
    || E'-- privilegios por defecto ni permisos por columna.\n'
    || E'-- El código de las Edge Functions está en supabase/functions/ del repositorio.\n'
    || E'-- ============================================================\n\n'
    || E'SET check_function_bodies = false;\n'
    || E'SET client_min_messages = warning;\n';

  -- ── Extensiones (referencia) ──
  SELECT string_agg(format('-- %s %s (esquema %s)', e.extname, e.extversion, n.nspname), E'\n' ORDER BY e.extname)
    INTO s
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname <> 'plpgsql';
  v := v || E'\n-- ── 1. Extensiones instaladas (referencia; se habilitan en Database → Extensions) ──\n'
         || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Esquemas (public ya existe en todo proyecto) ──
  SELECT string_agg(x.stmt, E'\n' ORDER BY x.ord)
    INTO s
    FROM (
      SELECT format('CREATE SCHEMA IF NOT EXISTS %I;', n.nspname) AS stmt, n.nspname || ' 0' AS ord
        FROM pg_catalog.pg_namespace n
       WHERE n.oid = ANY (v_nsp) AND n.nspname <> 'public'
      UNION ALL
      SELECT format('COMMENT ON SCHEMA %I IS %L;', n.nspname, d.description), n.nspname || ' 1'
        FROM pg_catalog.pg_namespace n
        JOIN pg_catalog.pg_description d ON d.objoid = n.oid AND d.classoid = 'pg_catalog.pg_namespace'::regclass
       WHERE n.oid = ANY (v_nsp) AND n.nspname <> 'public'
      UNION ALL
      SELECT format('GRANT %s ON SCHEMA %I TO %s;',
                    string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type), n.nspname,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(a.grantee)) END),
             n.nspname || ' 2 ' || a.grantee::text
        FROM pg_catalog.pg_namespace n
        CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
       WHERE n.oid = ANY (v_nsp) AND n.nspname <> 'public'
         AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
       GROUP BY n.nspname, a.grantee
    ) x;
  v := v || E'\n-- ── 2. Esquemas ──\n' || coalesce(s, '-- (solo public)') || E'\n';

  -- ── Secuencias sueltas y de columnas serial (las de columnas identity las crea la propia columna) ──
  SELECT string_agg(
           format('CREATE SEQUENCE %I.%I AS %s START WITH %s INCREMENT BY %s MINVALUE %s MAXVALUE %s CACHE %s%s;',
                  n.nspname, c.relname, pg_catalog.format_type(q.seqtypid, NULL),
                  q.seqstart, q.seqincrement, q.seqmin, q.seqmax, q.seqcache,
                  CASE WHEN q.seqcycle THEN ' CYCLE' ELSE '' END),
           E'\n' ORDER BY array_position(v_nsp, c.relnamespace), c.relname)
    INTO s
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_sequence q ON q.seqrelid = c.oid
   WHERE c.relnamespace = ANY (v_nsp)
     AND c.relkind = 'S'
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                      WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e');
  v := v || E'\n-- ── 3. Secuencias ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Funciones que usan las columnas (DEFAULT / GENERATED): deben existir antes que las tablas ──
  SELECT string_agg(
           pg_catalog.rtrim(pg_catalog.pg_get_functiondef(p.oid), E'\n') || E';\n',
           E'\n' ORDER BY array_position(v_nsp, p.pronamespace), p.proname, p.oid)
    INTO s
    FROM pg_catalog.pg_proc p
   WHERE p.oid = ANY (v_fcol);
  v := v || E'\n-- ── 4. Funciones usadas por columnas (van antes de las tablas) ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Tablas ──
  SELECT string_agg(
           format(E'CREATE TABLE %I.%I (\n%s\n);', n.nspname, t.relname,
             (SELECT string_agg(
                       format('  %I %s%s%s',
                              a.attname,
                              pg_catalog.format_type(a.atttypid, a.atttypmod),
                              CASE
                                WHEN a.attidentity = 'a' THEN ' GENERATED ALWAYS AS IDENTITY'
                                WHEN a.attidentity = 'd' THEN ' GENERATED BY DEFAULT AS IDENTITY'
                                WHEN a.attgenerated = 's' THEN ' GENERATED ALWAYS AS (' || pg_catalog.pg_get_expr(d.adbin, d.adrelid) || ') STORED'
                                WHEN d.adbin IS NOT NULL THEN ' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid)
                                ELSE ''
                              END,
                              CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END),
                       E',\n' ORDER BY a.attnum)
                FROM pg_catalog.pg_attribute a
                LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
               WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped)),
           E'\n\n' ORDER BY array_position(v_nsp, t.relnamespace), t.relname)
    INTO s
    FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
   WHERE t.relnamespace = ANY (v_nsp)
     AND t.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                      WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = t.oid AND e.deptype = 'e');
  v := v || E'\n-- ── 5. Tablas ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- Secuencias "serial" (dueñas de una columna)
  SELECT string_agg(
           format('ALTER SEQUENCE %I.%I OWNED BY %I.%I.%I;', sn.nspname, sc.relname, tn.nspname, tc.relname, a.attname),
           E'\n' ORDER BY array_position(v_nsp, sc.relnamespace), sc.relname)
    INTO s
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_class sc ON sc.oid = d.objid
    JOIN pg_catalog.pg_namespace sn ON sn.oid = sc.relnamespace
    JOIN pg_catalog.pg_class tc ON tc.oid = d.refobjid
    JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = tc.oid AND a.attnum = d.refobjsubid
   WHERE d.classid = 'pg_catalog.pg_class'::regclass
     AND d.refclassid = 'pg_catalog.pg_class'::regclass
     AND d.deptype = 'a'
     AND sc.relkind = 'S'
     AND sc.relnamespace = ANY (v_nsp)
     AND tc.relnamespace = ANY (v_nsp);
  IF s IS NOT NULL THEN
    v := v || E'\n-- Secuencias propiedad de una columna\n' || s || E'\n';
  END IF;

  -- ── Funciones y procedimientos (menos los que ya salieron antes de las tablas) ──
  SELECT string_agg(
           pg_catalog.rtrim(pg_catalog.pg_get_functiondef(p.oid), E'\n') || E';\n',
           E'\n' ORDER BY array_position(v_nsp, p.pronamespace), p.proname, p.oid)
    INTO s
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = ANY (v_nsp)
     AND p.prokind IN ('f', 'p')
     AND NOT (p.oid = ANY (v_fcol))
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                      WHERE e.classid = 'pg_catalog.pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e');
  v := v || E'\n-- ── 6. Funciones y procedimientos ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Vistas y vistas materializadas, en orden de dependencia (una vista que usa otra va después) ──
  WITH RECURSIVE vis AS (
    SELECT c.oid
      FROM pg_catalog.pg_class c
     WHERE c.relnamespace = ANY (v_nsp)
       AND c.relkind IN ('v', 'm')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                        WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e')
  ), dep AS (
    SELECT DISTINCT r.ev_class AS vista, d.refobjid AS usa
      FROM pg_catalog.pg_rewrite r
      JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = r.oid
                                 AND d.refclassid = 'pg_catalog.pg_class'::regclass
     WHERE r.ev_class IN (SELECT vis.oid FROM vis)
       AND d.refobjid IN (SELECT vis.oid FROM vis)
       AND d.refobjid <> r.ev_class
  ), niv(oid, nivel) AS (
    SELECT vis.oid, 0 FROM vis
    UNION ALL
    SELECT dep.vista, niv.nivel + 1 FROM niv JOIN dep ON dep.usa = niv.oid WHERE niv.nivel < 50
  )
  SELECT string_agg(
           CASE WHEN c.relkind = 'm' THEN
             format(E'CREATE MATERIALIZED VIEW %I.%I%s AS\n%s\nWITH NO DATA;', n.nspname, c.relname,
                    CASE WHEN c.reloptions IS NOT NULL THEN ' WITH (' || array_to_string(c.reloptions, ', ') || ')' ELSE '' END,
                    pg_catalog.rtrim(pg_catalog.pg_get_viewdef(c.oid), E'; \n\t'))
           ELSE
             format(E'CREATE VIEW %I.%I%s AS\n%s;', n.nspname, c.relname,
                    CASE WHEN c.reloptions IS NOT NULL THEN ' WITH (' || array_to_string(c.reloptions, ', ') || ')' ELSE '' END,
                    pg_catalog.rtrim(pg_catalog.pg_get_viewdef(c.oid), E'; \n\t'))
           END,
           E'\n\n' ORDER BY m.nivel, array_position(v_nsp, c.relnamespace), c.relname)
    INTO s
    FROM (SELECT niv.oid, max(niv.nivel) AS nivel FROM niv GROUP BY niv.oid) m
    JOIN pg_catalog.pg_class c ON c.oid = m.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace;
  v := v || E'\n-- ── 7. Vistas ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Constraints (PK, UNIQUE, EXCLUDE, CHECK y al final las FK) ──
  SELECT string_agg(
           format('ALTER TABLE ONLY %I.%I ADD CONSTRAINT %I %s;',
                  n.nspname, c.relname, k.conname, pg_catalog.pg_get_constraintdef(k.oid)),
           E'\n' ORDER BY CASE k.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'x' THEN 3 WHEN 'c' THEN 4 ELSE 5 END,
                          array_position(v_nsp, c.relnamespace), c.relname, k.conname)
    INTO s
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relnamespace = ANY (v_nsp)
     AND c.relkind = 'r'
     AND k.contype IN ('p', 'u', 'x', 'c', 'f')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                      WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e');
  v := v || E'\n-- ── 8. Constraints (PK, UNIQUE, CHECK, FK) ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Índices (los que respaldan una PK/UNIQUE ya salen en constraints) ──
  SELECT string_agg(pg_catalog.pg_get_indexdef(i.indexrelid) || ';', E'\n'
                    ORDER BY array_position(v_nsp, c.relnamespace), c.relname, ic.relname)
    INTO s
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
   WHERE c.relnamespace = ANY (v_nsp)
     AND c.relkind IN ('r', 'm')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                      WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x'))
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                      WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e');
  v := v || E'\n-- ── 9. Índices ──\n' || coalesce(s, '-- (ninguno)') || E'\n';

  -- ── Triggers ──
  SELECT string_agg(
           pg_catalog.pg_get_triggerdef(t.oid) || ';' ||
           CASE t.tgenabled
             WHEN 'D' THEN format(E'\nALTER TABLE %I.%I DISABLE TRIGGER %I;', n.nspname, c.relname, t.tgname)
             WHEN 'R' THEN format(E'\nALTER TABLE %I.%I ENABLE REPLICA TRIGGER %I;', n.nspname, c.relname, t.tgname)
             WHEN 'A' THEN format(E'\nALTER TABLE %I.%I ENABLE ALWAYS TRIGGER %I;', n.nspname, c.relname, t.tgname)
             ELSE ''
           END,
           E'\n' ORDER BY array_position(v_nsp, c.relnamespace), c.relname, t.tgname)
    INTO s
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relnamespace = ANY (v_nsp)
     AND NOT t.tgisinternal;
  v := v || E'\n-- ── 10. Triggers ──\n' || coalesce(s, '-- (ninguno)') || E'\n';

  -- ── RLS activado por tabla ──
  SELECT string_agg(
           format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', n.nspname, c.relname) ||
           CASE WHEN c.relforcerowsecurity THEN format(E'\nALTER TABLE %I.%I FORCE ROW LEVEL SECURITY;', n.nspname, c.relname) ELSE '' END,
           E'\n' ORDER BY array_position(v_nsp, c.relnamespace), c.relname)
    INTO s
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relnamespace = ANY (v_nsp)
     AND c.relkind = 'r'
     AND c.relrowsecurity;
  v := v || E'\n-- ── 11. Row Level Security ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Políticas (esquemas exportados y storage) ──
  SELECT string_agg(
           format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
                  p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
                  array_to_string(ARRAY(SELECT pg_catalog.quote_ident(r) FROM unnest(p.roles) r), ', '),
                  CASE WHEN p.qual IS NOT NULL THEN E'\n  USING (' || p.qual || ')' ELSE '' END,
                  CASE WHEN p.with_check IS NOT NULL THEN E'\n  WITH CHECK (' || p.with_check || ')' ELSE '' END),
           E'\n' ORDER BY coalesce(array_position(v_esq, p.schemaname::text), 9999), p.schemaname, p.tablename, p.policyname)
    INTO s
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = ANY (v_esq || 'storage'::text);
  v := v || E'\n-- ── 12. Políticas RLS (esquemas exportados y storage.objects) ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Comentarios de esquemas, tablas, vistas, columnas y funciones ──
  SELECT string_agg(x.stmt, E'\n' ORDER BY x.ord)
    INTO s
    FROM (
      SELECT format('COMMENT ON %s %I.%I IS %L;',
                    CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
                    n.nspname, c.relname, d.description) AS stmt,
             lpad(array_position(v_nsp, c.relnamespace)::text, 3, '0') || ' ' || c.relname || ' 0000' AS ord
        FROM pg_catalog.pg_description d
        JOIN pg_catalog.pg_class c ON c.oid = d.objoid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE d.classoid = 'pg_catalog.pg_class'::regclass AND d.objsubid = 0
         AND c.relnamespace = ANY (v_nsp) AND c.relkind IN ('r', 'v', 'm')
      UNION ALL
      SELECT format('COMMENT ON COLUMN %I.%I.%I IS %L;', n.nspname, c.relname, a.attname, d.description),
             lpad(array_position(v_nsp, c.relnamespace)::text, 3, '0') || ' ' || c.relname || ' ' || lpad(a.attnum::text, 4, '0')
        FROM pg_catalog.pg_description d
        JOIN pg_catalog.pg_class c ON c.oid = d.objoid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
       WHERE d.classoid = 'pg_catalog.pg_class'::regclass AND d.objsubid > 0
         AND c.relnamespace = ANY (v_nsp) AND c.relkind IN ('r', 'v', 'm')
      UNION ALL
      SELECT format('COMMENT ON %s %s IS %L;', CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
                    p.oid::regprocedure, d.description),
             lpad(array_position(v_nsp, p.pronamespace)::text, 3, '0') || ' ~fn ' || p.proname || ' ' || p.oid::text
        FROM pg_catalog.pg_description d
        JOIN pg_catalog.pg_proc p ON p.oid = d.objoid
       WHERE d.classoid = 'pg_catalog.pg_proc'::regclass
         AND p.pronamespace = ANY (v_nsp) AND p.prokind IN ('f', 'p')
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                          WHERE e.classid = 'pg_catalog.pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e')
    ) x;
  v := v || E'\n-- ── 13. Comentarios ──\n' || coalesce(s, '-- (ninguno)') || E'\n';

  -- ── Permisos (GRANT) de tablas, vistas y secuencias para anon / authenticated / service_role ──
  SELECT string_agg(x.stmt, E'\n' ORDER BY x.ord)
    INTO s
    FROM (
      SELECT format('REVOKE ALL ON %s %I.%I FROM anon, authenticated, service_role;',
                    CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, n.nspname, c.relname) AS stmt,
             lpad(array_position(v_nsp, c.relnamespace)::text, 3, '0') || ' ' || c.relname || ' 0' AS ord
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relnamespace = ANY (v_nsp) AND c.relkind IN ('r', 'v', 'm', 'S')
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                          WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid AND e.deptype IN ('e', 'i'))
      UNION ALL
      SELECT format('GRANT %s ON %s %I.%I TO %I;', g.privs, CASE WHEN g.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
                    g.nspname, g.relname, pg_catalog.pg_get_userbyid(g.gid)),
             lpad(g.pos::text, 3, '0') || ' ' || g.relname || ' 1 ' || pg_catalog.pg_get_userbyid(g.gid)
        FROM (
          SELECT n.nspname, c.relname, c.relkind, array_position(v_nsp, c.relnamespace) AS pos, a.grantee AS gid,
                 string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type) AS privs
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
           WHERE c.relnamespace = ANY (v_nsp) AND c.relkind IN ('r', 'v', 'm', 'S')
             AND pg_catalog.pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                              WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid AND e.deptype IN ('e', 'i'))
           GROUP BY n.nspname, c.relname, c.relkind, c.relnamespace, a.grantee
        ) g
    ) x;
  v := v || E'\n-- ── 14. Permisos de tablas, vistas y secuencias ──\n' || coalesce(s, '-- (ninguno)') || E'\n';

  -- ── Permisos (EXECUTE) de funciones ──
  SELECT string_agg(x.stmt, E'\n' ORDER BY x.ord)
    INTO s
    FROM (
      SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role;', p.oid::regprocedure) AS stmt,
             lpad(array_position(v_nsp, p.pronamespace)::text, 3, '0') || ' ' || p.proname || ' ' || p.oid::text || ' 0' AS ord
        FROM pg_catalog.pg_proc p
       WHERE p.pronamespace = ANY (v_nsp) AND p.prokind IN ('f', 'p') AND p.proacl IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                          WHERE e.classid = 'pg_catalog.pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e')
      UNION ALL
      SELECT format('GRANT EXECUTE ON FUNCTION %s TO %s;', p.oid::regprocedure,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(a.grantee)) END),
             lpad(array_position(v_nsp, p.pronamespace)::text, 3, '0') || ' ' || p.proname || ' ' || p.oid::text || ' 1 ' || a.grantee::text
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
       WHERE p.pronamespace = ANY (v_nsp) AND p.prokind IN ('f', 'p')
         AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e
                          WHERE e.classid = 'pg_catalog.pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e')
    ) x;
  v := v || E'\n-- ── 15. Permisos de funciones ──\n' || coalesce(s, '-- (ninguno)') || E'\n';

  -- ── Publicación realtime ──
  SELECT string_agg(format('ALTER PUBLICATION %I ADD TABLE %I.%I;', pt.pubname, pt.schemaname, pt.tablename),
                    E'\n' ORDER BY pt.pubname, pt.schemaname, pt.tablename)
    INTO s
    FROM pg_catalog.pg_publication_tables pt
   WHERE pt.schemaname = ANY (v_esq);
  v := v || E'\n-- ── 16. Realtime (tablas publicadas) ──\n' || coalesce(s, '-- (ninguna)') || E'\n';

  -- ── Buckets de Storage ──
  SELECT string_agg(
           format('INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (%L, %L, %L, %L, %L) ON CONFLICT (id) DO NOTHING;',
                  b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types),
           E'\n' ORDER BY b.id)
    INTO s
    FROM storage.buckets b;
  v := v || E'\n-- ── 17. Buckets de Storage (solo la definición; los archivos NO van aquí) ──\n'
         || coalesce(s, '-- (ninguno)') || E'\n';

  -- ── Tareas programadas (pg_cron) ──
  s := NULL;
  IF pg_catalog.to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$
      SELECT string_agg(
               format('SELECT cron.schedule(%L, %L, %L);', j.jobname, j.schedule, j.command)
                 || CASE WHEN j.active THEN '' ELSE ' -- INACTIVA en producción' END,
               E'\n' ORDER BY j.jobname)
        FROM cron.job j
    $q$ INTO s;
  END IF;
  v := v || E'\n-- ── 18. Tareas programadas (pg_cron; si usan secretos de Vault, hay que crearlos aparte) ──\n'
         || coalesce(s, '-- (ninguna)') || E'\n';

  RETURN v;
END;
$fn$;

REVOKE ALL ON FUNCTION public._estructura_bd_ddl() FROM PUBLIC, anon, authenticated;
