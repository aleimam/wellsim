\set ON_ERROR_STOP on
-- Read-only assertions; valid on the source or an isolated restored copy.
DO $verify$
DECLARE
  found_count integer;
BEGIN
  IF current_database() NOT IN ('bldrz', 'bldrz_restore_probe',
      'bldrz_pool_probe', 'bldrz_restore_security') THEN
    RAISE EXCEPTION 'unexpected recovery database';
  END IF;
  SELECT count(*) INTO found_count FROM pg_roles WHERE rolname IN
    ('bldrz_app', 'bldrz_runtime', 'bldrz_migration_owner');
  IF found_count <> 3 OR EXISTS (SELECT FROM pg_roles WHERE rolname IN
    ('bldrz_app', 'bldrz_runtime', 'bldrz_migration_owner')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR
      rolbypassrls OR rolinherit OR rolcanlogin <> (rolname = 'bldrz_app'))) THEN
    RAISE EXCEPTION 'unsafe bldrz role flags';
  END IF;
  IF (SELECT rolconnlimit FROM pg_roles WHERE rolname = 'bldrz_app') <> 40 THEN
    RAISE EXCEPTION 'unexpected connection limit';
  END IF;
  SELECT count(*) INTO found_count FROM pg_auth_members
    WHERE member IN ('bldrz_app'::regrole, 'bldrz_runtime'::regrole,
      'bldrz_migration_owner'::regrole);
  IF found_count <> 1 OR NOT EXISTS (SELECT FROM pg_auth_members
    WHERE member = 'bldrz_app'::regrole AND roleid = 'bldrz_runtime'::regrole
      AND NOT admin_option AND NOT inherit_option AND set_option) THEN
    RAISE EXCEPTION 'unexpected role membership';
  END IF;
  IF (SELECT datdba FROM pg_database WHERE datname = current_database()) <>
      'bldrz_migration_owner'::regrole OR EXISTS (
      SELECT FROM pg_database d, LATERAL aclexplode(d.datacl) a
      WHERE d.datname = current_database() AND a.grantee = 0) THEN
    RAISE EXCEPTION 'unsafe database ownership or PUBLIC grants';
  END IF;
  IF NOT has_database_privilege('bldrz_app', current_database(), 'CONNECT') OR
    has_database_privilege('bldrz_app', current_database(), 'CREATE') OR
    has_database_privilege('bldrz_app', current_database(), 'TEMPORARY') OR
    has_schema_privilege('bldrz_app', 'app', 'USAGE') OR
    has_schema_privilege('bldrz_runtime', 'app', 'CREATE') THEN
    RAISE EXCEPTION 'unsafe login or runtime database privileges';
  END IF;
  IF (SELECT nspowner FROM pg_namespace WHERE nspname = 'app') <>
      'bldrz_migration_owner'::regrole OR EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relowner <> 'bldrz_migration_owner'::regrole
    ) OR EXISTS (SELECT FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.proowner <> 'bldrz_migration_owner'::regrole) THEN
    RAISE EXCEPTION 'application object ownership was not preserved';
  END IF;
  IF EXISTS (SELECT FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname IN ('app', 'public') AND a.grantee = 0) OR EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
        LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = 'app' AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC schema/table access was restored';
  END IF;
  SELECT count(*) INTO found_count FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relrowsecurity;
  IF found_count <> 22 OR (SELECT count(*) FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app') <> 54
    OR EXISTS (SELECT FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app'
        AND p.polroles <> ARRAY['bldrz_runtime'::regrole::oid]) THEN
    RAISE EXCEPTION 'RLS policy set does not match migrations 0001-0003';
  END IF;
  IF has_table_privilege('bldrz_runtime', 'app.engineering_case', 'DELETE') OR
    has_column_privilege('bldrz_runtime', 'app.engineering_case', 'workspace_id', 'UPDATE') OR
    has_table_privilege('bldrz_runtime', 'app.case_revision', 'UPDATE') OR
    has_table_privilege('bldrz_runtime', 'app.export_item', 'UPDATE') THEN
    RAISE EXCEPTION 'protected records or ownership are mutable';
  END IF;
  IF (SELECT array_agg(version ORDER BY version) FROM app.schema_migration)
      IS DISTINCT FROM ARRAY['0001_platform_foundation', '0002_tenant_isolation',
        '0003_personal_workspace_integrity']::text[] THEN
    RAISE EXCEPTION 'migration history was not preserved';
  END IF;
END
$verify$;
\echo RECOVERY_CATALOG_OK
