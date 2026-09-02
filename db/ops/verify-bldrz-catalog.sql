\set ON_ERROR_STOP on
-- Read-only assertions; valid on the source or an isolated restored copy.
DO $verify$
DECLARE
  found_count integer;
  versions text[];
  identity_enabled boolean;
BEGIN
  IF current_database() NOT IN ('bldrz', 'bldrz_restore_probe',
      'bldrz_pool_probe', 'bldrz_restore_security') THEN
    RAISE EXCEPTION 'unexpected recovery database';
  END IF;
  SELECT array_agg(version ORDER BY version) INTO versions FROM app.schema_migration;
  IF versions IS NOT DISTINCT FROM ARRAY['0001_platform_foundation', '0002_tenant_isolation',
      '0003_personal_workspace_integrity']::text[] THEN
    identity_enabled := false;
  ELSIF versions IS NOT DISTINCT FROM ARRAY['0001_platform_foundation', '0002_tenant_isolation',
      '0003_personal_workspace_integrity', '0004_verified_sessions',
      '0005_controlled_onboarding']::text[] THEN
    identity_enabled := true;
  ELSE
    RAISE EXCEPTION 'unexpected migration history';
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
  IF found_count <> CASE WHEN identity_enabled THEN 25 ELSE 22 END OR (SELECT count(*) FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app') <> 54
    OR EXISTS (SELECT FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app'
        AND p.polroles <> ARRAY['bldrz_runtime'::regrole::oid]) THEN
    RAISE EXCEPTION 'RLS policy set does not match the qualified migration history';
  END IF;
  IF has_table_privilege('bldrz_runtime', 'app.engineering_case', 'DELETE') OR
    has_column_privilege('bldrz_runtime', 'app.engineering_case', 'workspace_id', 'UPDATE') OR
    has_table_privilege('bldrz_runtime', 'app.case_revision', 'UPDATE') OR
    has_table_privilege('bldrz_runtime', 'app.export_item', 'UPDATE') THEN
    RAISE EXCEPTION 'protected records or ownership are mutable';
  END IF;
  IF identity_enabled THEN
    IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app' AND c.relname IN ('login_transaction','web_session','authentication_event')
          AND has_table_privilege('bldrz_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE')) OR
      has_table_privilege('bldrz_runtime','app.membership','INSERT') OR
      has_any_column_privilege('bldrz_runtime','app.membership','UPDATE') OR
      has_table_privilege('bldrz_runtime','app.workspace_invitation','INSERT') OR
      has_any_column_privilege('bldrz_runtime','app.workspace_invitation','UPDATE') THEN
      RAISE EXCEPTION 'identity or membership tables bypass the guarded function boundary';
    END IF;
    SELECT count(*) INTO found_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='app' AND p.proname IN ('auth_create_flow','auth_consume_flow',
        'auth_revoke_session','auth_create_session','auth_read_session','auth_list_workspaces',
        'onboarding_sign_in','onboarding_command');
    IF found_count <> 8 OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='app' AND (p.proname LIKE 'auth\_%' ESCAPE '\' OR p.proname LIKE 'onboarding\_%' ESCAPE '\')
          AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
            OR NOT has_function_privilege('bldrz_runtime',p.oid,'EXECUTE')
            OR has_function_privilege('bldrz_app',p.oid,'EXECUTE')
            OR EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee=0))) THEN
      RAISE EXCEPTION 'identity function privileges or fixed search path were not preserved';
    END IF;
  END IF;
END
$verify$;
\echo RECOVERY_CATALOG_OK
